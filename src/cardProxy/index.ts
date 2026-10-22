import fs from "fs";
import sharp from "sharp";
import { ProxyCard } from "../types";
import { PsdTree, LayerNode, CompositeInput, RenderPlan } from "./types";
import { FrameOption, FxOption } from "./types";
import { loadPsdTree, dumpLayerTree } from "./psdTree";
import { buildRenderPlan } from "./renderPlan";
import {
	collectCompositeInputs,
	toOverlayOptions,
	extractLeafInput,
	getEffectiveOpacity,
	applyClipMask,
	applyOpacity,
} from "./compositing";
import {
	resolveContentRoot,
	tryResolvePath,
	findChild,
	humanizeFrameName,
	humanizeFxName,
	collectFxNodes,
	nodePath,
} from "./layerUtils";
import { LAYER_PATHS, BORDER_NAME_CANDIDATES, FX_LABELS, ART_BOX } from "./constants";

export { loadPsdTree, dumpLayerTree, nodePath, buildRenderPlan };
export type { PsdTree, LayerNode, FrameOption, FxOption, CompositeInput, RenderPlan };

async function loadArtworkComposite(
	card: ProxyCard,
	isPendulum: boolean,
	artPath: string,
): Promise<CompositeInput> {
	const box = isPendulum ? ART_BOX.pendulum : ART_BOX.normal;

	const resized = await sharp(artPath)
		.resize(box.width, box.height, { fit: "cover", position: "top" })
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

async function loadOverframeComposite(
	overframePath: string,
	width: number,
	height: number,
): Promise<CompositeInput> {
	const resized = await sharp(overframePath)
		.resize(width, height, { fit: "cover", position: "top" })
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

function normalizeCardType(card: ProxyCard) {
	const type = (card.type ?? "").toUpperCase();
	const frameType = (card.frameType ?? "").toLowerCase();

	return {
		isMonster: type === "MONSTER" || type.includes("MONSTER"),
		// See the identical fix in renderPlan.ts's own copy of this function - real data's `type`
		// is "Spell Card"/"Trap Card", never the bare "SPELL"/"TRAP" this used to check for.
		isSpell: type.startsWith("SPELL"),
		isTrap: type.startsWith("TRAP"),
		isXyz: frameType.includes("xyz"),
		isPendulum: frameType.includes("pendulum"),
	};
}

export function listFrameOptions(): FrameOption[] {
	const tree = loadPsdTree();
	const border = tryResolvePath(resolveContentRoot(tree.root, LAYER_PATHS.contentRoot), [
		LAYER_PATHS.border,
	]);
	if (!border) return [];

	return Object.entries(BORDER_NAME_CANDIDATES)
		.filter(([, candidates]) => findChild(border, candidates))
		.map(([key]) => ({ key, label: humanizeFrameName(key) }));
}

export function listFxOptions(): FxOption[] {
	const tree = loadPsdTree();
	const nodes: LayerNode[] = [];
	collectFxNodes(tree.root, nodes);

	return nodes.map((n) => ({
		key: n.name,
		label: FX_LABELS[n.name] ?? humanizeFxName(n.name),
		group: /^fx_art_/i.test(n.name) ? "art" : "card",
	}));
}

export async function renderProxyCard(
	tree: PsdTree,
	card: ProxyCard,
	artPath: string,
	overframePath?: string,
): Promise<{ png: Buffer; notes: string[] }> {
	if (!fs.existsSync(artPath)) {
		throw new Error(`Artwork not found at ${artPath}`);
	}

	const plan = buildRenderPlan(tree, card, { overframe: !!overframePath });
	const art = overframePath
		? await loadOverframeComposite(overframePath, tree.width, tree.height)
		: await loadArtworkComposite(card, normalizeCardType(card).isPendulum, artPath);

	const layerInputs: CompositeInput[] = [];
	for (const { maskNode, clippedNodes } of plan.clipMasks) {
		const maskInput = extractLeafInput(maskNode, tree.width, tree.height, plan.notes);
		if (!maskInput) continue;
		const shapeOpacity = getEffectiveOpacity(maskNode);
		for (const clippedNode of clippedNodes) {
			const targetInput = extractLeafInput(clippedNode, tree.width, tree.height, plan.notes);
			if (targetInput)
				layerInputs.push(applyOpacity(applyClipMask(maskInput, targetInput), shapeOpacity));
		}
	}

	await collectCompositeInputs(tree.root, plan, layerInputs, tree.width, tree.height);

	const composites = [toOverlayOptions(art), ...layerInputs.map(toOverlayOptions)];

	const png = await sharp({
		create: {
			width: tree.width,
			height: tree.height,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.composite(composites)
		.png()
		.toBuffer();

	return { png, notes: plan.notes };
}
