// Backs the "Build custom card" page: lets the user hand-enter every field a card has and upload
// their own artwork, bypassing the local card database entirely for a one-off preview, or - once
// they're happy with it - saving it as a brand new permanent entry in data/cardinfo.json (plus its
// artwork into card-artworks/) so it behaves exactly like a real card afterwards (searchable,
// reusable from the Search tab, etc).
import fs from "fs";
import path from "path";
import { app, dialog } from "electron";
import sharp from "sharp";
import { loadPsdTree, renderProxyCard } from "../src/cardProxyGenerator";
import { ProxyCard } from "../src/types";
import {
	ARTWORK_DIR,
	CardDatabase,
	CUSTOM_ID_START,
	loadCardDatabase,
	sanitizeFilename,
	saveCardDatabase,
	YgoCard,
} from "../scripts/cardData";
import { invalidateCardCache } from "./cardSearch";
import {
	optionalInt,
	optionalString,
	optionalStringArray,
	requireObject,
	requireString,
} from "./ipcValidation";
import { resolveInside } from "./pathSafety";

const OUTPUT_DIR = path.join(app.getAppPath(), "output");

export interface CustomCardInput {
	name: string;
	type: string;
	frameType: string;
	atk?: number | null;
	def?: number | null;
	level?: number | null;
	race?: string | null;
	attribute?: string | null;
	scale?: number | null;
	linkMarkers?: string[] | null;
	fx?: string[] | null;
}

// Art files the user actually chose through the native picker this session - the renderer only ever
// hands a path back, so anything not in here (e.g. an arbitrary file a compromised renderer names)
// is refused rather than read.
const pickedArtPaths = new Set<string>();

export interface PickedArtwork {
	path: string;
	dataUrl: string;
}

export interface CustomGenerateResult {
	outputPath: string;
	dataUrl: string;
	notes: string[];
}

export interface CustomSaveResult extends CustomGenerateResult {
	id: number;
}

function buildProxyCard(input: CustomCardInput, id: string | number, artPath: string): ProxyCard {
	return {
		id,
		name: input.name,
		type: input.type,
		frameType: input.frameType,
		atk: input.atk ?? null,
		def: input.def ?? null,
		level: input.level ?? null,
		race: input.race ?? null,
		attribute: input.attribute ?? null,
		scale: input.scale ?? null,
		linkMarkers: input.linkMarkers ?? null,
		fx: input.fx ?? null,
		art: artPath,
	};
}

// Narrows the renderer's untrusted payload to a real CustomCardInput, field by field.
export function parseCustomCardInput(raw: unknown): CustomCardInput {
	const obj = requireObject(raw, "card");

	return {
		name: requireString(obj.name, "name", 200),
		type: requireString(obj.type, "type", 100),
		frameType: requireString(obj.frameType, "frameType", 100),
		atk: optionalInt(obj.atk, "atk") ?? null,
		def: optionalInt(obj.def, "def") ?? null,
		level: optionalInt(obj.level, "level") ?? null,
		race: optionalString(obj.race, "race") ?? null,
		attribute: optionalString(obj.attribute, "attribute") ?? null,
		scale: optionalInt(obj.scale, "scale") ?? null,
		linkMarkers: optionalStringArray(obj.linkMarkers, "linkMarkers") ?? null,
		fx: optionalStringArray(obj.fx, "fx") ?? null,
	};
}

function requireInput(input: CustomCardInput, artPath: string): void {
	if (!input.name.trim()) throw new Error("Card needs a name.");
	if (!input.frameType) throw new Error("Card needs a frame.");
	if (!pickedArtPaths.has(path.resolve(artPath))) {
		throw new Error("Artwork must be chosen through the file picker.");
	}

	if (!fs.existsSync(artPath)) throw new Error(`Artwork file not found: ${artPath}`);
}

// Opens a native "choose an image" dialog and returns the picked file's own absolute path (handed
// back unchanged to generate/save below) plus a data URL for the renderer to preview immediately.
export async function pickArtworkFile(): Promise<PickedArtwork | null> {
	const { canceled, filePaths } = await dialog.showOpenDialog({
		title: "Choose artwork image",
		filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }],
		properties: ["openFile"],
	});
	if (canceled || !filePaths[0]) return null;

	const filePath = filePaths[0];
	pickedArtPaths.add(path.resolve(filePath));
	const buffer = fs.readFileSync(filePath);
	const ext = path.extname(filePath).slice(1).toLowerCase();
	const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

	return { path: filePath, dataUrl: `data:${mime};base64,${buffer.toString("base64")}` };
}

// Renders a one-off preview straight from the form + uploaded art, with no database involved -
// renderProxyCard only ever needs a ProxyCard shape and an art file path (see src/generateProxy.ts
// for the CLI's identical ad-hoc usage). Always overwrites the same output file since it's a
// scratch preview, not a saved card.
export async function generateCustomProxy(
	input: CustomCardInput,
	artPath: string,
): Promise<CustomGenerateResult> {
	requireInput(input, artPath);

	const tree = loadPsdTree();
	const card = buildProxyCard(input, "preview", artPath);
	const { png, notes } = await renderProxyCard(tree, card, artPath);

	fs.mkdirSync(OUTPUT_DIR, { recursive: true });
	const outputPath = path.join(OUTPUT_DIR, "_custom-preview.png");
	fs.writeFileSync(outputPath, png);

	return { outputPath, dataUrl: `data:image/png;base64,${png.toString("base64")}`, notes };
}

function allocateCustomId(db: CardDatabase): number {
	const maxExisting = db.data.reduce((max, card) => Math.max(max, card.id), 0);

	return Math.max(maxExisting + 1, CUSTOM_ID_START);
}

// Commits the form + uploaded art as a brand new permanent card: allocates a fresh id, converts
// and copies the art into card-artworks/<id>.jpg (matching resolveArtPathForImageId's fixed .jpg
// expectation), appends a matching entry to data/cardinfo.json, then renders + saves the proxy the
// same way a real, database-backed card would via proxyService.generateProxyForCard.
export async function saveCustomCardToDatabase(
	input: CustomCardInput,
	artPath: string,
): Promise<CustomSaveResult> {
	requireInput(input, artPath);

	const db = loadCardDatabase();
	const id = allocateCustomId(db);

	fs.mkdirSync(ARTWORK_DIR, { recursive: true });
	const artDestPath = path.join(ARTWORK_DIR, `${id}.jpg`);
	await sharp(artPath).flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toFile(artDestPath);

	const entry: YgoCard = {
		id,
		name: input.name,
		type: input.type,
		frameType: input.frameType,
		atk: input.atk ?? null,
		def: input.def ?? null,
		level: input.level ?? null,
		attribute: input.attribute ?? null,
		race: input.race ?? null,
		scale: input.scale ?? null,
		linkval: input.def ?? null,
		linkmarkers: input.linkMarkers ?? null,
		card_images: [{ id }],
	};
	db.data.push(entry);
	saveCardDatabase(db);
	invalidateCardCache();

	const tree = loadPsdTree();
	const proxyCard = buildProxyCard(input, id, artDestPath);
	const { png, notes } = await renderProxyCard(tree, proxyCard, artDestPath);

	fs.mkdirSync(OUTPUT_DIR, { recursive: true });
	const outputPath = resolveInside(OUTPUT_DIR, `${id}-${sanitizeFilename(input.name)}.png`);
	fs.writeFileSync(outputPath, png);

	return { id, outputPath, dataUrl: `data:image/png;base64,${png.toString("base64")}`, notes };
}
