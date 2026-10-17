/**
 * Core rendering logic for the standalone proxy card builder. Renders a full-resolution card
 * image (whatever size the template canvas is, typically 704x1024) from `card-template.psd` plus
 * a `ProxyCard` + artwork file - no database, no game-server plumbing.
 *
 * This is a manually trimmed-down duplicate of `backend/src/services/cardImageGenerator.ts` (the
 * real game's generator), keeping only what's needed for the mainline, non-Rush-Duel template:
 * no Rush Duel template/layout, no "4Kids"-style simplified sprite template, no "classic" sprite
 * layout, no Overframe, no small-sprite downscaling - this always renders the full card. It is a
 * deliberate copy, not shared code, so the two will drift apart over time if the real template or
 * generator changes; that's fine, this tool is meant to be lifted out into its own project.
 */
import fs from 'fs';
import path from 'path';
import sharp, { OverlayOptions } from 'sharp';
// Side-effect import: wires ag-psd's internal layer-pixel decoding to the `canvas` package's
// `createCanvas` (Node has no native Canvas/ImageData). Without this, `readPsd(..., { useImageData:
// true })` still throws "Canvas not initialized".
import 'ag-psd/initialize-canvas';
import { readPsd } from 'ag-psd';
import { ProxyCard } from './types';

export const PSD_PATH = path.join(__dirname, '..', 'card-template.psd');
/** Font files for dynamic text (see `renderDynamicText`) - drop e.g. `MatrixBoldSmallCaps.ttf` here
 *  to render that family without needing it installed as a system font. Optional: falls back to
 *  asking the OS to resolve the family name (the old behavior) for any font not found here. */
export const FONTS_DIR = path.join(__dirname, '..', 'fonts');

/** Artwork placement + size, in absolute canvas pixels. */
const ART_BOX = {
  normal: { left: 89, top: 191, width: 530, height: 530 },
  pendulum: { left: 50, top: 185, width: 605, height: 575 },
};

interface TextFieldStyle {
  fontFamily: string;
  color: string;
  align: 'left' | 'center' | 'right';
  /** Used only when neither `fontSizeOverride` nor the PSD's own parsed fontSize is available. */
  sizeRatio: number;
  /** Forces this size in px, ignoring both the PSD's own parsed fontSize and `sizeRatio`. */
  fontSizeOverride?: number;
  /** Skips the PSD's own parsed fontSize, falling straight through to `sizeRatio` - for fields
   *  whose PSD-authored fontSize renders inconsistently with their own layer bounds (see the
   *  comment on `TEXT_STYLE.atk`). */
  ignorePsdFontSize?: boolean;
  /** Fine-tune nudge in px, applied after alignment/growth. Positive = right/down. */
  offsetX?: number;
  offsetY?: number;
}

/**
 * Styling for the dynamic number/text overlays (ATK/DEF/Link Rating/Pendulum Scale). These are
 * rendered fresh (via SVG) rather than reusing the PSD's own text pixels, since ag-psd cannot
 * re-rasterize edited text layers - see the big comment above `renderDynamicText()`. Font family
 * and color are read from the resolved text layer's own PSD style wherever possible; size/
 * alignment are explicit overrides below for ATK/DEF per spec.
 */
const TEXT_STYLE: Record<'atk' | 'def' | 'link' | 'scale', TextFieldStyle> = {
  // atkValue/defValue's own PSD-authored fontSize (~65px) renders roughly 2x taller than their
  // ~22px-tall layer bounds (and the same-height "ATK/"/"DEF/" labels right next to them) - falls
  // back to sizing off the box height instead, which actually matches those labels.
  atk: { fontFamily: 'sans-serif', color: '#000000', align: 'right', sizeRatio: 1.45, ignorePsdFontSize: true, offsetY: 3 },
  def: {
    fontFamily: 'sans-serif',
    color: '#000000',
    align: 'right',
    sizeRatio: 1.45,
    ignorePsdFontSize: true,
    offsetX: -2,
    offsetY: 2,
  },
  link: { fontFamily: 'sans-serif', color: '#ffffff', align: 'center', sizeRatio: 0.85, offsetX: -1, offsetY: 6 },
  scale: { fontFamily: 'sans-serif', color: '#ffffff', align: 'center', sizeRatio: 0.85 },
};

/**
 * Layer name candidates, most-likely-first, for every group/layer this tool needs to find and
 * toggle. Each entry is a list of names tried (case/space/dash/underscore-insensitive) against the
 * PSD's real children at that point in the tree. `resolvePath()` throws a message listing the real
 * sibling names when nothing matches, so a wrong guess here fails loudly instead of silently.
 */
const LAYER_PATHS = {
  // Photoshop wraps everything (Art/Frames/Overlays) in a generic group like this whenever layers
  // get grouped together in the editor - `resolveContentRoot()` descends into it when present and
  // falls back to the true root otherwise.
  contentRoot: ['Folder 1', 'Card'],
  art: ['Art'],
  // A static reference paste of overframe artwork, sitting as a sibling of `art` - always hidden
  // (see the unconditional hide below): overframe art is composited externally per-card (see
  // loadOverframeComposite), never from anything baked into the PSD itself.
  overframeArtworkPlaceholder: ['Overframe Artwork'],
  border: ['Frames', 'Border', 'Frame'],
  overlays: ['Overlays'],
  overlaysMonster: ['Monster Parts', 'Monster'],
  overlaysSpellTrap: ['Spell/Trap Types', 'Spell/Trap', 'Spell Trap', 'SpellTrap'],

  monsterAttribute: ['Attributes', 'Attribute'],
  // Another Photoshop editor-grouping wrapper (see `contentRoot` above) - Level/Rank/ATK-DEF/Link
  // Rating/Pendulum Scale all live one level deeper inside this group rather than directly under
  // Monster Parts. `buildMonsterPlan()` descends into it first, falling back to Monster Parts
  // itself when absent.
  monsterStatsGroup: ['Stars'],
  monsterLevel: ['Level'],
  // Dark Synchro's negative Levels: a sibling of "Level" with the same "level-1".."level-12" pips.
  monsterMinusLevel: ['Minus Level'],
  monsterRank: ['Rank'],
  // "rank-13" is nested inside the Rank group itself, not a sibling of it.
  monsterRank13: ['rank-13', 'Rank 13'],
  monsterAtkDefGroup: ['ATK / DEF', 'ATK/DEF', 'ATK DEF'],
  // Deliberately NOT including bare 'ATK'/'DEF' here: normalizeName() strips the trailing slash
  // from the static "ATK/"/"DEF/" label layers, so a bare 'ATK'/'DEF' candidate exact-matches
  // those labels instead of the real atkValue/defValue text layer.
  monsterAtkValue: ['atkValue', 'ATK Value'],
  monsterDefValue: ['defValue', 'DEF Value'],
  monsterDefLabel: ['DEF/', 'DEF'],
  // "Overframe" cards (full-canvas art replacement, see loadOverframeComposite) get an extra
  // decorative border texture here, clipped to the active frameType's shape via its own "Frames
  // copy" duplicate of the main Border group's card-xxx children - lives a level further inside
  // the same auto-grouping wrapper as atkValue/defValue, so `findDescendant` finds it too.
  monsterOverframeGroup: ['Overframe'],
  overframeFrames: ['Frames copy', 'Frames Copy'],
  // "Eff Box" (decorative box behind ATK/DEF, same idea as the main template's Line 1) has a
  // Pendulum and non-Pendulum pair - only one pair shows at a time, picked by `kind.isPendulum`.
  // The "Box" piece of each pair lives inside the "Eff Box" group itself; the "Outline" piece is a
  // direct sibling of "Eff Box"/"Frames copy" under "Overframe", not nested inside "Eff Box" -
  // resolved separately below since `findChild(overframeGroup, ['Eff Box'])` would otherwise
  // collide with the "Eff Box" GROUP's own name (both normalize to "effbox").
  overframeEffBox: ['Eff Box'],
  overframeEffBoxPen: ['PenEff_Box'],
  overframeEffBoxNonPen: ['Eff_Box'],
  overframeEffOutlinePen: ['PenEff_Outline'],
  overframeEffOutlineNonPen: ['Eff_Outline'],
  monsterLinkGroup: ['Link Rating', 'Link'],
  monsterLinkValue: ['linkValue', 'Link Value', 'Link Rating Value'],
  // The arrows live in a sub-group named "Links" (not "Link Arrows"/"Arrows").
  monsterLinkArrows: ['Links', 'Link Arrows', 'Arrows'],
  monsterPenScaleGroup: ['Pen Scale L/R', 'Pen Scale', 'Pendulum Scale'],
  monsterPenScaleL: ['Scale L', 'Pen Scale L'],
  monsterPenScaleR: ['Scale R', 'Pen Scale R'],
  // Spell/Trap cards get the same corner-icon treatment Monsters get for Attribute, just with a
  // 2-option (Spell/Trap) group instead of a 7-option one.
  spellTrapAttribute: ['attribute', 'Atrributes', 'Attributes'],
  // Quick-Play/Continuous/Equip/Field/Ritual/Counter icons live in this sub-group, a sibling of
  // `spellTrapAttribute` rather than direct children of Spell/Trap Types itself.
  spellTrapIcons: ['icons', 'Icons'],
} as const;

