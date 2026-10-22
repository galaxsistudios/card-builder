/**
 * Imports every card from `backend/resources/cards-rush.db` (a standard YGOPro-format `.cdb` file -
 * `datas`/`texts` tables - containing the Rush Duel card pool) into `cards-official.db`, converting
 * each row from the raw bitmask/int encoding YGOPro's `.cdb` format uses into this app's established
 * `cards` table conventions (the same shape `scripts/import_local_card_imports.ts` and
 * `scripts/importYgoProDeck.ts` produce).
 *
 * Every imported card gets `rushDuel = true`; `rushLegend` is set for Legend cards (source `ot` =
 * 1536 - e.g. "Blue-Eyes White Dragon (Rush)", "Dark Magician (Rush)").
 *
 * Rush Duel's card frame system is simpler than - and visually distinct from - the mainline TCG/OCG
 * one this DB was built around (no Tuner/Flip/Spirit/Toon/Union/Gemini/Synchro/Xyz/Link/Pendulum, but
 * it does add a new "Maximum Monster" frame). So rather than force these through
 * `cardClassification.ts`'s mainline `classifyMonsterType`/`deriveFrameTypeFromType` (which would
 * mislabel e.g. a non-effect Ritual Monster, and would collide Rush Duel's Fusion/Ritual/Maximum
 * borders with the mainline ones under the same `frame_type` keys), this file classifies Rush cards
 * on its own using the raw `.cdb` bitmasks directly, into `rush_normal`/`rush_effect`/`rush_fusion`/
 * `rush_ritual`/`rush_maximum`/`rush_spell`/`rush_trap` `frame_type` keys - matching the existing
 * `backend/resources/card-boarders/sprites/card-rush-*.png` border art. `type`/`race`/`attribute`
 * strings still follow the same vocabulary as the rest of `cards-official.db` (e.g. "Effect Monster",
 * "Dragon", "DARK") so shared UI (type line, filters, etc.) keeps working unmodified.
 *
 * `.cdb` bit layout confirmed against `ocgapi_constants.h` (edo9300/ygopro-core, which is what EDOPro/
 * Rush Duel forks use) and cross-checked against real card text in `cards-rush.db` itself (e.g.
 * "Metarion Ashurastar"'s own effect text calls itself a "Cyborg Type monster", confirming
 * race 0x4000000 = Cyborg; "Solciere, the Radiant Skysavior" similarly confirms 0x40000000 =
 * Celestial Warrior).
 *
 * `alias` (718 rows) turned out to point at the *mainline* (non-Rush) printing's real passcode - e.g.
 * "Blue-Eyes White Dragon (Rush)"'s `alias` is Blue-Eyes White Dragon's real TCG/OCG id - not another
 * row in this file. That's a different relationship than this DB's `original_alias` (which marks
 * alt-art variants of the *same* card within the *same* table, and drives alt-art delete/Token-lookup
 * logic in `routes/cards.ts`), so it's intentionally NOT written to `original_alias` - every Rush card
 * imports as its own canonical entry. The raw `alias` is preserved in `rawData` for reference.
 *
 * A single junk row (id 160022200, name/desc both "OuTerverSe", `type` = 0 - i.e. none of
 * MONSTER/SPELL/TRAP set) is skipped as not a real card.
 *
 * Usage (run from `backend/`):
 *   npm run cards-rush:import          # dry run, reports what would be imported
 *   npm run cards-rush:import:apply    # writes to cards-official.db
 */
import path from "path";
import Database from "better-sqlite3";
import { openCardsDb, upsertCard, CardRecord } from "../backend/src/db/cardsDb";
import { normalizeStat } from "../backend/src/utils/cardClassification";

const CARDS_RUSH_DB_PATH = path.join(__dirname, "..", "backend", "resources", "cards-rush.db");

