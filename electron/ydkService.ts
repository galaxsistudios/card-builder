// .ydk deck import: parses Main/Extra/Side ids, resolves them against the local card
// database/artwork, and batch-renders the selected (card, art) pairs into output/<deck>/<section>/.
import fs from "fs";
import path from "path";
import { dialog } from "electron";
import { sanitizeFilename } from "../scripts/cardData";
import { findCard } from "./cardSearch";
import { buildDecklistImage } from "./decklistService";
import { deckDir } from "./mdpro4/paths";
import { getMdpro4Path } from "./mdpro4/settingsStore";
import { CardArtwork, generateProxyForCard, getCardArtworks, OUTPUT_DIR } from "./proxyService";

export type YdkSection = "main" | "extra" | "side";

const SECTION_LABELS: Record<YdkSection, string> = { main: "Main", extra: "Extra", side: "Side" };

export interface YdkCardEntry {
	id: number;
	name: string;
	type: string;
	// Every locally-downloaded art variant for this card, plus its overframe pseudo-variant if it
	// has one (see proxyService.getCardArtworks).
	artworks: CardArtwork[];
}

export interface YdkImportResult {
	// The .ydk file's own name (no extension) - also the output subfolder this batch saves into.
	deckName: string;
	// Cards deduped globally across sections; each is listed under the first section it appeared
	// in (sections are read Main, then Extra, then Side).
	main: YdkCardEntry[];
	extra: YdkCardEntry[];
	side: YdkCardEntry[];
	// Ids that don't resolve locally (missing from the card database, or no downloaded artwork).
	missingIds: number[];
	// The deck's true composition, per section, duplicates included (e.g. 3 copies of the same id
	// appear 3 times) - unlike main/extra/side above (each card listed once, for the art picker),
	// this is what generateYdkBatch needs to assemble a decklist.png matching the real deck.
	rawSections: Record<YdkSection, number[]>;
}

// Parses one numeric id per line under #main/#extra/!side markers. `dedupe` (on by default, for
// the UI's art-picker list) drops repeats globally across sections, keeping first-seen order per
// section; off (for rawSections, see importYdkFile) keeps every repeat as its own entry instead,
// preserving the deck's true card counts.
function parseYdkSections(contents: string, dedupe = true): Record<YdkSection, number[]> {
	const sections: Record<YdkSection, number[]> = { main: [], extra: [], side: [] };
	const seen = new Set<number>();
	let current: YdkSection | null = null;

	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		if (line === "#main") {
			current = "main";
			continue;
		}

		if (line === "#extra") {
			current = "extra";
			continue;
		}

		if (line === "!side") {
			current = "side";
			continue;
		}

		if (line.startsWith("#") || line.startsWith("!")) continue; // other comments
		if (!current || !/^\d+$/.test(line)) continue; // ids outside any section marker are ignored

		const id = Number(line);
		if (dedupe) {
			if (seen.has(id)) continue;
			seen.add(id);
		}

		sections[current].push(id);
	}

	return sections;
}

function resolveCards(ids: number[], missingIds: number[]): YdkCardEntry[] {
	const entries: YdkCardEntry[] = [];
	for (const id of ids) {
		// findCard only returns cards with a downloaded art variant (see cardSearch.ts), so a miss
		// here means unusable regardless of the reason.
		const card = findCard(id);
		if (!card) {
			missingIds.push(id);
			continue;
		}

		entries.push({
			id: card.id,
			name: card.name,
			type: card.type,
			artworks: getCardArtworks(id),
		});
	}

	return entries;
}

// Shared by both pickYdkFile (native file picker) and importMdpro4Deck (MDPro4's own Deck/
// folder) - everything past "here's a .ydk file's absolute path" is identical either way.
function importYdkFile(filePath: string): YdkImportResult {
	const contents = fs.readFileSync(filePath, "utf8");
	const sections = parseYdkSections(contents);

	const missingIds: number[] = [];
	const main = resolveCards(sections.main, missingIds);
	const extra = resolveCards(sections.extra, missingIds);
	const side = resolveCards(sections.side, missingIds);

	return {
		deckName: path.basename(filePath, path.extname(filePath)),
		main,
		extra,
		side,
		missingIds,
		rawSections: parseYdkSections(contents, false),
	};
}

// Opens a native "choose a .ydk file" dialog, resolves every id found, or returns null if the
// user cancels.
export async function pickYdkFile(): Promise<YdkImportResult | null> {
	const { canceled, filePaths } = await dialog.showOpenDialog({
		title: "Select a .ydk deck file",
		filters: [{ name: "YDK Deck", extensions: ["ydk"] }],
		properties: ["openFile"],
	});
	if (canceled || !filePaths[0]) return null;

	return importYdkFile(filePaths[0]);
}

