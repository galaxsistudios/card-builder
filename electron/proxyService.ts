// Bridges IPC requests to the existing standalone generator (src/cardProxyGenerator.ts), reused
// as-is, same as the CLI in src/generateProxy.ts does.
import fs from "fs";
import path from "path";
import { app } from "electron";
import { loadPsdTree, renderProxyCard } from "../src/cardProxyGenerator";
import {
	listLocalArtVariants,
	overframeArtworkId,
	resolveOverframePath,
	sanitizeFilename,
	toProxyCard,
} from "../scripts/cardData";
import { findCard } from "./cardSearch";

// Exported so ydkService.ts can write a batch's combined decklist.png as a sibling of the
// Main/Extra/Side subfolders generateProxyForCard's own `subDirs` creates under here.
export const OUTPUT_DIR = path.join(app.getAppPath(), "output");

export interface CardArtwork {
	// The art image's own id (not the card's id) - distinguishes alternate arts of the same card.
	// Negative for the overframe pseudo-variant (see overframeArtworkId).
	id: number;
	dataUrl: string;
	// Set only on the overframe entry, if the card has one - picking it switches rendering to
	// overframe style (full-bleed art, no border; see buildRenderPlan's `overframe` option).
	isOverframe?: boolean;
}

export interface GenerateResult {
	outputPath: string;
	dataUrl: string;
	notes: string[];
}

function readLocalArtAsDataUrl(artPath: string): string {
	const buffer = fs.readFileSync(artPath);
	const ext = path.extname(artPath).slice(1).toLowerCase();
	const mime = ext === "png" ? "image/png" : "image/jpeg";

	return `data:${mime};base64,${buffer.toString("base64")}`;
}

// Every locally-downloaded art variant (including alternate arts) for the user to pick from, plus
// the card's overframe (if it has one) as one more pseudo-variant - picking it is what switches
// rendering to overframe style, rather than it being forced on automatically whenever present.
export function getCardArtworks(id: number): CardArtwork[] {
	const card = findCard(id);
	if (!card) throw new Error(`Card ${id} not found.`);
	const variants = listLocalArtVariants(card);
	const overframePath = resolveOverframePath(card);
	if (!variants.length && !overframePath) throw new Error(`No local artwork found for card ${id}.`);

	const artworks: CardArtwork[] = variants.map((v) => ({
		id: v.id,
		dataUrl: readLocalArtAsDataUrl(v.path),
	}));
	if (overframePath) {
		artworks.push({
			id: overframeArtworkId(card),
			dataUrl: readLocalArtAsDataUrl(overframePath),
			isOverframe: true,
		});
	}

	return artworks;
}

// `artId` picks which art variant to render with - defaults to the card's primary artwork, or its
// overframe when that's the only art available. Picking the overframe's id (overframeArtworkId)
// switches rendering to overframe style (full-bleed art, no border); `frameType` is ignored for
// it, since there's no border left to override.
// `fx` is the set of checked fx_* overlay layers (see listFxOptions) - unchecked means omitted.
// `subDirs` nests the output under `output/<subDirs[0]>/<subDirs[1]>/...` instead of `output/`
// directly - each segment is sanitized and joined separately (not a single pre-joined path), used
// by a .ydk batch export to keep one deck's proxies together, split into Main/Extra/Side
// subfolders (see ydkService.ts).
export async function generateProxyForCard(
	id: number,
	artId?: number,
	fx?: string[],
	frameType?: string,
	subDirs?: string[],
): Promise<GenerateResult> {
	const card = findCard(id);
	if (!card) throw new Error(`Card ${id} not found.`);
	const variants = listLocalArtVariants(card);
	const overframePath = resolveOverframePath(card);
	const useOverframe =
		!!overframePath &&
		(artId === overframeArtworkId(card) || (artId === undefined && !variants.length));

	let artPath: string;
	let filenameSuffix: string;
	if (useOverframe) {
		artPath = overframePath!;
		filenameSuffix = "-overframe";
	} else {
		const variant = artId !== undefined ? variants.find((v) => v.id === artId) : variants[0];
		if (!variant)
			throw new Error(
				`No local artwork found for card ${id}${artId !== undefined ? ` (art ${artId})` : ""}.`,
			);
		artPath = variant.path;
		filenameSuffix = variant.id !== variants[0]?.id ? `-art${variant.id}` : "";
	}

	const tree = loadPsdTree();
	const proxyCard = { ...toProxyCard(card, artPath), fx };
	if (frameType && !useOverframe) proxyCard.frameType = frameType;
	const { png, notes } = await renderProxyCard(
		tree,
		proxyCard,
		artPath,
		useOverframe ? overframePath : undefined,
	);

	const outputDir = subDirs?.length
		? path.join(OUTPUT_DIR, ...subDirs.map(sanitizeFilename))
		: OUTPUT_DIR;
	fs.mkdirSync(outputDir, { recursive: true });
	const outputPath = path.join(
		outputDir,
		`${card.id}-${sanitizeFilename(card.name)}${filenameSuffix}.png`,
	);
	fs.writeFileSync(outputPath, png);

	return { outputPath, dataUrl: `data:image/png;base64,${png.toString("base64")}`, notes };
}
