// Search index over the local card database, restricted to cards with downloaded artwork (see
// scripts/setupProjectData.ts), so any result the user picks is renderable without a network fetch.
import { listLocalArtVariants, loadCardDatabase, YgoCard } from "../scripts/cardData";

let cache: YgoCard[] | null = null;

function getCards(): YgoCard[] {
	if (!cache) {
		// At least one art variant (not necessarily the primary one) has to be downloaded locally for
		// a search result to be renderable at all.
		cache = loadCardDatabase().data.filter((card) => listLocalArtVariants(card).length > 0);
	}

	return cache;
}

// Forces the next search/lookup to re-read data/cardinfo.json from disk - call after writing a new
// entry to it (see customCardService.ts) so it's immediately searchable without an app restart.
export function invalidateCardCache(): void {
	cache = null;
}

export interface CardSummary {
	id: number;
	name: string;
	type: string;
}

function toSummary(card: YgoCard): CardSummary {
	return { id: card.id, name: card.name, type: card.type };
}

// Matches `query` against card id (exact/prefix) or name (exact/prefix/substring) in one box,
// ranking exact matches first - safe to share a box since ids are always numeric and names never are.
export function searchCards(query: string, limit = 25): CardSummary[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];

	const scored: { card: YgoCard; score: number }[] = [];
	for (const card of getCards()) {
		const idStr = String(card.id);
		const nameLower = card.name.toLowerCase();
		let score: number;
		if (idStr === q || nameLower === q) score = 0;
		else if (idStr.startsWith(q) || nameLower.startsWith(q)) score = 1;
		else if (nameLower.includes(q)) score = 2;
		else continue;
		scored.push({ card, score });
	}

	scored.sort((a, b) => a.score - b.score || a.card.name.localeCompare(b.card.name));

	// Collapse same-named cards (reprints/alt arts stored as separate entries) to their
	// best-scoring match - sorted above, so the first one seen per name wins.
	const seenNames = new Set<string>();
	const deduped: YgoCard[] = [];
	for (const { card } of scored) {
		const nameLower = card.name.toLowerCase();
		if (seenNames.has(nameLower)) continue;
		seenNames.add(nameLower);
		deduped.push(card);
	}

	return deduped.slice(0, limit).map(toSummary);
}

export function findCard(id: number): YgoCard | undefined {
	return getCards().find((card) => card.id === id);
}
