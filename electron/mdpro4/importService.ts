// Orchestrates a full MDPro4 resync: reads cards.cdb, decodes every card, resolves its artwork +
// overframe out of Picture/, and merges the result into this app's own data/cardinfo.json +
// card-artworks/ - exactly the same files/shapes scripts/setupProjectData.ts builds from the
// YGOPRODeck API, so every other part of the app (search, proxy generation, custom cards) keeps
// working unmodified regardless of which source a card came from.
import fs from "fs";
import path from "path";
import {
	ARTWORK_DIR,
	CardDatabase,
	CUSTOM_ID_START,
	loadCardDatabase,
	OVERFRAME_DIR,
	saveCardDatabase,
	YgoCard,
} from "../../scripts/cardData";
import { invalidateCardCache } from "../cardSearch";
import { readCardsCdb } from "./cdbReader";
import { decodeCard, DecodedCard } from "./cardDecoder";
import { loadCidMaps } from "./cidData";
import { artDir, cardsCdbPath, overframeDir, validateMdpro4Folder } from "./paths";

export interface SyncProgress {
	phase: "reading" | "art" | "overframes" | "done";
	current: number;
	total: number;
}

export interface SyncSummary {
	totalCards: number;
	added: number;
	updated: number;
	unchanged: number;
	artCopied: number;
	overframesCopied: number;
}

function toYgoCard(decoded: DecodedCard, altArtIds: number[]): YgoCard {
	return {
		id: decoded.id,
		name: decoded.name,
		type: decoded.type,
		frameType: decoded.frameType,
		atk: decoded.atk,
		def: decoded.def,
		level: decoded.level,
		attribute: decoded.attribute,
		race: decoded.race,
		scale: decoded.scale,
		linkval: decoded.linkval,
		linkmarkers: decoded.linkmarkers,
		card_images: [decoded.id, ...altArtIds].map((id) => ({ id })),
	};
}

// Copies `src` over `dest` only if `dest` doesn't already match it (mtime + size) - resyncing a
// mostly-unchanged library shouldn't rewrite thousands of identical files every time.
function copyIfChanged(src: string, dest: string): boolean {
	if (fs.existsSync(dest)) {
		const a = fs.statSync(src);
		const b = fs.statSync(dest);
		if (a.size === b.size && a.mtimeMs <= b.mtimeMs) return false;
	}

	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.copyFileSync(src, dest);

	return true;
}

export async function syncMdpro4(
	mdpro4Path: string,
	onProgress?: (progress: SyncProgress) => void,
): Promise<SyncSummary> {
	const validation = validateMdpro4Folder(mdpro4Path);
	if (!validation.valid) {
		throw new Error(
			`"${mdpro4Path}" doesn't look like an MDPro4 install (missing ${validation.missing.join(", ")}).`,
		);
	}

	onProgress?.({ phase: "reading", current: 0, total: 0 });
	const rows = readCardsCdb(cardsCdbPath(mdpro4Path));
	const cidMaps = loadCidMaps(mdpro4Path);

	const existingDb: CardDatabase = loadCardDatabase();
	const byId = new Map<number, YgoCard>(existingDb.data.map((card) => [card.id, card]));

	let added = 0;
	let updated = 0;
	let unchanged = 0;
	const sourceArtByCardId = new Map<number, number[]>(); // image ids to copy from Picture/Art/
	const overframeSourceByCardId = new Map<number, number>(); // Picture/OverFrame/<id>.png source id

	for (const row of rows) {
		if (row.id >= CUSTOM_ID_START) continue; // never produced by a real cdb, but guard anyway
		const decoded = decodeCard(row);
		if (!decoded) continue; // junk row - not Monster/Spell/Trap

		const altArtIds = cidMaps.altArtsByPasscode.get(decoded.id) ?? [];
		const card = toYgoCard(decoded, altArtIds);

		const previous = byId.get(card.id);
		if (!previous) added++;
		else if (JSON.stringify(previous) !== JSON.stringify(card)) updated++;
		else unchanged++;
		byId.set(card.id, card);

		sourceArtByCardId.set(card.id, [decoded.id, ...altArtIds]);
		const overframeId = cidMaps.overframeIdByPasscode.get(decoded.id);
		if (overframeId !== undefined) overframeSourceByCardId.set(card.id, overframeId);
	}

	// Custom cards (id >= CUSTOM_ID_START) were never touched above since no cdb row can produce
	// one - they just stay in `byId` untouched, same as every card a prior sync already added.
	saveCardDatabase({ data: [...byId.values()].sort((a, b) => a.id - b.id) });
	invalidateCardCache();

	let artCopied = 0;
	const artEntries = [...sourceArtByCardId.entries()];
	onProgress?.({ phase: "art", current: 0, total: artEntries.length });
	for (let i = 0; i < artEntries.length; i++) {
		const [, imageIds] = artEntries[i];
		for (const imageId of imageIds) {
			const src = path.join(artDir(mdpro4Path), `${imageId}.jpg`);
			if (!fs.existsSync(src)) continue; // card has no local art in this MDPro4 install
			if (copyIfChanged(src, path.join(ARTWORK_DIR, `${imageId}.jpg`))) artCopied++;
		}

		onProgress?.({ phase: "art", current: i + 1, total: artEntries.length });
	}

	let overframesCopied = 0;
	const overframeEntries = [...overframeSourceByCardId.entries()];
	onProgress?.({ phase: "overframes", current: 0, total: overframeEntries.length });
	for (let i = 0; i < overframeEntries.length; i++) {
		const [cardId, overframeId] = overframeEntries[i];
		const src = path.join(overframeDir(mdpro4Path), `${overframeId}.png`);
		if (fs.existsSync(src) && copyIfChanged(src, path.join(OVERFRAME_DIR, `${cardId}.png`))) {
			overframesCopied++;
		}

		onProgress?.({ phase: "overframes", current: i + 1, total: overframeEntries.length });
	}

	onProgress?.({ phase: "done", current: 1, total: 1 });

	return {
		totalCards: sourceArtByCardId.size,
		added,
		updated,
		unchanged,
		artCopied,
		overframesCopied,
	};
}
