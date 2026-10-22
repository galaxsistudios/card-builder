import { ProxyCard } from "../types";
import { LayerNode, RenderPlan, TextFieldStyle } from "./types";
import {
	LAYER_PATHS,
	BORDER_NAME_CANDIDATES,
	ATTRIBUTE_NAME_CANDIDATES,
	SPELL_TYPE_NAME_CANDIDATES,
	TRAP_TYPE_NAME_CANDIDATES,
	LINK_ARROW_NAME_CANDIDATES,
	TEXT_STYLE,
} from "./constants";
import {
	findChild,
	findDescendant,
	resolvePath,
	tryResolvePath,
	describeChildren,
	resolveContentRoot,
} from "./layerUtils";

export function forceVisibleChain(plan: RenderPlan, node: LayerNode): void {
	let cur: LayerNode | null = node;
	while (cur) {
		plan.forceVisible.add(cur);
		plan.forceHidden.delete(cur);
		cur = cur.parent;
	}
}

export function forceHiddenNode(plan: RenderPlan, node: LayerNode): void {
	plan.forceHidden.add(node);
	plan.forceVisible.delete(node);
}

export function forceOnlyVisible(
	plan: RenderPlan,
	group: LayerNode,
	child: LayerNode | undefined,
): void {
	forceVisibleChain(plan, group);
	for (const c of group.children) {
		if (c !== child) forceHiddenNode(plan, c);
	}

	if (child) forceVisibleChain(plan, child);
}

function normalizeCardType(card: ProxyCard): {
	isMonster: boolean;
	isSpell: boolean;
	isTrap: boolean;
	isXyz: boolean;
	isPendulum: boolean;
} {
	const type = (card.type ?? "").toUpperCase();
	const frameType = (card.frameType ?? "").toLowerCase();

	return {
		isMonster: type === "MONSTER" || type.includes("MONSTER"),
		// Real card data's `type` is "Spell Card"/"Trap Card" (ygoprodeck's own convention, also
		// what electron/mdpro4/cardDecoder.ts produces) - matching the bare "SPELL"/"TRAP" this used
		// to check meant this never matched anything, silently hiding every Spell/Trap's corner
		// icons (and, worse, their entire Overlays group) in every render.
		isSpell: type.startsWith("SPELL"),
		isTrap: type.startsWith("TRAP"),
		isXyz: frameType.includes("xyz"),
		isPendulum: frameType.includes("pendulum"),
	};
}

function findTextLeaf(node: LayerNode): LayerNode | undefined {
	if (node.raw?.text) return node;
	for (const child of node.children) {
		const found = findTextLeaf(child);
		if (found) return found;
	}

	return undefined;
}

function formatStat(value: number | null | undefined): string {
	return value === null || value === undefined || value === -1 ? "?" : String(value);
}

function findFxNode(root: LayerNode, key: string): LayerNode | undefined {
	const collectFxNodes = (node: LayerNode, out: LayerNode[]): void => {
		if (/^fx_/i.test(node.name)) {
			out.push(node);

			return;
		}

		for (const child of node.children) collectFxNodes(child, out);
	};

	const nodes: LayerNode[] = [];
	collectFxNodes(root, nodes);

	return nodes.find((n) => n.name === key);
}