/**
 * `frameType` -> Border child name candidates. Exact names (no fuzzy reliance) - notably
 * "card-dark-synchro" also exists as a sibling of "card-synchro" and would fuzzy-substring-match a
 * bare "Synchro" candidate, so plain frame types need their exact `card-x` name here.
 */
const BORDER_NAME_CANDIDATES: Record<string, string[]> = {
  normal: ['card-normal'],
  normal_pendulum: ['card-normal-pendulum'],
  effect: ['card-effect'],
  effect_pendulum: ['card-effect-pendulum'],
  ritual: ['card-ritual'],
  ritual_pendulum: ['card-ritual-pendulum'],
  fusion: ['card-fusion'],
  fusion_pendulum: ['card-fusion-pendulum'],
  synchro: ['card-synchro'],
  synchro_pendulum: ['card-synchro-pendulum'],
  dark_synchro: ['card-dark-synchro'],
  xyz: ['card-xyz'],
  xyz_pendulum: ['card-xyz-pendulum'],
  link: ['card-link'],
  spell: ['card-spell'],
  trap: ['card-trap'],
  token: ['card-token'],
  // The three Egyptian God cards.
  obelisk: ['card-obelisk'],
  ra: ['card-ra'],
  slifer: ['card-slifer'],
};

/** `attribute` value -> Attribute child name candidates. */
const ATTRIBUTE_NAME_CANDIDATES: Record<string, string[]> = {
  DARK: ['attribute-dark'],
  LIGHT: ['attribute-light'],
  EARTH: ['attribute-earth'],
  WATER: ['attribute-water'],
  FIRE: ['attribute-fire'],
  WIND: ['attribute-wind'],
  DIVINE: ['attribute-divine'],
};

/**
 * `race` value (Spell) -> icon child name candidates, searched as flat siblings directly under
 * Overlays > Spell/Trap (there is no separate "Spell" subgroup).
 */
const SPELL_TYPE_NAME_CANDIDATES: Record<string, string[]> = {
  'Quick-Play': ['spell-quickplay', 'spell-quick-play', 'Quick-Play', 'QuickPlay', 'Quick Play'],
  Continuous: ['spell-continuous', 'spell-continuious', 'continuious', 'Continuous', 'Continuious'],
  Equip: ['spell-equip', 'Equip'],
  Field: ['spell-field', 'Field'],
  Ritual: ['spell-ritual', 'Ritual'],
};

/** `race` value (Trap) -> icon child name candidates, same flat-sibling structure as Spell above. */
const TRAP_TYPE_NAME_CANDIDATES: Record<string, string[]> = {
  Continuous: ['trap-continuous', 'trap-continuious', 'continuious', 'Continuous', 'Continuious'],
  Counter: ['trap-counter', 'Counter'],
};

/**
 * Link marker strings -> arrow child name candidates. Exact "*-on" names (the template also has
 * matching "*-off" siblings it doesn't need).
 */
const LINK_ARROW_NAME_CANDIDATES: Record<string, string[]> = {
  Top: ['T', 'up-on'],
  Bottom: ['D', 'down-on'],
  Left: ['L', 'left-on'],
  Right: ['R', 'right-on'],
  'Top-Left': ['TL', 'top-left-on'],
  'Top-Right': ['TR', 'top-right-on'],
  'Bottom-Left': ['BL', 'bottom-left-on'],
  'Bottom-Right': ['BR', 'bottom-right-on'],
};

// ---------------------------------------------------------------------------
// PSD tree types + loading
// ---------------------------------------------------------------------------

export interface LayerNode {
  name: string;
  hidden: boolean;
  left: number;
  top: number;
  right: number;
  bottom: number;
  isGroup: boolean;
  children: LayerNode[];
  parent: LayerNode | null;
  /** Raw ag-psd layer - has `.imageData` for leaves (when not a group) and `.text` for text layers. */
  raw: any;
}

export interface PsdTree {
  root: LayerNode;
  width: number;
  height: number;
}

let cachedTree: PsdTree | null = null;

function buildNode(raw: any, parent: LayerNode | null): LayerNode {
  const isGroup = Array.isArray(raw.children);
  const node: LayerNode = {
    name: raw.name ?? '(unnamed)',
    hidden: !!raw.hidden,
    left: raw.left ?? 0,
    top: raw.top ?? 0,
    right: raw.right ?? 0,
    bottom: raw.bottom ?? 0,
    isGroup,
    children: [],
    parent,
    raw,
  };
  if (isGroup) {
    node.children = raw.children.map((c: any) => buildNode(c, node));
  }
  return node;
}

/** Parses `card-template.psd` on first call and caches the result for the process's lifetime. */
export function loadPsdTree(): PsdTree {
  if (cachedTree) return cachedTree;

  if (!fs.existsSync(PSD_PATH)) {
    throw new Error(`PSD template not found at ${PSD_PATH}`);
  }

  console.log(`Parsing PSD template (${(fs.statSync(PSD_PATH).size / 1024 / 1024).toFixed(1)} MB)... this can take a bit.`);
  const buffer = fs.readFileSync(PSD_PATH);
  const psd = readPsd(buffer, {
    skipCompositeImageData: true,
    skipThumbnail: true,
    skipLinkedFilesData: true,
    useImageData: true,
  });

  if (psd.bitsPerChannel && psd.bitsPerChannel !== 8) {
    console.warn(
      `⚠️  PSD is ${psd.bitsPerChannel} bits/channel, not 8 - pixel compositing below assumes 8-bit RGBA and may be wrong.`
    );
  }

  const root: LayerNode = {
    name: '(root)',
    hidden: false,
    left: 0,
    top: 0,
    right: psd.width,
    bottom: psd.height,
    isGroup: true,
    children: [],
    parent: null,
    raw: psd,
  };
  root.children = (psd.children ?? []).map((c: any) => buildNode(c, root));

  const tree: PsdTree = { root, width: psd.width, height: psd.height };
  console.log(`Parsed PSD: ${psd.width}x${psd.height}, ${countNodes(root)} layers/groups.`);
  cachedTree = tree;
  return tree;
}

