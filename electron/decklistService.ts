// Composites a batch of already-generated proxy PNGs into one combined "decklist.png" overview -
// Main deck in rows of 10, Extra and Side each in their own single row (their own 15-card
// deck-building max already fits "1 row" exactly). Knows nothing about cards/ids - just lays out
// and stacks whatever image paths it's handed, repeats included, so callers (ydkService.ts) own
// deciding which image represents which card and how many times it appears.
import fs from "fs";
import path from "path";
import sharp from "sharp";

// Proxies render at the PSD's native 704x1024 canvas (see src/cardProxy/index.ts) - way too large
// to lay 10-15 across in an overview image, so each one is downscaled to this width here,
// preserving that same aspect ratio.
const CARD_W = 180;
const CARD_H = Math.round((CARD_W * 1024) / 704);
const GAP = 10;
const MAIN_ROW_SIZE = 10;
// Every row (Main's 10-wide rows, and Extra/Side's single rows once they start overlapping past
// 10 cards) spans this same width, so the whole image lines up into one consistent column.
const ROW_WIDTH = CARD_W * MAIN_ROW_SIZE + GAP * (MAIN_ROW_SIZE - 1);
const SECTION_GAP = Math.round(CARD_H * 0.35);

interface PlacedCard {
	imagePath: string;
	left: number;
	top: number;
}

// Left offsets for one row of `count` cards, left-aligned starting at x=0: normal (CARD_W + GAP)
// spacing up to MAIN_ROW_SIZE cards. Past that - only possible for Extra/Side, up to their own
// 15-card max - cards overlap so the row still spans exactly ROW_WIDTH rather than running wider.
function rowOffsets(count: number): number[] {
	if (count === 0) return [];
	if (count <= MAIN_ROW_SIZE) return Array.from({ length: count }, (_, i) => i * (CARD_W + GAP));

	const step = (ROW_WIDTH - CARD_W) / (count - 1);

	return Array.from({ length: count }, (_, i) => Math.round(i * step));
}

// Main deck: chunked into rows of up to MAIN_ROW_SIZE - a row here never exceeds that, so
// rowOffsets never has to overlap it.
function placeMainRows(imagePaths: string[], startTop: number, placed: PlacedCard[]): number {
	let top = startTop;
	for (let i = 0; i < imagePaths.length; i += MAIN_ROW_SIZE) {
		const row = imagePaths.slice(i, i + MAIN_ROW_SIZE);
		const offsets = rowOffsets(row.length);
		row.forEach((imagePath, idx) => placed.push({ imagePath, left: offsets[idx], top }));
		top += CARD_H + GAP;
	}

	return top;
}

// Extra/Side: always exactly one row, overlapping past 10 cards via rowOffsets. A no-op (returns
// `top` unchanged) when the section is empty, so callers can chain sections without special-casing
// an absent Extra or Side deck.
function placeSingleRow(imagePaths: string[], top: number, placed: PlacedCard[]): number {
	if (!imagePaths.length) return top;
	const offsets = rowOffsets(imagePaths.length);
	imagePaths.forEach((imagePath, idx) => placed.push({ imagePath, left: offsets[idx], top }));

	return top + CARD_H + GAP;
}

export interface DecklistSections {
	// Ordered image paths per section, repeats included (the same path appears once per physical
	// copy of that card in the deck).
	main: string[];
	extra: string[];
	side: string[];
}

// Composites `sections` onto one transparent-background canvas and writes it to `outputPath`.
export async function buildDecklistImage(
	sections: DecklistSections,
	outputPath: string,
): Promise<void> {
	const placed: PlacedCard[] = [];
	let top = placeMainRows(sections.main, 0, placed);
	if (sections.main.length) top += SECTION_GAP - GAP;
	top = placeSingleRow(sections.extra, top, placed);
	if (sections.extra.length) top += SECTION_GAP - GAP;
	top = placeSingleRow(sections.side, top, placed);

	if (!placed.length) {
		throw new Error("No cards to lay out - nothing to build a decklist image from.");
	}

	// Resize each distinct source image once, then reuse the buffer for every copy of that card.
	const resizedByPath = new Map<string, Buffer>();
	for (const { imagePath } of placed) {
		if (resizedByPath.has(imagePath)) continue;
		resizedByPath.set(imagePath, await sharp(imagePath).resize(CARD_W, CARD_H).png().toBuffer());
	}

	const png = await sharp({
		create: {
			width: ROW_WIDTH,
			height: top - GAP,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.composite(
			placed.map(({ imagePath, left, top: cardTop }) => ({
				input: resizedByPath.get(imagePath)!,
				left,
				top: cardTop,
			})),
		)
		.png()
		.toBuffer();

	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, png);
}