export function buildRenderPlan(
	tree: any,
	card: ProxyCard,
	options?: { overframe?: boolean },
): RenderPlan {
	const plan: RenderPlan = {
		forceVisible: new Set(),
		forceHidden: new Set(),
		textOverrides: [],
		notes: [],
		clipMasks: [],
	};
	const root = resolveContentRoot(tree.root, LAYER_PATHS.contentRoot);
	const kind = normalizeCardType(card);

	const artNode = tryResolvePath(root, [LAYER_PATHS.art]);
	if (artNode) forceHiddenNode(plan, artNode);
	else
		plan.notes.push(
			`No "${LAYER_PATHS.art.join("/")}" layer found - skipping (artwork is drawn directly).`,
		);

	const overframeArtworkPlaceholder = tryResolvePath(root, [
		LAYER_PATHS.overframeArtworkPlaceholder,
	]);
	if (overframeArtworkPlaceholder) forceHiddenNode(plan, overframeArtworkPlaceholder);

	const border = resolvePath(root, [LAYER_PATHS.border], "Border group");
	// Overframe cards go fully borderless - the effect-text background instead comes from the
	// template's one Eff Box/Eff Outline asset (see applyOverframeEffectBox below), which lives
	// under the Monster-only part of the tree but is reused for Spell/Trap too, since it's the
	// only such asset the template has.
	if (options?.overframe) {
		forceOnlyVisible(plan, border, undefined);
	} else {
		const frameKey = (card.frameType ?? "normal").toLowerCase();
		const borderCandidates = BORDER_NAME_CANDIDATES[frameKey] ?? [card.frameType ?? "Normal"];
		const borderChild = findChild(border, borderCandidates);
		if (!borderChild) {
			throw new Error(
				`Could not find a Border layer for frameType "${card.frameType}" (tried [${borderCandidates.join(
					", ",
				)}]). Available: ${describeChildren(border)}.`,
			);
		}

		forceOnlyVisible(plan, border, borderChild);
	}

	const overlays = resolvePath(root, [LAYER_PATHS.overlays], "Overlays group");
	const overlaysMonster = tryResolvePath(overlays, [LAYER_PATHS.overlaysMonster]);
	const overlaysSpellTrap = tryResolvePath(overlays, [LAYER_PATHS.overlaysSpellTrap]);

	if (kind.isMonster) {
		if (!overlaysMonster)
			throw new Error(
				`Could not find Overlays > Monster. Available: ${describeChildren(overlays)}.`,
			);
		forceOnlyVisible(plan, overlays, overlaysMonster);
		buildMonsterPlan(plan, overlaysMonster, card, kind, !!options?.overframe);
	} else if (kind.isSpell || kind.isTrap) {
		if (!overlaysSpellTrap)
			throw new Error(
				`Could not find Overlays > Spell/Trap. Available: ${describeChildren(overlays)}.`,
			);
		forceOnlyVisible(plan, overlays, overlaysSpellTrap);
		buildSpellTrapPlan(plan, overlaysSpellTrap, card, kind);
		if (options?.overframe && overlaysMonster) applyOverframeEffectBox(plan, overlaysMonster, kind);
	} else {
		forceOnlyVisible(plan, overlays, undefined);
		plan.notes.push(
			`Card type "${card.type}" is neither Monster nor Spell/Trap - Overlays left hidden.`,
		);
	}

	for (const key of card.fx ?? []) {
		const node = findFxNode(tree.root, key);
		if (node) forceVisibleChain(plan, node);
		else plan.notes.push(`fx "${key}" not found (run --list-fx to see valid values).`);
	}

	return plan;
}

// Reveals the overframe effect-text background from an already-resolved "Overframe" node (see
// LAYER_PATHS.monsterOverframeGroup) - its "Eff Box" (picking the Pendulum or non-Pendulum
// variant) and matching outline, while keeping "Frames copy" (the duplicate colored border) fully
// hidden, same as every overframe card. This is the one such asset the template has; both
// buildMonsterPlan and applyOverframeEffectBox (for Spell/Trap, which has none of its own) reuse
// it as-is. "Eff Box"/"PenEff_Outline"/"Eff_Outline" are direct children of `overframeGroup` -
// findChild reaches them directly, rather than findDescendant's 2-level search from further up,
// which silently missed them (meaning the Pendulum/non-Pendulum choice below never actually ran
// until now; whichever variant the PSD happened to default to - "Eff_Box" - just always showed).
function revealOverframeEffectBox(plan: RenderPlan, overframeGroup: LayerNode, kind: any): void {
	forceVisibleChain(plan, overframeGroup);

	const framesChild = findChild(overframeGroup, LAYER_PATHS.overframeFrames);
	if (framesChild) forceOnlyVisible(plan, framesChild, undefined);

	const effBox = findChild(overframeGroup, LAYER_PATHS.overframeEffBox);
	if (!effBox) return;
	forceVisibleChain(plan, effBox);
	const penBox = findChild(effBox, LAYER_PATHS.overframeEffBoxPen);
	const nonPenBox = findChild(effBox, LAYER_PATHS.overframeEffBoxNonPen);
	if (kind.isPendulum) {
		if (penBox) forceVisibleChain(plan, penBox);
		if (nonPenBox) forceHiddenNode(plan, nonPenBox);
	} else {
		if (penBox) forceHiddenNode(plan, penBox);
		if (nonPenBox) forceVisibleChain(plan, nonPenBox);
	}

	const penOutline = findChild(overframeGroup, LAYER_PATHS.overframeEffOutlinePen);
	const nonPenOutline = findChild(overframeGroup, LAYER_PATHS.overframeEffOutlineNonPen);
	if (kind.isPendulum) {
		if (penOutline) forceVisibleChain(plan, penOutline);
		if (nonPenOutline) forceHiddenNode(plan, nonPenOutline);
	} else {
		if (penOutline) forceHiddenNode(plan, penOutline);
		if (nonPenOutline) forceVisibleChain(plan, nonPenOutline);
	}
}