function countNodes(node: LayerNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

// ---------------------------------------------------------------------------
// Layer path resolution
// ---------------------------------------------------------------------------

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s\-_/]+/g, '');
}

export function findChild(node: LayerNode, candidates: readonly string[]): LayerNode | undefined {
  const normCandidates = candidates.map(normalizeName);
  // exact (normalized) match first
  for (const child of node.children) {
    const n = normalizeName(child.name);
    if (normCandidates.includes(n)) return child;
  }
  // fuzzy: candidate is a substring of the child name or vice versa
  for (const child of node.children) {
    const n = normalizeName(child.name);
    if (normCandidates.some((c) => c.length > 0 && (n.includes(c) || c.includes(n)))) return child;
  }
  return undefined;
}

/** Like `findChild`, but also checks one level into each child group - covers Photoshop's generic
 *  "Group N" wrapper it creates when multiple layers get grouped together in the editor, sitting
 *  alongside other real, meaningfully-named siblings (so a single blanket `contentRoot`-style
 *  descent doesn't apply).
 *
 *  Exact matches are checked at both depths before fuzzy matching is tried at either - otherwise a
 *  fuzzy substring hit against a wrapper group's own name (e.g. "ATK/DEF Values" containing
 *  "defvalue" as a substring) would shadow the real leaf one level inside it, which exact-match
 *  would have found correctly. */
function findDescendant(node: LayerNode, candidates: readonly string[]): LayerNode | undefined {
  const normCandidates = candidates.map(normalizeName);

  for (const child of node.children) {
    if (normCandidates.includes(normalizeName(child.name))) return child;
  }
  for (const child of node.children) {
    if (!child.isGroup) continue;
    for (const grandchild of child.children) {
      if (normCandidates.includes(normalizeName(grandchild.name))) return grandchild;
    }
  }

  const direct = findChild(node, candidates);
  if (direct) return direct;
  for (const child of node.children) {
    if (!child.isGroup) continue;
    const nested = findChild(child, candidates);
    if (nested) return nested;
  }
  return undefined;
}

function describeChildren(node: LayerNode): string {
  return node.children.length ? node.children.map((c) => `"${c.name}"`).join(', ') : '(none)';
}

/** Finds a child group identified by its *contents* rather than its own name - for the Link Rating
 *  arrows sub-group, which Photoshop auto-named "Group 2" (another generic-grouping artifact, see
 *  `findDescendant`) with no meaningfully-named sibling to fall back on. Picks the first child group
 *  containing at least `minMatches` of `signatureCandidates` (by the same name matching as
 *  `findChild`). */
function findChildBySignature(
  node: LayerNode,
  signatureCandidates: readonly string[],
  minMatches = 2
): LayerNode | undefined {
  for (const child of node.children) {
    if (!child.isGroup) continue;
    const matches = signatureCandidates.filter((c) => findChild(child, [c])).length;
    if (matches >= minMatches) return child;
  }
  return undefined;
}

/** Resolves a path of candidate-name-lists from `from`, throwing a descriptive error (listing the
 *  real sibling names at the point of failure) if any segment can't be found. */
function resolvePath(from: LayerNode, path: readonly (readonly string[])[], label: string): LayerNode {
  let cur = from;
  for (const segment of path) {
    const next = findChild(cur, segment);
    if (!next) {
      throw new Error(
        `Could not resolve layer path for "${label}": stuck at "${cur.name}" looking for one of [${segment.join(
          ', '
        )}]. Available children of "${cur.name}": ${describeChildren(cur)}. ` +
          `Run with --list-layers and adjust LAYER_PATHS / *_NAME_CANDIDATES in cardProxyGenerator.ts.`
      );
    }
    cur = next;
  }
  return cur;
}

function tryResolvePath(from: LayerNode, path: readonly (readonly string[])[]): LayerNode | undefined {
  let cur = from;
  for (const segment of path) {
    const next = findChild(cur, segment);
    if (!next) return undefined;
    cur = next;
  }
  return cur;
}

/** Descends into the PSD's top-level content wrapper group (see `LAYER_PATHS.contentRoot`) if one
 *  exists, otherwise returns `root` unchanged. */
function resolveContentRoot(root: LayerNode): LayerNode {
  return tryResolvePath(root, [LAYER_PATHS.contentRoot]) ?? root;
}

/** Every frame key (Border layer) that actually exists in the current template - useful for
 *  validating a card JSON's `frameType` before rendering. */
export function listFrameOptions(): string[] {
  const tree = loadPsdTree();
  const border = tryResolvePath(resolveContentRoot(tree.root), [LAYER_PATHS.border]);
  if (!border) return [];
  return Object.entries(BORDER_NAME_CANDIDATES)
    .filter(([, candidates]) => findChild(border, candidates))
    .map(([key]) => key);
}

// ---------------------------------------------------------------------------
// Render plan: which nodes are forced visible/hidden, and dynamic text overrides
// ---------------------------------------------------------------------------

interface TextOverride {
  node: LayerNode;
  text: string;
  style: TextFieldStyle;
}

/** A Photoshop-style clipping group this generator has to emulate itself (see `applyClipMask`):
 *  `clippedNodes` only ever paint where `maskNode`'s own pixels are opaque, and `maskNode` itself
 *  never paints its own pixels directly. */
export interface ClipMask {
  maskNode: LayerNode;
  clippedNodes: LayerNode[];
}

export interface RenderPlan {
  forceVisible: Set<LayerNode>;
  forceHidden: Set<LayerNode>;
  textOverrides: TextOverride[];
  notes: string[];
  clipMasks: ClipMask[];
}

function chainToRoot(node: LayerNode): LayerNode[] {
  const chain: LayerNode[] = [];
  let cur: LayerNode | null = node;
  while (cur) {
    chain.push(cur);
    cur = cur.parent;
  }
  return chain;
}

function forceVisibleChain(plan: RenderPlan, node: LayerNode): void {
  for (const n of chainToRoot(node)) {
    plan.forceVisible.add(n);
    plan.forceHidden.delete(n);
  }
}

function forceHiddenNode(plan: RenderPlan, node: LayerNode): void {
  plan.forceHidden.add(node);
  plan.forceVisible.delete(node);
}

/** Hides every child of `parent` except `keep` (if given). Does not recurse. */
function forceOnlyVisible(plan: RenderPlan, parent: LayerNode, keep: LayerNode | undefined): void {
  for (const child of parent.children) {
    if (child === keep) continue;
    forceHiddenNode(plan, child);
  }
  if (keep) forceVisibleChain(plan, keep);
}

function normalizeCardType(card: ProxyCard) {
  const type = card.type ?? '';
  const frameType = (card.frameType ?? '').toLowerCase();
  return {
    isMonster: /monster/i.test(type),
    isSpell: type === 'Spell Card',
    isTrap: type === 'Trap Card',
    isLink: /link/i.test(type) || frameType === 'link',
    isXyz: /xyz/i.test(type) || frameType.startsWith('xyz'),
    isPendulum: /pendulum/i.test(type) || frameType.includes('pendulum'),
  };
}

function formatStat(value: number | null | undefined): string {
  // ygoprodeck's convention for "?" ATK/DEF monsters (variable stats) is -1.
  return value === null || value === undefined || value === -1 ? '?' : String(value);
}

/**
 * Finds an editable text leaf under `node` (itself or a descendant with `.raw.text`). If the
 * resolved node turns out to be a flattened image instead, this returns undefined and
 * `queueDynamicText` falls back to drawing text over the node's own bounds instead.
 */
function findTextLeaf(node: LayerNode): LayerNode | undefined {
  if (node.raw?.text) return node;
  for (const child of node.children) {
    const found = findTextLeaf(child);
    if (found) return found;
  }
  return undefined;
}

