import { OverlayOptions } from "sharp";
import { ArtBox, TextFieldStyle } from "./types";

export const ART_BOX: Record<string, ArtBox> = {
	normal: { left: 89, top: 191, width: 530, height: 530 },
	pendulum: { left: 50, top: 185, width: 605, height: 575 },
};

export const LAYER_PATHS = {
	contentRoot: ["Folder 1", "Card"],
	art: ["Art"],
	overframeArtworkPlaceholder: ["Overframe Artwork"],
	border: ["Frames", "Border", "Frame"],
	overlays: ["Overlays"],
	overlaysMonster: ["Monster Parts", "Monster"],
	overlaysSpellTrap: ["Spell/Trap Types", "Spell/Trap", "Spell Trap", "SpellTrap"],
	monsterAttribute: ["Attributes", "Attribute"],
	monsterStatsGroup: ["Stars"],
	monsterLevel: ["Level"],
	monsterMinusLevel: ["Minus Level"],
	monsterRank: ["Rank"],
	monsterRank13: ["rank-13", "Rank 13"],
	monsterAtkDefGroup: ["ATK / DEF", "ATK/DEF", "ATK DEF"],
	monsterAtkValue: ["atkValue", "ATK Value"],
	monsterDefValue: ["defValue", "DEF Value"],
	monsterAtkValueUnknown: ["atkValue=?", "ATK Value =?", "ATK Value Unknown"],
	monsterDefValueUnknown: ["defValue=?", "DEF Value =?", "DEF Value Unknown"],
	monsterDefLabel: ["DEF/", "DEF"],
	monsterOverframeGroup: ["Overframe"],
	overframeFrames: ["Frames copy", "Frames Copy"],
	overframeEffBox: ["Eff Box"],
	overframeEffBoxPen: ["PenEff_Box"],
	overframeEffBoxNonPen: ["Eff_Box"],
	overframeEffOutlinePen: ["PenEff_Outline"],
	overframeEffOutlineNonPen: ["Eff_Outline"],
	monsterLinkGroup: ["Link Rating", "Link"],
	monsterLinkValue: ["linkValue", "Link Value", "Link Rating Value"],
	monsterLinkArrows: ["Links", "Link Arrows", "Arrows"],
	monsterPenScaleGroup: ["Pen Scale L/R", "Pen Scale", "Pendulum Scale"],
	monsterPenScaleL: ["Scale L", "Pen Scale L"],
	monsterPenScaleR: ["Scale R", "Pen Scale R"],
	spellTrapAttribute: ["attribute", "Atrributes", "Attributes"],
	spellTrapIcons: ["icons", "Icons"],
} as const;

export const BORDER_NAME_CANDIDATES: Record<string, string[]> = {
	normal: ["card-normal"],
	normal_pendulum: ["card-normal-pendulum"],
	effect: ["card-effect"],
	effect_pendulum: ["card-effect-pendulum"],
	ritual: ["card-ritual"],
	ritual_pendulum: ["card-ritual-pendulum"],
	fusion: ["card-fusion"],
	fusion_pendulum: ["card-fusion-pendulum"],
	synchro: ["card-synchro"],
	synchro_pendulum: ["card-synchro-pendulum"],
	dark_synchro: ["card-dark-synchro"],
	xyz: ["card-xyz"],
	xyz_pendulum: ["card-xyz-pendulum"],
	link: ["card-link"],
	spell: ["card-spell"],
	trap: ["card-trap"],
	token: ["card-token"],
	obelisk: ["card-obelisk"],
	ra: ["card-ra"],
	slifer: ["card-slifer"],
};

export const ATTRIBUTE_NAME_CANDIDATES: Record<string, string[]> = {
	DARK: ["attribute-dark"],
	LIGHT: ["attribute-light"],
	EARTH: ["attribute-earth"],
	WATER: ["attribute-water"],
	FIRE: ["attribute-fire"],
	WIND: ["attribute-wind"],
	DIVINE: ["attribute-divine"],
};

export const SPELL_TYPE_NAME_CANDIDATES: Record<string, string[]> = {
	"Quick-Play": ["spell-quickplay", "spell-quick-play", "Quick-Play", "QuickPlay", "Quick Play"],
	Continuous: ["spell-continuous", "spell-continuious", "continuious", "Continuous", "Continuious"],
	Equip: ["spell-equip", "Equip"],
	Field: ["spell-field", "Field"],
	Ritual: ["spell-ritual", "Ritual"],
};

export const TRAP_TYPE_NAME_CANDIDATES: Record<string, string[]> = {
	Continuous: ["trap-continuous", "trap-continuious", "continuious", "Continuous", "Continuious"],
	Counter: ["trap-counter", "Counter"],
};

export const LINK_ARROW_NAME_CANDIDATES: Record<string, string[]> = {
	Top: ["T", "up-on"],
	Bottom: ["D", "down-on"],
	Left: ["L", "left-on"],
	Right: ["R", "right-on"],
	"Top-Left": ["TL", "top-left-on"],
	"Top-Right": ["TR", "top-right-on"],
	"Bottom-Left": ["BL", "bottom-left-on"],
	"Bottom-Right": ["BR", "bottom-right-on"],
};

export const TEXT_STYLE: Record<"atk" | "def" | "link" | "scale", TextFieldStyle> = {
	atk: {
		fontFamily: "sans-serif",
		color: "#000000",
		align: "right",
		sizeRatio: 1.45,
		ignorePsdFontSize: true,
		offsetY: 3,
	},
	def: {
		fontFamily: "sans-serif",
		color: "#000000",
		align: "right",
		sizeRatio: 1.45,
		ignorePsdFontSize: true,
		offsetX: -2,
		offsetY: 2,
	},
	link: {
		fontFamily: "sans-serif",
		color: "#ffffff",
		align: "center",
		sizeRatio: 0.85,
		offsetX: -1,
		offsetY: 6,
	},
	scale: { fontFamily: "sans-serif", color: "#ffffff", align: "center", sizeRatio: 0.85 },
};

export const FX_LABELS: Record<string, string> = {
	fx_art_holo_rainbow: "Rainbow Holo",
	fx_art_holo_1: "Holo I",
	fx_art_holo_2: "Holo II",
	fx_art_glare: "Glare",
	fx_art_dotholo: "Dot Holo",
	fx_art_paralelle: "Parallel",
	fx_art_diamonds: "Diamonds",
	fx_art_holo: "Holo",
	fx_millenium_rare: "Millenium Rare",
	fx_glitter_rainbow: "Glitter Rainbow",
	fx_fullyworn: "Fully Worn",
	fx_wornborder: "Worn Border",
	fx_grandmaster: "Grandmaster",
	fx_parallell_rare: "Parallel Rare",
};

export const BLEND_MODE_MAP: Record<string, NonNullable<OverlayOptions["blend"]>> = {
	multiply: "multiply",
	screen: "screen",
	overlay: "overlay",
	darken: "darken",
	lighten: "lighten",
	"color dodge": "color-dodge",
	"color burn": "color-burn",
	"hard light": "hard-light",
	"soft light": "soft-light",
	difference: "difference",
	exclusion: "exclusion",
};