// Spell/Trap cards have no Eff Box of their own anywhere in the template, so an overframe one
// borrows the Monster-only tree's (see revealOverframeEffectBox) - reached from "Monster Parts"
// down through "ATK / DEF" > "ATK/DEF Values" > "Overframe", hiding every other Monster-only
// decoration (attribute icon, stars, the ATK/DEF text itself, Link Rating, Pendulum Scale) that
// revealing this one path back through their shared ancestors would otherwise also expose.
function applyOverframeEffectBox(plan: RenderPlan, monster: LayerNode, kind: any): void {
	const atkDefGroup = tryResolvePath(monster, [LAYER_PATHS.monsterAtkDefGroup]);
	if (!atkDefGroup) return;
	forceOnlyVisible(plan, monster, atkDefGroup);

	const atkDefValues = findChild(atkDefGroup, ["ATK/DEF Values"]);
	if (!atkDefValues) return;
	forceOnlyVisible(plan, atkDefGroup, atkDefValues);

	const overframeGroup = findChild(atkDefValues, LAYER_PATHS.monsterOverframeGroup);
	if (!overframeGroup) return;
	forceOnlyVisible(plan, atkDefValues, overframeGroup);

	revealOverframeEffectBox(plan, overframeGroup, kind);
}

function buildMonsterPlan(
	plan: RenderPlan,
	monster: LayerNode,
	card: ProxyCard,
	kind: any,
	isOverframe: boolean,
): void {
	const attributeGroup = tryResolvePath(monster, [LAYER_PATHS.monsterAttribute]);
	if (attributeGroup) {
		const attr = (card.attribute ?? "").toUpperCase();
		const candidates = ATTRIBUTE_NAME_CANDIDATES[attr] ?? [card.attribute ?? ""];
		const attrChild = findChild(attributeGroup, candidates);
		forceOnlyVisible(plan, attributeGroup, attrChild);
		if (!attrChild)
			plan.notes.push(`Attribute "${card.attribute}" not matched under "${attributeGroup.name}".`);
	} else {
		plan.notes.push("No Attribute group found under Overlays > Monster.");
	}

	const statsRoot = tryResolvePath(monster, [LAYER_PATHS.monsterStatsGroup]) ?? monster;
	const levelGroup = tryResolvePath(statsRoot, [LAYER_PATHS.monsterLevel]);
	const rankGroup = tryResolvePath(statsRoot, [LAYER_PATHS.monsterRank]);
	const minusLevelGroup = tryResolvePath(statsRoot, [LAYER_PATHS.monsterMinusLevel]);
	const isMinusLevel = ((card.level ?? 0) < 0 || card.frameType === "dark_synchro") && !kind.isXyz;
	const starCount = Math.abs(card.level ?? 0);

	if (minusLevelGroup && !isMinusLevel) forceHiddenNode(plan, minusLevelGroup);

	if (kind.isXyz) {
		if (levelGroup) forceHiddenNode(plan, levelGroup);
		if (rankGroup) {
			if (starCount === 13) {
				const rank13 = tryResolvePath(rankGroup, [LAYER_PATHS.monsterRank13]);
				forceOnlyVisible(plan, rankGroup, undefined);
				if (rank13) forceVisibleChain(plan, rank13);
				else plan.notes.push(`Rank 13 special layer not found under "${rankGroup.name}".`);
			} else {
				applyStarCount(plan, rankGroup, starCount, "rank");
			}
		} else {
			plan.notes.push("No Rank group found under Overlays > Monster for an Xyz monster.");
		}
	} else {
		if (rankGroup) forceHiddenNode(plan, rankGroup);
		if (isMinusLevel) {
			if (levelGroup) forceHiddenNode(plan, levelGroup);
			if (minusLevelGroup) applyStarCount(plan, minusLevelGroup, starCount, "level", true);
			else
				plan.notes.push(
					"No Minus Level group found under Overlays > Monster for a negative-level monster.",
				);
		} else if (levelGroup) {
			applyStarCount(plan, levelGroup, starCount, "level");
		} else {
			plan.notes.push("No Level group found under Overlays > Monster.");
		}
	}

	const atkDefGroup = tryResolvePath(monster, [LAYER_PATHS.monsterAtkDefGroup]);
	if (!atkDefGroup) plan.notes.push("No ATK / DEF group found under Overlays > Monster.");

	const overframeGroup =
		atkDefGroup && findDescendant(atkDefGroup, LAYER_PATHS.monsterOverframeGroup);
	if (overframeGroup) {
		if (isOverframe) revealOverframeEffectBox(plan, overframeGroup, kind);
		else forceHiddenNode(plan, overframeGroup);
	}

	const atkNode = atkDefGroup && findDescendant(atkDefGroup, LAYER_PATHS.monsterAtkValue);
	const atkUnknownNode =
		atkDefGroup && findDescendant(atkDefGroup, LAYER_PATHS.monsterAtkValueUnknown);
	const defNode = atkDefGroup && findDescendant(atkDefGroup, LAYER_PATHS.monsterDefValue);
	const defUnknownNode =
		atkDefGroup && findDescendant(atkDefGroup, LAYER_PATHS.monsterDefValueUnknown);

	if (formatStat(card.atk) === "?") {
		if (atkUnknownNode) {
			forceVisibleChain(plan, atkUnknownNode);
			if (atkNode) forceHiddenNode(plan, atkNode);
		}
	} else {
		if (atkUnknownNode) forceHiddenNode(plan, atkUnknownNode);
		if (atkNode) {
			forceVisibleChain(plan, atkNode);
			plan.textOverrides.push({ node: atkNode, text: formatStat(card.atk), style: TEXT_STYLE.atk });
		} else if (atkDefGroup) {
			plan.notes.push(`No atkValue layer found under "${atkDefGroup.name}".`);
		}
	}

	const linkGroup = tryResolvePath(monster, [LAYER_PATHS.monsterLinkGroup]);
	if (kind.isXyz && card.def !== undefined && card.def !== -1) {
		if (linkGroup) forceHiddenNode(plan, linkGroup);
	} else if (kind.isXyz) {
		if (atkNode && !formatStat(card.atk || 0).includes("?")) forceVisibleChain(plan, atkNode);
		if (linkGroup) {
			forceVisibleChain(plan, linkGroup);
			const linkValue = findDescendant(linkGroup, LAYER_PATHS.monsterLinkValue);
			if (linkValue)
				plan.textOverrides.push({
					node: linkValue,
					text: formatStat(card.def),
					style: TEXT_STYLE.link,
				});
			const arrowsGroup = findDescendant(linkGroup, LAYER_PATHS.monsterLinkArrows);
			if (arrowsGroup) {
				const markers = card.linkMarkers ?? [];
				const activeChildren = markers
					.map((m) => findChild(arrowsGroup, LINK_ARROW_NAME_CANDIDATES[m] ?? [m]))
					.filter((c): c is LayerNode => !!c);
				for (const child of arrowsGroup.children) {
					if (!activeChildren.includes(child)) forceHiddenNode(plan, child);
				}

				for (const child of activeChildren) forceVisibleChain(plan, child);
				if (activeChildren.length !== markers.length) {
					plan.notes.push(
						`Only matched ${activeChildren.length}/${markers.length} link arrows (markers: ${markers.join(", ")}).`,
					);
				}
			} else {
				plan.notes.push("No Links (arrows) group found for a Link monster.");
			}
		} else {
			plan.notes.push("No Link Rating group found under Overlays > Monster for a Link monster.");
		}
	} else {
		if (linkGroup) forceHiddenNode(plan, linkGroup);
		if (formatStat(card.def) === "?" && defUnknownNode) {
			forceVisibleChain(plan, defUnknownNode);
			if (defNode) forceHiddenNode(plan, defNode);
		} else {
			if (defUnknownNode) forceHiddenNode(plan, defUnknownNode);
			if (defNode) {
				forceVisibleChain(plan, defNode);
				plan.textOverrides.push({
					node: defNode,
					text: formatStat(card.def),
					style: TEXT_STYLE.def,
				});
			} else if (atkDefGroup) {
				plan.notes.push(`No defValue layer found under "${atkDefGroup.name}".`);
			}
		}
	}

	const scaleGroup = tryResolvePath(monster, [LAYER_PATHS.monsterPenScaleGroup]);
	const scaleL = scaleGroup && tryResolvePath(scaleGroup, [LAYER_PATHS.monsterPenScaleL]);
	const scaleR = scaleGroup && tryResolvePath(scaleGroup, [LAYER_PATHS.monsterPenScaleR]);
	if (kind.isPendulum) {
		if (scaleL) {
			forceVisibleChain(plan, scaleL);
			plan.textOverrides.push({
				node: scaleL,
				text: formatStat(card.scale),
				style: TEXT_STYLE.scale,
			});
		} else
			plan.notes.push(
				`No Scale L layer found under "${scaleGroup?.name ?? LAYER_PATHS.monsterPenScaleGroup[0]}" for a Pendulum monster.`,
			);
		if (scaleR) {
			forceVisibleChain(plan, scaleR);
			plan.textOverrides.push({
				node: scaleR,
				text: formatStat(card.scale),
				style: TEXT_STYLE.scale,
			});
		} else
			plan.notes.push(
				`No Scale R layer found under "${scaleGroup?.name ?? LAYER_PATHS.monsterPenScaleGroup[0]}" for a Pendulum monster.`,
			);
	} else if (scaleGroup) {
		forceHiddenNode(plan, scaleGroup);
	}
}