export function buildRenderPlan(tree: PsdTree, card: ProxyCard, options?: { overframe?: boolean }): RenderPlan {
  const plan: RenderPlan = {
    forceVisible: new Set(),
    forceHidden: new Set(),
    textOverrides: [],
    notes: [],
    clipMasks: [],
  };
  const root = resolveContentRoot(tree.root);
  const kind = normalizeCardType(card);

  // Art is drawn separately (see loadArtworkComposite) - always hide the PSD's own Art placeholder
  // so it doesn't show through the border's art window.
  const artNode = tryResolvePath(root, [LAYER_PATHS.art]);
  if (artNode) forceHiddenNode(plan, artNode);
  else plan.notes.push(`No "${LAYER_PATHS.art.join('/')}" layer found - skipping (artwork is drawn directly).`);

  const overframeArtworkPlaceholder = tryResolvePath(root, [LAYER_PATHS.overframeArtworkPlaceholder]);
  if (overframeArtworkPlaceholder) forceHiddenNode(plan, overframeArtworkPlaceholder);

  // Border: exactly one frameType child visible - unless this card has a full-canvas "overframe"
  // replacement image (see loadOverframeComposite), which already includes its own frame/border
  // art, so the PSD's own border stays entirely hidden instead.
  const border = resolvePath(root, [LAYER_PATHS.border], 'Border group');
  if (options?.overframe) {
    forceOnlyVisible(plan, border, undefined);
  } else {
    const frameKey = (card.frameType ?? 'normal').toLowerCase();
    const borderCandidates = BORDER_NAME_CANDIDATES[frameKey] ?? [card.frameType ?? 'Normal'];
    const borderChild = findChild(border, borderCandidates);
    if (!borderChild) {
      throw new Error(
        `Could not find a Border layer for frameType "${card.frameType}" (tried [${borderCandidates.join(
          ', '
        )}]). Available: ${describeChildren(border)}.`
      );
    }
    forceOnlyVisible(plan, border, borderChild);
  }

  // Overlays > Monster vs Spell/Trap
  const overlays = resolvePath(root, [LAYER_PATHS.overlays], 'Overlays group');
  const overlaysMonster = tryResolvePath(overlays, [LAYER_PATHS.overlaysMonster]);
  const overlaysSpellTrap = tryResolvePath(overlays, [LAYER_PATHS.overlaysSpellTrap]);

  if (kind.isMonster) {
    if (!overlaysMonster) throw new Error(`Could not find Overlays > Monster. Available: ${describeChildren(overlays)}.`);
    forceOnlyVisible(plan, overlays, overlaysMonster);
    buildMonsterPlan(plan, overlaysMonster, card, kind, !!options?.overframe);
  } else if (kind.isSpell || kind.isTrap) {
    if (!overlaysSpellTrap)
      throw new Error(`Could not find Overlays > Spell/Trap. Available: ${describeChildren(overlays)}.`);
    forceOnlyVisible(plan, overlays, overlaysSpellTrap);
    buildSpellTrapPlan(plan, overlaysSpellTrap, card, kind);
  } else {
    // Token / anything else: hide overlays entirely, border-only card.
    forceOnlyVisible(plan, overlays, undefined);
    plan.notes.push(`Card type "${card.type}" is neither Monster nor Spell/Trap - Overlays left hidden.`);
  }

  return plan;
}