// Bit layout from ocgapi_constants.h (edo9300/ygopro-core).
const TYPE_MONSTER = 0x1;
const TYPE_SPELL = 0x2;
const TYPE_TRAP = 0x4;
const TYPE_EFFECT = 0x20;
const TYPE_FUSION = 0x40;
const TYPE_RITUAL = 0x80;
const TYPE_MAXIMUM = 0x8000;
const TYPE_QUICKPLAY = 0x10000;
const TYPE_CONTINUOUS = 0x20000;
const TYPE_EQUIP = 0x40000;
const TYPE_FIELD = 0x80000;
const TYPE_COUNTER = 0x100000;

const RUSH_LEGEND_OT = 1536;

const ATTRIBUTES: [number, string][] = [
	[0x01, "EARTH"],
	[0x02, "WATER"],
	[0x04, "FIRE"],
	[0x08, "WIND"],
	[0x10, "LIGHT"],
	[0x20, "DARK"],
	[0x40, "DIVINE"],
];

const RACES: [number, string][] = [
	[0x1, "Warrior"],
	[0x2, "Spellcaster"],
	[0x4, "Fairy"],
	[0x8, "Fiend"],
	[0x10, "Zombie"],
	[0x20, "Machine"],
	[0x40, "Aqua"],
	[0x80, "Pyro"],
	[0x100, "Rock"],
	[0x200, "Winged Beast"],
	[0x400, "Plant"],
	[0x800, "Insect"],
	[0x1000, "Thunder"],
	[0x2000, "Dragon"],
	[0x4000, "Beast"],
	[0x8000, "Beast-Warrior"],
	[0x10000, "Dinosaur"],
	[0x20000, "Fish"],
	[0x40000, "Sea Serpent"],
	[0x80000, "Reptile"],
	[0x100000, "Psychic"],
	[0x200000, "Divine-Beast"],
	[0x400000, "Creator God"],
	[0x800000, "Wyrm"],
	[0x1000000, "Cyberse"],
	[0x2000000, "Illusion"],
	// Rush Duel-exclusive races (no mainline equivalent yet in cards-official.db).
	[0x4000000, "Cyborg"],
	[0x8000000, "Magical Knight"],
	[0x10000000, "High Dragon"],
	[0x20000000, "Omega Psychic"],
	[0x40000000, "Celestial Warrior"],
	[0x80000000, "Galaxy"],
];

interface RushDatasRow {
	id: number;
	ot: number;
	alias: number;
	setcode: number;
	type: number;
	atk: number;
	def: number;
	level: number;
	race: number;
	attribute: number;
	category: number;
}

interface RushTextsRow {
	id: number;
	name: string;
	desc: string;
}

function decodeAttribute(bits: number): string | null {
	const match = ATTRIBUTES.find(([bit]) => (bits & bit) !== 0);

	return match ? match[1] : null;
}

function decodeRace(bits: number): string | null {
	const match = RACES.find(([bit]) => (bits & bit) !== 0);

	return match ? match[1] : null;
}

function classifyRushMonster(typeBits: number): { type: string; frameType: string } {
	const isEffect = (typeBits & TYPE_EFFECT) !== 0;
	if (typeBits & TYPE_MAXIMUM) return { type: "Maximum Monster", frameType: "rush_maximum" };
	if (typeBits & TYPE_FUSION) return { type: "Fusion Monster", frameType: "rush_fusion" };
	if (typeBits & TYPE_RITUAL) {
		return isEffect
			? { type: "Ritual Effect Monster", frameType: "rush_ritual" }
			: { type: "Ritual Monster", frameType: "rush_ritual" };
	}

	return isEffect
		? { type: "Effect Monster", frameType: "rush_effect" }
		: { type: "Normal Monster", frameType: "rush_normal" };
}

function classifyRushSpellTrap(typeBits: number): {
	type: string;
	frameType: string;
	race: string;
} {
	const isTrap = (typeBits & TYPE_TRAP) !== 0;
	const subtype =
		typeBits & TYPE_QUICKPLAY
			? "Quick-Play"
			: typeBits & TYPE_CONTINUOUS
				? "Continuous"
				: typeBits & TYPE_EQUIP
					? "Equip"
					: typeBits & TYPE_FIELD
						? "Field"
						: typeBits & TYPE_COUNTER
							? "Counter"
							: typeBits & TYPE_RITUAL
								? "Ritual"
								: "Normal";

	return isTrap
		? { type: "Trap Card", frameType: "rush_trap", race: subtype }
		: { type: "Spell Card", frameType: "rush_spell", race: subtype };
}

