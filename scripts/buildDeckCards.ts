// Renders proxy PNGs for every card in one or more .ydk deck files (from ydk-files/ by default),
// one output folder per deck split into main/extra/side sub-folders, with each unique card
// rendered once per section it appears in (duplicate copies within a section only render once).
//
// Usage:
//   npm run build-deck                              # every *.ydk file in ydk-files/
//   npm run build-deck -- --file "ydk-files/x.ydk"   # a single deck file
//   npm run build-deck -- --dir other-ydk-folder     # look for *.ydk files elsewhere
//   npm run build-deck -- --out-dir output/decks     # change the output base folder
import fs from "fs";
import path from "path";
import { loadPsdTree, PsdTree, renderProxyCard } from "../src/cardProxyGenerator";
import { ProxyCard } from "../src/types";
import {
	CardDatabase,
	DATA_FILE,
	loadCardDatabase,
	resolveArtPath,
	resolveOverframePath,
	sanitizeFilename,
	toProxyCard,
	YgoCard,
} from "./cardData";

const YDK_DIR = path.join(__dirname, "..", "ydk-files");
const DEFAULT_OUTPUT_DIR = path.join(__dirname, "..", "output", "cards");

const SECTIONS = ["main", "extra", "side"] as const;
type Section = (typeof SECTIONS)[number];

interface Args {
	dataFile: string;
	ydkDir: string;
	outDir: string;
	file?: string;
}

function parseArgs(): Args {
	const raw = process.argv.slice(2);
	const args: Args = { dataFile: DATA_FILE, ydkDir: YDK_DIR, outDir: DEFAULT_OUTPUT_DIR };
	for (let i = 0; i < raw.length; i++) {
		const a = raw[i];
		if (a === "--file") args.file = path.resolve(raw[++i]);
		else if (a === "--dir") args.ydkDir = path.resolve(raw[++i]);
		else if (a === "--data") args.dataFile = path.resolve(raw[++i]);
		else if (a === "--out-dir") args.outDir = path.resolve(raw[++i]);
		else console.warn(`Unknown argument: ${a}`);
	}

	return args;
}

// Parses a .ydk file's #main/#extra/!side sections into deduplicated id lists - only distinct
// cards matter for rendering, so multi-copy ordering is dropped.
function parseYdk(filePath: string): Record<Section, number[]> {
	const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
	const raw: Record<Section, number[]> = { main: [], extra: [], side: [] };
	let current: Section | null = null;

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) continue;
		const lower = line.toLowerCase();
		if (lower === "#main") {
			current = "main";
			continue;
		}

		if (lower === "#extra") {
			current = "extra";
			continue;
		}

		if (lower === "!side") {
			current = "side";
			continue;
		}

		if (line.startsWith("#") || line.startsWith("!")) continue; // other comments/markers
		if (!current) continue;
		const id = Number(line);
		if (Number.isFinite(id)) raw[current].push(id);
	}

	const deduped: Record<Section, number[]> = { main: [], extra: [], side: [] };
	for (const section of SECTIONS) deduped[section] = [...new Set(raw[section])];

	return deduped;
}

async function renderSection(
	tree: PsdTree,
	cardsById: Map<number, YgoCard>,
	ids: number[],
	outDir: string,
	deckName: string,
	section: Section,
): Promise<{ rendered: number; skipped: number; failed: number }> {
	let rendered = 0;
	let skipped = 0;
	let failed = 0;
	if (!ids.length) return { rendered, skipped, failed };

	fs.mkdirSync(outDir, { recursive: true });

	for (const id of ids) {
		const card = cardsById.get(id);
		if (!card) {
			console.warn(
				`- [${deckName}/${section}] skip ${id}: not found in ${path.basename(DATA_FILE)}.`,
			);
			skipped++;
			continue;
		}

		const artPath = resolveArtPath(card);
		if (!artPath) {
			console.warn(`- [${deckName}/${section}] skip ${id} "${card.name}": no downloaded artwork.`);
			skipped++;
			continue;
		}

		const proxyCard: ProxyCard = toProxyCard(card, artPath);
		const overframePath = resolveOverframePath(card);
		const outPath = path.join(outDir, `${card.id} - ${sanitizeFilename(card.name)}.png`);
		try {
			const { png, notes } = await renderProxyCard(tree, proxyCard, artPath, overframePath);
			if (notes.length)
				console.warn(`  ⚠️  [${deckName}/${section}] ${card.name}: ${notes.join(" | ")}`);
			fs.writeFileSync(outPath, png);
			rendered++;
		} catch (err) {
			console.error(
				`✗ [${deckName}/${section}] ${card.id} "${card.name}": ${(err as Error).message}`,
			);
			failed++;
		}
	}

	return { rendered, skipped, failed };
}

async function main(): Promise<void> {
	const args = parseArgs();

	const ydkFiles = args.file
		? [args.file]
		: fs
				.readdirSync(args.ydkDir)
				.filter((f) => f.toLowerCase().endsWith(".ydk"))
				.map((f) => path.join(args.ydkDir, f));

	if (!ydkFiles.length) {
		console.warn(`No .ydk files found in ${path.relative(process.cwd(), args.ydkDir)}.`);

		return;
	}

	const database: CardDatabase = loadCardDatabase(args.dataFile);
	const cardsById = new Map(database.data.map((c) => [c.id, c]));

	console.log("… loading PSD template");
	const tree = loadPsdTree();

	for (const ydkFile of ydkFiles) {
		const deckName = sanitizeFilename(path.basename(ydkFile, path.extname(ydkFile)));
		const sections = parseYdk(ydkFile);
		const deckOutDir = path.join(args.outDir, deckName);

		console.log(
			`\n=== ${deckName} (main=${sections.main.length} extra=${sections.extra.length} side=${sections.side.length}) ===`,
		);

		let rendered = 0;
		let skipped = 0;
		let failed = 0;
		for (const section of SECTIONS) {
			const result = await renderSection(
				tree,
				cardsById,
				sections[section],
				path.join(deckOutDir, section),
				deckName,
				section,
			);
			rendered += result.rendered;
			skipped += result.skipped;
			failed += result.failed;
		}

		console.log(
			`✓ ${deckName}: ${rendered} rendered, ${skipped} skipped, ${failed} failed -> ${path.relative(process.cwd(), deckOutDir)}`,
		);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