function buildMonsterPlan(
  plan: RenderPlan,
  monster: LayerNode,
  card: ProxyCard,
  kind: ReturnType<typeof normalizeCardType>,
  isOverframe: boolean
): void {
  // Attribute
  const attributeGroup = tryResolvePath(monster, [LAYER_PATHS.monsterAttribute]);
  if (attributeGroup) {
    const attr = (card.attribute ?? '').toUpperCase();
    const candidates = ATTRIBUTE_NAME_CANDIDATES[attr] ?? [card.attribute ?? ''];
    const attrChild = findChild(attributeGroup, candidates);
    forceOnlyVisible(plan, attributeGroup, attrChild);
    if (!attrChild) plan.notes.push(`Attribute "${card.attribute}" not matched under "${attributeGroup.name}".`);
  } else {
    plan.notes.push('No Attribute group found under Overlays > Monster.');
  }

  // Level/Rank live inside this wrapper group when present; ATK-DEF/Link Rating/Pendulum Scale
  // stay direct children of Monster Parts in the current template.
  const statsRoot = tryResolvePath(monster, [LAYER_PATHS.monsterStatsGroup]) ?? monster;

  // Stars (Level or Rank) - real children are "level-N"/"rank-N" (1-12).
  const levelGroup = tryResolvePath(statsRoot, [LAYER_PATHS.monsterLevel]);
  const rankGroup = tryResolvePath(statsRoot, [LAYER_PATHS.monsterRank]);
  const minusLevelGroup = tryResolvePath(statsRoot, [LAYER_PATHS.monsterMinusLevel]);
  // Dark Synchro frame too, so a Level 0 Dark Synchro shows Minus Level with no pips rather than the plain Level group.
  const isMinusLevel = ((card.level ?? 0) < 0 || card.frameType === 'dark_synchro') && !kind.isXyz;
  const starCount = Math.abs(card.level ?? 0);

  // "Minus Level" is only ever shown for negative-level (Dark Synchro) monsters.
  if (minusLevelGroup && !isMinusLevel) forceHiddenNode(plan, minusLevelGroup);

  if (kind.isXyz) {
    if (levelGroup) forceHiddenNode(plan, levelGroup);
    if (rankGroup) {
      if (starCount === 13) {
        // "rank-13" is nested inside the Rank group itself, not a sibling of it.
        const rank13 = tryResolvePath(rankGroup, [LAYER_PATHS.monsterRank13]);
        forceOnlyVisible(plan, rankGroup, undefined);
        if (rank13) forceVisibleChain(plan, rank13);
        else plan.notes.push(`Rank 13 special layer not found under "${rankGroup.name}".`);
      } else {
        applyStarCount(plan, rankGroup, starCount, 'rank');
      }
    } else {
      plan.notes.push('No Rank group found under Overlays > Monster for an Xyz monster.');
    }
  } else {
    if (rankGroup) forceHiddenNode(plan, rankGroup);
    if (isMinusLevel) {
      if (levelGroup) forceHiddenNode(plan, levelGroup);
      if (minusLevelGroup) applyStarCount(plan, minusLevelGroup, starCount, 'level', true);
      else plan.notes.push('No Minus Level group found under Overlays > Monster for a negative-level monster.');
    } else if (levelGroup) {
      applyStarCount(plan, levelGroup, starCount, 'level');
    } else {
      plan.notes.push('No Level group found under Overlays > Monster.');
    }
  }

  // ATK/DEF value text layers live inside a shared "ATK / DEF" sub-group - one level further in
  // than that, inside a generic "Group 1"-style wrapper Photoshop creates when layers get grouped
  // together in the editor (same pattern as `contentRoot`/`monsterStatsGroup`, just unnamed here),
  // so `findDescendant` also checks one level into each of its child groups.
  const atkDefGroup = tryResolvePath(monster, [LAYER_PATHS.monsterAtkDefGroup]);
  if (!atkDefGroup) plan.notes.push('No ATK / DEF group found under Overlays > Monster.');

  // "Overframe" decorative border (see loadOverframeComposite) - hidden entirely for normal cards
  // since it's not clipped to anything by default and would otherwise paint a stray card-normal
  // frame over every render; shown with its "Frames copy" clip switched to this card's actual
  // frameType, exactly like the main Border group, only for cards using overframe art.
  const overframeGroup = atkDefGroup && findDescendant(atkDefGroup, LAYER_PATHS.monsterOverframeGroup);
  if (overframeGroup) {
    if (isOverframe) {
      forceVisibleChain(plan, overframeGroup);

      // "Frames copy": a mask shape only - picks the card-xxx matching this card's frameType, but
      // never paints its own pixels (stays hidden; see `plan.clipMasks` / `applyClipMask`). It only
      // exists to define where the "Eff Box" effect-border art below is allowed to show.
      const overframeFrames = tryResolvePath(overframeGroup, [LAYER_PATHS.overframeFrames]);
      let maskNode: LayerNode | undefined;
      if (overframeFrames) {
        forceHiddenNode(plan, overframeFrames);
        const frameKey = (card.frameType ?? 'normal').toLowerCase();
        const frameCandidates = BORDER_NAME_CANDIDATES[frameKey] ?? [card.frameType ?? 'Normal'];
        maskNode = findChild(overframeFrames, frameCandidates);
        if (!maskNode) {
          plan.notes.push(`Overframe border mask not matched for frameType "${card.frameType}" under "${overframeFrames.name}".`);
        }
      } else {
        plan.notes.push(`No "${LAYER_PATHS.overframeFrames[0]}" clip group found under "${overframeGroup.name}".`);
      }

      // "Eff Box"/"Eff Outline": the decorative effect-border art (Pendulum or non-Pendulum pair)
      // - clipped to `maskNode`'s silhouette above rather than shown directly. The "Box" piece
      // lives inside the "Eff Box" group; the "Outline" piece is a direct sibling of "Eff
      // Box"/"Frames copy" under "Overframe" itself, so each is resolved from its own scope.
      const effBoxGroup = tryResolvePath(overframeGroup, [LAYER_PATHS.overframeEffBox]);
      const boxName = kind.isPendulum ? LAYER_PATHS.overframeEffBoxPen : LAYER_PATHS.overframeEffBoxNonPen;
      const outlineName = kind.isPendulum ? LAYER_PATHS.overframeEffOutlinePen : LAYER_PATHS.overframeEffOutlineNonPen;
      const boxNode = effBoxGroup && findChild(effBoxGroup, boxName);
      const outlineNode = findChild(overframeGroup, outlineName);

      // Both "Eff Box" (the group) and the Outline piece need to be force-hidden explicitly -
      // they'd otherwise either paint unclipped via the normal traversal (Outline, now a direct
      // child of the already-visible "Overframe" group) or show the inactive Pendulum/non-Pendulum
      // sibling (Box, inside "Eff Box").
      if (effBoxGroup) forceHiddenNode(plan, effBoxGroup);
      const otherOutlineName = kind.isPendulum ? LAYER_PATHS.overframeEffOutlineNonPen : LAYER_PATHS.overframeEffOutlinePen;
      const otherOutlineNode = findChild(overframeGroup, otherOutlineName);
      if (otherOutlineNode) forceHiddenNode(plan, otherOutlineNode);
      if (outlineNode) forceHiddenNode(plan, outlineNode);

      const activeChildren = [boxNode, outlineNode].filter((c): c is LayerNode => !!c);
      if (!boxNode || !outlineNode) {
        plan.notes.push(
          `Overframe Eff Box: only matched ${activeChildren.length}/2 layers (box="${boxName[0]}" outline="${outlineName[0]}") for ${
            kind.isPendulum ? 'Pendulum' : 'non-Pendulum'
          } under "${overframeGroup.name}".`
        );
      }
      if (activeChildren.length) {
        if (maskNode) {
          // Eff Box/Eff Outline act as the shape here, not the content: the frameType-matched
          // card-xxx layer's own color shows through them, so the text-box area is tinted to match
          // the active frame (e.g. Synchro's own backdrop color) instead of Eff Box's flat color.
          for (const shapeNode of activeChildren) {
            plan.clipMasks.push({ maskNode: shapeNode, clippedNodes: [maskNode] });
          }
        } else {
          // No mask resolved - fall back to showing Eff Box unclipped rather than not at all.
          for (const child of activeChildren) forceVisibleChain(plan, child);
        }
      }
    } else {
      forceHiddenNode(plan, overframeGroup);
    }
  } else if (isOverframe) {
    plan.notes.push('No Overframe decorative-border group found.');
  }

  const atkNode = atkDefGroup && findDescendant(atkDefGroup, LAYER_PATHS.monsterAtkValue);
  if (atkNode) {
    forceVisibleChain(plan, atkNode);
    queueDynamicText(plan, atkNode, formatStat(card.atk), TEXT_STYLE.atk);
  } else if (atkDefGroup) {
    plan.notes.push(`No atkValue layer found under "${atkDefGroup.name}".`);
  }

  // DEF vs Link Rating
  const defNode = atkDefGroup && findDescendant(atkDefGroup, LAYER_PATHS.monsterDefValue);
  const defLabel = atkDefGroup && findDescendant(atkDefGroup, LAYER_PATHS.monsterDefLabel);
  const linkGroup = tryResolvePath(monster, [LAYER_PATHS.monsterLinkGroup]);

  if (kind.isLink) {
    if (defNode) forceHiddenNode(plan, defNode);
    if (defLabel) forceHiddenNode(plan, defLabel);
    if (linkGroup) {
      forceVisibleChain(plan, linkGroup);
      const linkValueNode = tryResolvePath(linkGroup, [LAYER_PATHS.monsterLinkValue]);
      if (linkValueNode) {
        forceVisibleChain(plan, linkValueNode);
        queueDynamicText(plan, linkValueNode, formatStat(card.linkValue), TEXT_STYLE.link);
      } else {
        // No single editable linkValue text layer in this template - instead one pre-rendered
        // sprite per possible Link Rating (1-8), named "Link - N", sits as a direct sibling of the
        // arrows group under Link Rating. Pick the one matching this card and hide the rest.
        const linkValueSprites = linkGroup.children.filter((c) => /^link\d+$/.test(normalizeName(c.name)));
        const activeSprite = linkValueSprites.find(
          (c) => normalizeName(c.name) === normalizeName(`Link - ${card.linkValue}`)
        );
        if (linkValueSprites.length) {
          for (const sprite of linkValueSprites) {
            if (sprite === activeSprite) forceVisibleChain(plan, sprite);
            else forceHiddenNode(plan, sprite);
          }
          if (!activeSprite) {
            plan.notes.push(`No "Link - ${card.linkValue}" sprite found for Link Rating ${card.linkValue}.`);
          }
        } else {
          plan.notes.push('No linkValue layer found for a Link monster.');
        }
      }

      const arrowsGroup =
        tryResolvePath(linkGroup, [LAYER_PATHS.monsterLinkArrows]) ??
        // Another generic Photoshop "Group N" wrapper (see `findChildBySignature`) - identified by
        // containing the direction-code children (T/D/L/R/TL/TR/BL/BR) instead of by name.
        findChildBySignature(
          linkGroup,
          Object.values(LINK_ARROW_NAME_CANDIDATES).map((c) => c[0]),
          4
        );
      if (arrowsGroup) {
        const markers: string[] = card.linkMarkers ?? [];
        const activeChildren = markers
          .map((m) => findChild(arrowsGroup, LINK_ARROW_NAME_CANDIDATES[m] ?? [m]))
          .filter((c): c is LayerNode => !!c);
        for (const child of arrowsGroup.children) {
          if (!activeChildren.includes(child)) forceHiddenNode(plan, child);
        }
        for (const child of activeChildren) forceVisibleChain(plan, child);
        if (activeChildren.length !== markers.length) {
          plan.notes.push(`Only matched ${activeChildren.length}/${markers.length} link arrows (markers: ${markers.join(', ')}).`);
        }
      } else {
        plan.notes.push('No Links (arrows) group found for a Link monster.');
      }
    } else {
      plan.notes.push('No Link Rating group found under Overlays > Monster for a Link monster.');
    }
  } else {
    if (linkGroup) forceHiddenNode(plan, linkGroup);
    if (defNode) {
      forceVisibleChain(plan, defNode);
      queueDynamicText(plan, defNode, formatStat(card.def), TEXT_STYLE.def);
    } else if (atkDefGroup) {
      plan.notes.push(`No defValue layer found under "${atkDefGroup.name}".`);
    }
  }

  // Pendulum scale: two real layers, "Scale L"/"Scale R", nested inside "Pen Scale L/R" - both get
  // the same `card.scale` value.
  const scaleGroup = tryResolvePath(monster, [LAYER_PATHS.monsterPenScaleGroup]);
  const scaleL = scaleGroup && tryResolvePath(scaleGroup, [LAYER_PATHS.monsterPenScaleL]);
  const scaleR = scaleGroup && tryResolvePath(scaleGroup, [LAYER_PATHS.monsterPenScaleR]);
  if (kind.isPendulum) {
    if (scaleL) {
      forceVisibleChain(plan, scaleL);
      queueDynamicText(plan, scaleL, formatStat(card.scale), TEXT_STYLE.scale);
    } else plan.notes.push(`No Scale L layer found under "${scaleGroup?.name ?? LAYER_PATHS.monsterPenScaleGroup[0]}" for a Pendulum monster.`);
    if (scaleR) {
      forceVisibleChain(plan, scaleR);
      queueDynamicText(plan, scaleR, formatStat(card.scale), TEXT_STYLE.scale);
    } else plan.notes.push(`No Scale R layer found under "${scaleGroup?.name ?? LAYER_PATHS.monsterPenScaleGroup[0]}" for a Pendulum monster.`);
  } else if (scaleGroup) {
    forceHiddenNode(plan, scaleGroup);
  }
}