function buildRecord(
	datas: RushDatasRow,
	texts: RushTextsRow,
): Omit<CardRecord, "id"> & { id: number } {
	const isMonster = (datas.type & TYPE_MONSTER) !== 0;
	const isSpellOrTrap = (datas.type & (TYPE_SPELL | TYPE_TRAP)) !== 0;

	let type: string | null = null;
	let frameType: string | null = null;
	let race: string | null = null;

	if (isMonster) {
		({ type, frameType } = classifyRushMonster(datas.type));
		race = decodeRace(datas.race);
	} else if (isSpellOrTrap) {
		({ type, frameType, race } = classifyRushSpellTrap(datas.type));
	}

	return {
		id: datas.id,
		name: texts.name,
		type,
		frameType,
		description: texts.desc || null,
		atk: isSpellOrTrap ? null : normalizeStat(datas.atk),
		def: isSpellOrTrap ? null : normalizeStat(datas.def),
		level: isSpellOrTrap ? null : datas.level || null,
		race,
		attribute: isSpellOrTrap ? null : decodeAttribute(datas.attribute),
		archetype: null,
		scale: null,
		linkValue: null,
		linkMarkers: null,
		imageUrl: null,
		imageLocalPath: null,
		artUrl: null,
		artLocalPath: null,
		originalAlias: null,
		status: "TCG/OCG",
		source: "RushDuel",
		rawData: { datas, texts },
		rushDuel: true,
		rushLegend: datas.ot === RUSH_LEGEND_OT,
	};
}

function main(): void {
	const apply = process.argv.includes("--apply");

	const rushDb = new Database(CARDS_RUSH_DB_PATH, { readonly: true });
	const rows = rushDb
		.prepare(
			`SELECT d.id, d.ot, d.alias, d.setcode, d.type, d.atk, d.def, d.level, d.race, d.attribute, d.category,
              t.name, t.desc
       FROM datas d JOIN texts t ON t.id = d.id`,
		)
		.all() as (RushDatasRow & RushTextsRow)[];
	rushDb.close();

	const records: (Omit<CardRecord, "id"> & { id: number })[] = [];
	let skippedJunk = 0;

	for (const row of rows) {
		if ((row.type & (TYPE_MONSTER | TYPE_SPELL | TYPE_TRAP)) === 0) {
			skippedJunk++;
			continue;
		}

		records.push(buildRecord(row, row));
	}

	const legendCount = records.filter((r) => r.rushLegend).length;
	const monsterCount = records.filter(
		(r) =>
			r.frameType?.startsWith("rush_") &&
			r.frameType !== "rush_spell" &&
			r.frameType !== "rush_trap",
	).length;
	const maximumCount = records.filter((r) => r.frameType === "rush_maximum").length;

	console.log(
		`Found ${rows.length} row(s) in cards-rush.db, ${skippedJunk} skipped as non-card (id/name below):`,
	);
	if (skippedJunk > 0) {
		for (const row of rows) {
			if ((row.type & (TYPE_MONSTER | TYPE_SPELL | TYPE_TRAP)) === 0) {
				console.log(`  #${row.id} ${row.name}`);
			}
		}
	}

	console.log(
		`${records.length} card(s) to import: ${monsterCount} monster(s) (incl. ${maximumCount} Maximum), ${legendCount} Legend(s).`,
	);

	if (!apply) {
		console.log("\nDry run only - pass --apply to write these into cards-official.db.");

		return;
	}

	const db = openCardsDb();
	try {
		let imported = 0;
		for (const record of records) {
			try {
				upsertCard(db, record);
				imported++;
				console.log(`✓ ${record.id} ${record.name}`);
			} catch (err) {
				console.error(`✗ Failed to upsert card ${record.id} "${record.name}":`, err);
			}
		}

		console.log(`\nDone. Imported/updated ${imported}/${records.length} card(s).`);
	} finally {
		db.close();
	}
}

main();
