// Decodes raw `datas`/`texts` rows from MDPro4's cards.cdb (a standard ygopro-core SQLite `.cdb`
// file - same bitmask layout `scripts/importRushDuelCards.ts` already decodes for Rush Duel, minus
// the Rush-exclusive bits/races, since this only ever reads the mainline TCG/OCG `cards.cdb` -
// Rush lives in a separate `rush_cards.cdb` this app never touches) into this app's own
// `YgoCard` shape (see scripts/cardData.ts).
//
// Bit layout confirmed against real rows pulled straight out of a live MDPro4 install: pendulum
// scale is packed into `level` as `(lscale << 24) | (rscale << 16) | level` (verified against
// Odd-Eyes Pendulum Dragon: raw level 67371015 -> scale 4/4, level 7), and Link markers are packed
// into `def` as a bitmask (verified against Decode Talker: raw def 133 -> Top + Bottom-Left +
// Bottom-Right, its real arrows).
export interface CdbCardRow {
	id: number;
	name: string;
	desc: string;
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

export interface DecodedCard {
	id: number;
	name: string;
	type: string;
	frameType: string;
	atk: number | null;
	def: number | null;
	level: number | null;
	race: string | null;
	attribute: string | null;
	scale: number | null;
	linkval: number | null;
	linkmarkers: string[] | null;
}

const TYPE_MONSTER = 0x1;
const TYPE_SPELL = 0x2;
const TYPE_TRAP = 0x4;
const TYPE_EFFECT = 0x20;
const TYPE_FUSION = 0x40;
const TYPE_RITUAL = 0x80;
const TYPE_SPIRIT = 0x200;
const TYPE_UNION = 0x400;
const TYPE_GEMINI = 0x800;
const TYPE_TUNER = 0x1000;
const TYPE_SYNCHRO = 0x2000;
const TYPE_TOKEN = 0x4000;
const TYPE_QUICKPLAY = 0x10000;
const TYPE_CONTINUOUS = 0x20000;
const TYPE_EQUIP = 0x40000;
const TYPE_FIELD = 0x80000;
const TYPE_COUNTER = 0x100000;
const TYPE_FLIP = 0x200000;
const TYPE_TOON = 0x400000;
const TYPE_XYZ = 0x800000;
const TYPE_PENDULUM = 0x1000000;
const TYPE_LINK = 0x4000000;

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
];

const LINK_MARKERS: [number, string][] = [
	[0x001, "Bottom-Left"],
	[0x002, "Bottom"],
	[0x004, "Bottom-Right"],
	[0x008, "Left"],
	[0x020, "Right"],
	[0x040, "Top-Left"],
	[0x080, "Top"],
	[0x100, "Top-Right"],
];

function decodeAttribute(bits: number): string | null {
	return ATTRIBUTES.find(([bit]) => (bits & bit) !== 0)?.[1] ?? null;
}

function decodeRace(bits: number): string | null {
	return RACES.find(([bit]) => (bits & bit) !== 0)?.[1] ?? null;
}

function decodeLinkMarkers(bits: number): string[] {
	return LINK_MARKERS.filter(([bit]) => (bits & bit) !== 0).map(([, name]) => name);
}

// A raw -1/-2 "variable stat" sentinel (both show up in cards.cdb depending on card) becomes
// `null`, same as this app's own ProxyCard/customCardService convention - the renderer already
// draws `null` as "?" (see src/cardProxy/renderPlan.ts's formatStat).
function normalizeStat(value: number): number | null {
	return value < 0 ? null : value;
}

// The only three DIVINE-attribute monsters in the entire game, across every one of their print
// variants (MDPro4 ships several ids per God card) - there's no dedicated bitmask flag for them,
// so this is the one place a name check is the right tool.
function godCardFrame(name: string): string | null {
	if (name.includes("Obelisk")) return "obelisk";
	if (name.includes("Winged Dragon of Ra")) return "ra";
	if (name.includes("Slifer")) return "slifer";

	return null;
}