// Every .ydk file sitting in the configured MDPro4 install's own Deck/ folder, by filename
// (including the .ydk extension - that's the id importMdpro4Deck expects back) - empty if MDPro4
// isn't configured/valid, or its Deck folder is empty, rather than throwing either way.
export function listMdpro4Decks(): string[] {
	const mdpro4Path = getMdpro4Path();
	if (!mdpro4Path) return [];

	try {
		return fs
			.readdirSync(deckDir(mdpro4Path))
			.filter((name) => name.toLowerCase().endsWith(".ydk"))
			.sort((a, b) => a.localeCompare(b));
	} catch {
		return [];
	}
}

// Imports one .ydk file straight out of MDPro4's Deck/ folder by filename, same as picking it
// through the native dialog would - `fileName` must be exactly one of listMdpro4Decks()'s own
// entries (checked, rather than trusted blindly, since it ends up in a filesystem path).
export function importMdpro4Deck(fileName: string): YdkImportResult {
	if (!listMdpro4Decks().includes(fileName)) {
		throw new Error(`"${fileName}" is not a deck in the configured MDPro4 install's Deck folder.`);
	}

	const mdpro4Path = getMdpro4Path();
	if (!mdpro4Path) throw new Error("No MDPro4 folder configured.");

	return importYdkFile(path.join(deckDir(mdpro4Path), fileName));
}

export interface YdkGenerateSelection {
	cardId: number;
	artId: number;
	section: YdkSection;
}

export interface YdkGenerateResult extends YdkGenerateSelection {
	outputPath: string;
	dataUrl: string;
}

export interface YdkGenerateFailure extends YdkGenerateSelection {
	error: string;
}

export interface YdkBatchResult {
	results: YdkGenerateResult[];
	failed: YdkGenerateFailure[];
	// The combined overview image (see decklistService.ts), written to
	// output/<deckName>/decklist.png - unset if there was nothing to put in one (every card
	// failed) or the layout step itself failed (reported in `decklistError` instead, without
	// failing the rest of an otherwise-successful batch).
	decklistImagePath?: string;
	decklistDataUrl?: string;
	decklistError?: string;
}

// Renders + saves each selected (card, art) pair into output/<deckName>/<Main|Extra|Side>/, then
// assembles output/<deckName>/decklist.png from the result - the deck's real composition
// (`rawSections`, duplicates included) laid out with each card's own generated image, repeated
// once per physical copy. A failure just lands that pair in `failed` instead of `results`,
// without aborting the batch; a card with no successful render anywhere is simply left out of the
// decklist image rather than failing it.
export async function generateYdkBatch(
	deckName: string,
	selections: YdkGenerateSelection[],
	rawSections: Record<YdkSection, number[]>,
): Promise<YdkBatchResult> {
	// Dedupe (cardId, artId) pairs so the same art is never rendered/saved twice, even if the
	// caller's selection list repeats one.
	const seen = new Set<string>();
	const unique = selections.filter(({ cardId, artId }) => {
		const key = `${cardId}:${artId}`;
		if (seen.has(key)) return false;
		seen.add(key);

		return true;
	});

	const results: YdkGenerateResult[] = [];
	const failed: YdkGenerateFailure[] = [];
	for (const { cardId, artId, section } of unique) {
		try {
			const generated = await generateProxyForCard(cardId, artId, undefined, undefined, [
				deckName,
				SECTION_LABELS[section],
			]);
			results.push({
				cardId,
				artId,
				section,
				outputPath: generated.outputPath,
				dataUrl: generated.dataUrl,
			});
		} catch (err) {
			failed.push({ cardId, artId, section, error: (err as Error).message });
		}
	}

	// One representative generated image per card id - whichever of its selected arts rendered
	// first - reused for every physical copy of that card in the decklist image below.
	const imageByCardId = new Map<number, string>();
	for (const result of results) {
		if (!imageByCardId.has(result.cardId)) imageByCardId.set(result.cardId, result.outputPath);
	}

	const toImagePaths = (ids: number[]): string[] =>
		ids.map((id) => imageByCardId.get(id)).filter((p): p is string => !!p);

	const batchResult: YdkBatchResult = { results, failed };
	try {
		const decklistImagePath = path.join(OUTPUT_DIR, sanitizeFilename(deckName), "decklist.png");
		await buildDecklistImage(
			{
				main: toImagePaths(rawSections.main),
				extra: toImagePaths(rawSections.extra),
				side: toImagePaths(rawSections.side),
			},
			decklistImagePath,
		);
		batchResult.decklistImagePath = decklistImagePath;
		batchResult.decklistDataUrl = `data:image/png;base64,${fs.readFileSync(decklistImagePath).toString("base64")}`;
	} catch (err) {
		batchResult.decklistError = (err as Error).message;
	}

	return batchResult;
}