/** `fromTop` counts down from 12 instead of up from 1 - Minus Level shows a Level -8 monster as level-12..level-5. */
function applyStarCount(plan: RenderPlan, group: LayerNode, count: number, prefix: 'level' | 'rank', fromTop = false): void {
  const active: LayerNode[] = [];
  for (let i = 1; i <= count; i++) {
    const n = fromTop ? 13 - i : i;
    const child = findChild(group, [`${prefix}-${n}`, `${prefix} ${n}`]);
    if (child) active.push(child);
    else plan.notes.push(`"${prefix}-${n}" layer not found under "${group.name}".`);
  }
  for (const child of group.children) {
    if (!active.includes(child)) forceHiddenNode(plan, child);
  }
  for (const child of active) forceVisibleChain(plan, child);
}

/**
 * The type icons (Quick-Play/Continuous/Equip/Field/Ritual/Counter) are flat siblings directly
 * under Overlays > Spell/Trap Types - there is no separate "Spell"/"Trap" subgroup to narrow the
 * search first. There's also a nested "attribute" sub-group with "attribute-spell"/
 * "attribute-trap" - the same corner icon Monsters get for Attribute, just Spell/Trap-flavored -
 * handled separately from the flat type-icon list since it's not one of that list's "pick at most
 * one" siblings.
 */
function buildSpellTrapPlan(
  plan: RenderPlan,
  spellTrap: LayerNode,
  card: ProxyCard,
  kind: ReturnType<typeof normalizeCardType>
): void {
  const attributeGroup = tryResolvePath(spellTrap, [LAYER_PATHS.spellTrapAttribute]);
  const iconsGroup = tryResolvePath(spellTrap, [LAYER_PATHS.spellTrapIcons]) ?? spellTrap;
  const race = card.race ?? '';
  const typeCandidates = kind.isSpell ? SPELL_TYPE_NAME_CANDIDATES[race] : TRAP_TYPE_NAME_CANDIDATES[race];
  const typeChild = typeCandidates ? findChild(iconsGroup, typeCandidates) : undefined;

  for (const child of iconsGroup.children) {
    if (child === typeChild || child === attributeGroup) continue;
    forceHiddenNode(plan, child);
  }
  if (typeChild) forceVisibleChain(plan, typeChild);
  if (race && race !== 'Normal' && !typeChild) {
    plan.notes.push(
      `${kind.isSpell ? 'Spell' : 'Trap'} race "${race}" not matched under "${iconsGroup.name}". Available: ${describeChildren(iconsGroup)}.`
    );
  }

  if (attributeGroup) {
    const attrChild = findChild(attributeGroup, [kind.isSpell ? 'attribute-spell' : 'attribute-trap']);
    forceOnlyVisible(plan, attributeGroup, attrChild);
    if (!attrChild) plan.notes.push(`Spell/Trap corner icon not matched under "${attributeGroup.name}".`);
  } else {
    plan.notes.push('No Spell/Trap corner-icon "attribute" group found.');
  }
}

function queueDynamicText(plan: RenderPlan, node: LayerNode, text: string, style: TextFieldStyle): void {
  const leaf = findTextLeaf(node) ?? node;
  // Force the resolved leaf (not just `node`, in case it's a wrapping group) visible - its own
  // `hidden` flag in the source PSD is irrelevant once we're substituting its content.
  forceVisibleChain(plan, leaf);
  plan.textOverrides.push({ node: leaf, text, style });
}

// ---------------------------------------------------------------------------
// Compositing
// ---------------------------------------------------------------------------

function isEffectivelyVisible(node: LayerNode, plan: RenderPlan): boolean {
  let cur: LayerNode | null = node;
  while (cur) {
    if (plan.forceHidden.has(cur)) return false;
    if (!plan.forceVisible.has(cur) && cur.hidden) return false;
    cur = cur.parent;
  }
  return true;
}

interface CompositeInput {
  left: number;
  top: number;
  raw?: { width: number; height: number; channels: 4 };
  input: Buffer;
}