function classifyMonster(
	typeBits: number,
	attribute: string | null,
	name: string,
): {
	type: string;
	frameType: string;
} {
	if (attribute === "DIVINE") {
		const godFrame = godCardFrame(name);
		if (godFrame) return { type: "Effect Monster", frameType: godFrame };
	}

	if (typeBits & TYPE_TOKEN) return { type: "Token", frameType: "token" };

	const isEffect = (typeBits & TYPE_EFFECT) !== 0;
	const isPendulum = (typeBits & TYPE_PENDULUM) !== 0;
	const pendulumSuffix = isPendulum ? "_pendulum" : "";
	// Pendulum can combo with every category below except Link (impossible in the real game) -
	// matches this app's own documented vocabulary (see README.md's "Pendulum Effect Monster").
	const pendulumPrefix = isPendulum ? "Pendulum " : "";

	// Extra Deck summoning categories never append "Effect" in this app's existing vocabulary
	// (see card-template.psd's frame names / BORDER_NAME_CANDIDATES) - effect is assumed.
	if (typeBits & TYPE_LINK) return { type: "Link Monster", frameType: "link" };
	if (typeBits & TYPE_XYZ) {
		return { type: `${pendulumPrefix}XYZ Monster`, frameType: `xyz${pendulumSuffix}` };
	}

	if (typeBits & TYPE_SYNCHRO) {
		const tunerPrefix = typeBits & TYPE_TUNER ? "Tuner " : "";

		return {
			type: `${pendulumPrefix}Synchro ${tunerPrefix}Monster`,
			frameType: `synchro${pendulumSuffix}`,
		};
	}

	if (typeBits & TYPE_RITUAL) {
		return {
			type: `${pendulumPrefix}Ritual ${isEffect ? "Effect " : ""}Monster`,
			frameType: `ritual${pendulumSuffix}`,
		};
	}

	if (typeBits & TYPE_FUSION) {
		return { type: `${pendulumPrefix}Fusion Monster`, frameType: `fusion${pendulumSuffix}` };
	}

	// Normal/Effect base, plus whichever single sub-category modifier applies (real cards never
	// combine more than one of these) and a "Tuner" prefix that can stack on top of any of them.
	const modifier =
		typeBits & TYPE_SPIRIT
			? "Spirit"
			: typeBits & TYPE_UNION
				? "Union"
				: typeBits & TYPE_TOON
					? "Toon"
					: typeBits & TYPE_GEMINI
						? "Gemini"
						: typeBits & TYPE_FLIP
							? "Flip"
							: null;
	const tunerPrefix = typeBits & TYPE_TUNER ? "Tuner " : "";
	const base = modifier ?? (isEffect ? "Effect" : "Normal");
	const effectSuffix = isEffect && modifier ? " Effect" : "";

	return {
		type: `${pendulumPrefix}${tunerPrefix}${base}${effectSuffix} Monster`,
		frameType: `${isEffect ? "effect" : "normal"}${pendulumSuffix}`,
	};
}

function classifySpellOrTrap(typeBits: number): { type: string; frameType: string; race: string } {
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
		? { type: "Trap Card", frameType: "trap", race: subtype }
		: { type: "Spell Card", frameType: "spell", race: subtype };
}

// Returns null for junk/non-card rows (type matches none of Monster/Spell/Trap), same as
// importRushDuelCards.ts skips for cards-rush.db.
export function decodeCard(row: CdbCardRow): DecodedCard | null {
	const isMonster = (row.type & TYPE_MONSTER) !== 0;
	const isSpellOrTrap = (row.type & (TYPE_SPELL | TYPE_TRAP)) !== 0;
	if (!isMonster && !isSpellOrTrap) return null;

	if (isSpellOrTrap) {
		const { type, frameType, race } = classifySpellOrTrap(row.type);

		return {
			id: row.id,
			name: row.name,
			type,
			frameType,
			atk: null,
			def: null,
			level: null,
			race,
			attribute: null,
			scale: null,
			linkval: null,
			linkmarkers: null,
		};
	}

	const attribute = decodeAttribute(row.attribute);
	const { type, frameType } = classifyMonster(row.type, attribute, row.name);
	const isLink = (row.type & TYPE_LINK) !== 0;
	const isPendulum = (row.type & TYPE_PENDULUM) !== 0;

	let level: number | null = row.level;
	let scale: number | null = null;
	if (isPendulum) {
		scale = (row.level >> 24) & 0xff;
		level = row.level & 0xffff;
	}

	return {
		id: row.id,
		name: row.name,
		type,
		frameType,
		atk: normalizeStat(row.atk),
		def: isLink ? null : normalizeStat(row.def),
		level: isLink ? null : level,
		race: decodeRace(row.race),
		attribute,
		scale,
		linkval: isLink ? level : null,
		linkmarkers: isLink ? decodeLinkMarkers(row.def) : null,
	};
}