function applyStarCount(
	plan: RenderPlan,
	group: LayerNode,
	count: number,
	prefix: "level" | "rank",
	fromTop = false,
): void {
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

function buildSpellTrapPlan(
	plan: RenderPlan,
	spellTrap: LayerNode,
	card: ProxyCard,
	kind: any,
): void {
	const attributeGroup = tryResolvePath(spellTrap, [LAYER_PATHS.spellTrapAttribute]);
	const iconsGroup = tryResolvePath(spellTrap, [LAYER_PATHS.spellTrapIcons]) ?? spellTrap;
	const race = card.race ?? "";
	const typeCandidates = kind.isSpell
		? SPELL_TYPE_NAME_CANDIDATES[race]
		: TRAP_TYPE_NAME_CANDIDATES[race];
	const typeChild = typeCandidates ? findChild(iconsGroup, typeCandidates) : undefined;

	for (const child of iconsGroup.children) {
		if (child === typeChild || child === attributeGroup) continue;
		forceHiddenNode(plan, child);
	}

	if (typeChild) forceVisibleChain(plan, typeChild);
	if (race && race !== "Normal" && !typeChild) {
		plan.notes.push(
			`${kind.isSpell ? "Spell" : "Trap"} race "${race}" not matched under "${iconsGroup.name}". Available: ${describeChildren(iconsGroup)}.`,
		);
	}

	if (attributeGroup) {
		const attrChild = findChild(attributeGroup, [
			kind.isSpell ? "attribute-spell" : "attribute-trap",
		]);
		forceOnlyVisible(plan, attributeGroup, attrChild);
		if (!attrChild)
			plan.notes.push(`Spell/Trap corner icon not matched under "${attributeGroup.name}".`);
	} else {
		plan.notes.push('No Spell/Trap corner-icon "attribute" group found.');
	}
}