/** ag-psd's `Color` union for text `fillColor` - components are 0-1 floats in practice for RGB/FRGB. */
function psdColorToHex(color: any): string | undefined {
  if (!color || typeof color.r !== 'number' || typeof color.g !== 'number' || typeof color.b !== 'number') return undefined;
  const toByte = (v: number) => Math.max(0, Math.min(255, Math.round(v <= 1 ? v * 255 : v)));
  const hex = (v: number) => toByte(v).toString(16).padStart(2, '0');
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

/**
 * Pulls the real font family/size/color/tracking/italic straight off the resolved text layer's
 * parsed PSD style, only falling back to `TEXT_STYLE`'s config values for whichever piece isn't
 * available (e.g. `node` turned out not to be a true text layer at all).
 */
function resolveTextStyle(node: LayerNode, fallback: TextFieldStyle, boxHeight: number) {
  const psdStyle = node.raw?.text?.style;
  // PSD font names are PostScript names (FamilyName-StyleName, e.g. "MatrixBoldSmallCaps-Regular")
  // - the installed font family itself usually drops a plain "-Regular" suffix, so strip it for the
  // SVG's font-family to actually match instead of silently falling back to a generic font.
  const psdFontName = psdStyle?.font?.name?.replace(/-Regular$/i, '');
  const fontFamily = psdFontName || fallback.fontFamily;
  const fontSize =
    fallback.fontSizeOverride ??
    (!fallback.ignorePsdFontSize && psdStyle?.fontSize > 0
      ? Math.round(psdStyle.fontSize)
      : Math.round(boxHeight * fallback.sizeRatio));
  const color = psdColorToHex(psdStyle?.fillColor) ?? fallback.color;
  // Photoshop tracking is in 1/1000 em.
  const letterSpacing = typeof psdStyle?.tracking === 'number' ? Math.round(((psdStyle.tracking / 1000) * fontSize) * 100) / 100 : 0;
  const italic = !!psdStyle?.fauxItalic;
  return { fontFamily, fontSize, color, letterSpacing, italic };
}

const FONT_EXTENSIONS = { '.ttf': 'truetype', '.otf': 'opentype' } as const;
const fontFaceCssCache = new Map<string, string>();

/** Loads `fonts/<fontFamily>.ttf`/`.otf` (if present) as a base64 `@font-face` `<style>` block, so
 *  the SVG embeds the font itself instead of asking the OS to resolve the family name - keeps
 *  rendering identical on any machine regardless of what's installed system-wide. Returns '' (no
 *  `<style>` block, same as the old behavior) when no matching file exists in `fonts/`. Cached per
 *  family since the same few fonts get looked up on every dynamic text render. */
function loadFontFaceCss(fontFamily: string): string {
  const cached = fontFaceCssCache.get(fontFamily);
  if (cached !== undefined) return cached;

  let css = '';
  for (const [ext, format] of Object.entries(FONT_EXTENSIONS)) {
    const fontPath = path.join(FONTS_DIR, `${fontFamily}${ext}`);
    if (fs.existsSync(fontPath)) {
      const base64 = fs.readFileSync(fontPath).toString('base64');
      css = `<style>@font-face { font-family: '${fontFamily}'; src: url(data:font/${ext.slice(1)};base64,${base64}) format('${format}'); }</style>`;
      break;
    }
  }
  fontFaceCssCache.set(fontFamily, css);
  return css;
}

/**
 * Renders replacement text for a dynamic value layer as a standalone PNG buffer. ag-psd parses
 * text layers' original content/font/color but - per its own docs - does not redraw bitmap data
 * for the text layer on edits, so there is no way to re-rasterize "1800" into the original
 * "atkValue" pixels. Drawing it via SVG (through sharp/librsvg), reusing the original layer's own
 * font/size/color via `resolveTextStyle`, is the practical alternative.
 */
async function renderDynamicText(node: LayerNode, text: string, fallback: TextFieldStyle): Promise<CompositeInput> {
  const bounds = computeEffectiveBounds(node) ?? { left: node.left, top: node.top, right: node.left + 1, bottom: node.top + 1 };
  const boxWidth = Math.max(1, bounds.right - bounds.left);
  const boxHeight = Math.max(1, bounds.bottom - bounds.top);
  const { fontFamily, fontSize, color, letterSpacing, italic } = resolveTextStyle(node, fallback, boxHeight);

  // The stored layer bounds are just the tight extent of whatever placeholder text was there when
  // the PSD was saved - a longer real value, or an explicit `fontSizeOverride` bigger than the
  // original box, can render wider/taller than that box. Grow the canvas to fit instead, anchored
  // so the alignment's fixed edge doesn't shift as the text gets longer/shorter.
  const estimatedTextWidth = Math.ceil(text.length * (fontSize * 0.7 + letterSpacing)) + 8;
  const width = Math.max(boxWidth, estimatedTextWidth);
  const left =
    fallback.align === 'right'
      ? Math.round(bounds.right - width)
      : fallback.align === 'left'
        ? bounds.left
        : Math.round(bounds.left - (width - boxWidth) / 2);

  const estimatedTextHeight = Math.ceil(fontSize * 1.2) + 8;
  const height = Math.max(boxHeight, estimatedTextHeight);
  const top = Math.round(bounds.top - (height - boxHeight) / 2) + (fallback.offsetY ?? 0);
  const nudgedLeft = left + (fallback.offsetX ?? 0);

  const anchor = fallback.align === 'left' ? 'start' : fallback.align === 'right' ? 'end' : 'middle';
  const x = fallback.align === 'left' ? 0 : fallback.align === 'right' ? width : width / 2;
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${loadFontFaceCss(fontFamily)}
    <text x="${x}" y="${height / 2}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="bold" font-style="${italic ? 'italic' : 'normal'}" letter-spacing="${letterSpacing}" fill="${color}" text-anchor="${anchor}" dominant-baseline="central">${escaped}</text>
  </svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return { left: nudgedLeft, top, input: buffer };
}

/**
 * Sharp/libvips refuses to composite an overlay whose raw pixel dimensions exceed the base canvas
 * - unconditionally, regardless of `left`/`top`. Crops the raw buffer down to whatever portion
 * actually overlaps the canvas - returns null if none of it does.
 */
function clampRawToCanvas(
  left: number,
  top: number,
  width: number,
  height: number,
  data: Buffer,
  canvasWidth: number,
  canvasHeight: number
): CompositeInput | null {
  const srcLeft = Math.max(0, -left);
  const srcTop = Math.max(0, -top);
  const dstLeft = Math.max(0, left);
  const dstTop = Math.max(0, top);
  const cropWidth = Math.min(width - srcLeft, canvasWidth - dstLeft);
  const cropHeight = Math.min(height - srcTop, canvasHeight - dstTop);
  if (cropWidth <= 0 || cropHeight <= 0) return null;

  if (srcLeft === 0 && srcTop === 0 && cropWidth === width && cropHeight === height) {
    return { left: dstLeft, top: dstTop, raw: { width, height, channels: 4 }, input: data };
  }

  const channels = 4;
  const cropped = Buffer.alloc(cropWidth * cropHeight * channels);
  for (let y = 0; y < cropHeight; y++) {
    const srcRowStart = ((srcTop + y) * width + srcLeft) * channels;
    data.copy(cropped, y * cropWidth * channels, srcRowStart, srcRowStart + cropWidth * channels);
  }
  return { left: dstLeft, top: dstTop, raw: { width: cropWidth, height: cropHeight, channels: 4 }, input: cropped };
}

/** Extracts a leaf layer's own raw RGBA pixels as a canvas-positioned `CompositeInput`, regardless
 *  of its current visibility - used both for the normal visible-leaf traversal below and for
 *  pulling a clip mask's shape directly (see `applyClipMask`), since a mask is never itself
 *  effectively-visible (see the `forceHiddenNode` calls around `plan.clipMasks`). */
/** Photoshop's layer opacity compounds through group nesting (a layer at 80% inside a group at
 *  80% renders at 64%) - walks `node` up to the root multiplying each ancestor's own `opacity`,
 *  plus the leaf's own `fillOpacity` (Photoshop's "Fill" slider - the layer's own content only,
 *  not compounded through parents the way "Opacity" is). */
function getEffectiveOpacity(node: LayerNode): number {
  let opacity = typeof node.raw?.fillOpacity === 'number' ? node.raw.fillOpacity : 1;
  for (let cur: LayerNode | null = node; cur; cur = cur.parent) {
    if (typeof cur.raw?.opacity === 'number') opacity *= cur.raw.opacity;
  }
  return opacity;
}

/** Scales a raw RGBA buffer's alpha channel by `opacity` (1 = no-op, skipped). */
function applyOpacity(input: CompositeInput, opacity: number): CompositeInput {
  if (opacity >= 1 || !input.raw) return input;
  const out = Buffer.from(input.input);
  for (let i = 3; i < out.length; i += 4) out[i] = Math.round(out[i] * opacity);
  return { ...input, input: out };
}

function extractLeafInput(node: LayerNode, canvasWidth: number, canvasHeight: number): CompositeInput | null {
  const data = node.raw?.imageData?.data as Uint8ClampedArray | undefined;
  const w = node.raw?.imageData?.width as number | undefined;
  const h = node.raw?.imageData?.height as number | undefined;
  if (!data || !w || !h) return null; // empty/adjustment layer etc - nothing to draw

  const clamped = clampRawToCanvas(
    node.left,
    node.top,
    w,
    h,
    Buffer.from(data.buffer, data.byteOffset, data.byteLength),
    canvasWidth,
    canvasHeight
  );
  return clamped && applyOpacity(clamped, getEffectiveOpacity(node));
}

/**
 * Emulates a Photoshop clipping group: zeroes out `target`'s alpha everywhere `mask`'s own alpha
 * is zero, so `target` only ever paints within `mask`'s silhouette - without `mask` itself ever
 * being drawn. Copies `target`'s buffer rather than mutating it, since the same leaf's raw pixels
 * could in principle be reused elsewhere.
 */
function applyClipMask(mask: CompositeInput, target: CompositeInput): CompositeInput {
  if (!mask.raw || !target.raw) return target;
  const channels = 4;
  const { width: maskW, height: maskH } = mask.raw;
  const { width: tW, height: tH } = target.raw;
  const out = Buffer.from(target.input);

  for (let y = 0; y < tH; y++) {
    const maskY = target.top + y - mask.top;
    for (let x = 0; x < tW; x++) {
      const alphaIdx = (y * tW + x) * channels + 3;
      const maskX = target.left + x - mask.left;
      if (maskX < 0 || maskX >= maskW || maskY < 0 || maskY >= maskH) {
        out[alphaIdx] = 0;
        continue;
      }
      if (mask.input[(maskY * maskW + maskX) * channels + 3] === 0) out[alphaIdx] = 0;
    }
  }

  return { left: target.left, top: target.top, raw: target.raw, input: out };
}

/** Walks the tree bottom-to-top (ag-psd's `children[0]` is the bottom of the PS layers panel),
 *  collecting composite ops for every effectively-visible leaf, substituting dynamic text buffers
 *  in place of a leaf's own pixels where queued. */
async function collectCompositeInputs(
  node: LayerNode,
  plan: RenderPlan,
  out: CompositeInput[],
  canvasWidth: number,
  canvasHeight: number
): Promise<void> {
  if (!isEffectivelyVisible(node, plan)) return;

  const override = plan.textOverrides.find((o) => o.node === node);
  if (override) {
    out.push(await renderDynamicText(override.node, override.text, override.style));
    return;
  }

  if (node.isGroup) {
    for (const child of node.children) {
      await collectCompositeInputs(child, plan, out, canvasWidth, canvasHeight);
    }
    return;
  }

  const leaf = extractLeafInput(node, canvasWidth, canvasHeight);
  if (leaf) out.push(leaf);
}

function toOverlayOptions(input: CompositeInput): OverlayOptions {
  return input.raw
    ? { input: input.input, raw: input.raw, left: input.left, top: input.top }
    : { input: input.input, left: input.left, top: input.top };
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function hasRealBounds(node: LayerNode): boolean {
  return node.right > node.left && node.bottom > node.top;
}

/**
 * PSD *group* layers frequently store all-zero left/top/right/bottom in the file - Photoshop
 * derives a group's visual extent from its children rather than persisting one, so a group node's
 * own bounds can't be trusted for sizing. This walks down to real (leaf) bounds and unions them
 * when `node` itself doesn't have usable bounds.
 */
function computeEffectiveBounds(node: LayerNode): Bounds | null {
  if (hasRealBounds(node)) return { left: node.left, top: node.top, right: node.right, bottom: node.bottom };
  if (!node.isGroup) return null;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const child of node.children) {
    const b = computeEffectiveBounds(child);
    if (!b) continue;
    left = Math.min(left, b.left);
    top = Math.min(top, b.top);
    right = Math.max(right, b.right);
    bottom = Math.max(bottom, b.bottom);
  }
  return isFinite(left) ? { left, top, right, bottom } : null;
}

async function loadArtworkComposite(card: ProxyCard, isPendulum: boolean, artPath: string): Promise<CompositeInput> {
  const box = isPendulum ? ART_BOX.pendulum : ART_BOX.normal;

  const resized = await sharp(artPath)
    .resize(box.width, box.height, { fit: 'cover', position: 'top' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    left: box.left,
    top: box.top,
    raw: { width: resized.info.width, height: resized.info.height, channels: 4 },
    input: resized.data,
  };
}

/**
 * A full-canvas replacement for the normal small-box artwork + PSD border combo - used for cards
 * with a special "overframe" image (art that bursts past the usual art-box edges into the frame
 * itself), which already includes its own frame/border art baked in. Cover-fit to the card canvas
 * since these images are authored close to, but not exactly, the template's own aspect ratio.
 */
async function loadOverframeComposite(overframePath: string, width: number, height: number): Promise<CompositeInput> {
  const resized = await sharp(overframePath)
    .resize(width, height, { fit: 'cover', position: 'top' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    left: 0,
    top: 0,
    raw: { width: resized.info.width, height: resized.info.height, channels: 4 },
    input: resized.data,
  };
}

/**
 * Renders the full-size card canvas (art + border + Overlays) as a flattened RGBA PNG buffer -
 * this is the proxy image itself, at whatever resolution the template canvas is (typically
 * 704x1024), suitable for printing.
 */
export async function renderProxyCard(
  tree: PsdTree,
  card: ProxyCard,
  artPath: string,
  overframePath?: string
): Promise<{ png: Buffer; notes: string[] }> {
  if (!fs.existsSync(artPath)) {
    throw new Error(`Artwork not found at ${artPath}`);
  }

  const plan = buildRenderPlan(tree, card, { overframe: !!overframePath });
  const art = overframePath
    ? await loadOverframeComposite(overframePath, tree.width, tree.height)
    : await loadArtworkComposite(card, normalizeCardType(card).isPendulum, artPath);

  // Clip-masked layers (see `plan.clipMasks`) are collected first so they land behind everything
  // the normal traversal finds next - matching where they actually sit in the PSD's own stacking
  // order (e.g. Eff Box behind the ATK/DEF text drawn on top of it), not drawn last/on top of it.
  const layerInputs: CompositeInput[] = [];
  for (const { maskNode, clippedNodes } of plan.clipMasks) {
    const maskInput = extractLeafInput(maskNode, tree.width, tree.height);
    if (!maskInput) continue;
    // The mask/shape layer's own opacity (e.g. Eff Box's 80%) applies to the final clipped result,
    // not to the shape test itself (which only cares whether mask alpha is zero or not).
    const shapeOpacity = getEffectiveOpacity(maskNode);
    for (const clippedNode of clippedNodes) {
      const targetInput = extractLeafInput(clippedNode, tree.width, tree.height);
      if (targetInput) layerInputs.push(applyOpacity(applyClipMask(maskInput, targetInput), shapeOpacity));
    }
  }

  await collectCompositeInputs(resolveContentRoot(tree.root), plan, layerInputs, tree.width, tree.height);

  const composites: OverlayOptions[] = [toOverlayOptions(art), ...layerInputs.map(toOverlayOptions)];

  const png = await sharp({
    create: { width: tree.width, height: tree.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png()
    .toBuffer();

  return { png, notes: plan.notes };
}

// ---------------------------------------------------------------------------
// Debug helpers (used by generateProxy.ts's --list-layers/--inspect)
// ---------------------------------------------------------------------------

export function dumpLayerTree(node: LayerNode, depth: number, lines: string[]): void {
  const indent = '  '.repeat(depth);
  const size = `${node.right - node.left}x${node.bottom - node.top} @(${node.left},${node.top})`;
  const flags = [node.isGroup ? 'group' : 'layer', node.hidden ? 'hidden' : 'visible', node.raw?.text ? 'text' : null]
    .filter(Boolean)
    .join(',');
  lines.push(`${indent}- ${node.name}  [${flags}] ${size}`);
  for (const child of node.children) dumpLayerTree(child, depth + 1, lines);
}

export function nodePath(node: LayerNode): string {
  const parts: string[] = [];
  let cur: LayerNode | null = node;
  while (cur && cur.parent) {
    parts.unshift(cur.name);
    cur = cur.parent;
  }
  return parts.join(' > ');
}
