import path from "path";
import fs from "fs";
import sharp, { OverlayOptions } from "sharp";
import { LayerNode, PsdTree, RenderPlan, CompositeInput, TextFieldStyle } from "./types";
import { BLEND_MODE_MAP } from "./constants";
import { psdColorToHex } from "./layerUtils";

export const FONTS_DIR = path.join(__dirname, "..", "..", "fonts");

export function isEffectivelyVisible(node: LayerNode, plan: RenderPlan): boolean {
	let cur: LayerNode | null = node;
	while (cur) {
		if (plan.forceHidden.has(cur)) return false;
		if (!plan.forceVisible.has(cur) && cur.hidden) return false;
		cur = cur.parent;
	}

	return true;
}

export function resolveBlendMode(node: LayerNode, notes: string[]): CompositeInput["blend"] {
	const mode = (node.raw?.blendMode as string | undefined)?.toLowerCase();
	if (!mode || mode === "normal" || mode === "pass through") return undefined;
	const mapped = BLEND_MODE_MAP[mode];
	if (!mapped) {
		notes.push(
			`Layer "${node.name}" uses PSD blend mode "${mode}", which has no sharp/libvips equivalent - rendered as normal instead.`,
		);

		return undefined;
	}

	return mapped;
}

export function getEffectiveOpacity(node: LayerNode): number {
	let opacity = typeof node.raw?.fillOpacity === "number" ? node.raw.fillOpacity : 1;
	for (let cur: LayerNode | null = node; cur; cur = cur.parent) {
		if (typeof cur.raw?.opacity === "number") opacity *= cur.raw.opacity;
	}

	return opacity;
}

export function applyOpacity(input: CompositeInput, opacity: number): CompositeInput {
	if (opacity >= 1 || !input.raw) return input;
	const out = Buffer.from(input.input);
	for (let i = 3; i < out.length; i += 4) out[i] = Math.round(out[i] * opacity);

	return { ...input, input: out };
}

export function clampRawToCanvas(
	left: number,
	top: number,
	width: number,
	height: number,
	data: Buffer,
	canvasWidth: number,
	canvasHeight: number,
): CompositeInput | null {
	const srcLeft = Math.max(0, -left);
	const srcTop = Math.max(0, -top);
	const dstLeft = Math.max(0, left);
	const dstTop = Math.max(0, top);
	const cropWidth = Math.min(width - srcLeft, canvasWidth - dstLeft);
	const cropHeight = Math.min(height - srcTop, canvasHeight - dstTop);
	if (cropWidth <= 0 || cropHeight <= 0) return null;

	if (srcLeft === 0 && srcTop === 0 && cropWidth === width && cropHeight === height) {
		return {
			left: dstLeft,
			top: dstTop,
			raw: { width, height, channels: 4 },
			input: data,
		};
	}

	const channels = 4;
	const cropped = Buffer.alloc(cropWidth * cropHeight * channels);
	for (let y = 0; y < cropHeight; y++) {
		const srcRowStart = ((srcTop + y) * width + srcLeft) * channels;
		data.copy(cropped, y * cropWidth * channels, srcRowStart, srcRowStart + cropWidth * channels);
	}

	return {
		left: dstLeft,
		top: dstTop,
		raw: { width: cropWidth, height: cropHeight, channels: 4 },
		input: cropped,
	};
}

export function extractLeafInput(
	node: LayerNode,
	canvasWidth: number,
	canvasHeight: number,
	notes: string[],
): CompositeInput | null {
	const data = node.raw?.imageData?.data as Uint8ClampedArray | undefined;
	const w = node.raw?.imageData?.width as number | undefined;
	const h = node.raw?.imageData?.height as number | undefined;
	if (!data || !w || !h) return null;

	const clamped = clampRawToCanvas(
		node.left,
		node.top,
		w,
		h,
		Buffer.from(data.buffer, data.byteOffset, data.byteLength),
		canvasWidth,
		canvasHeight,
	);
	if (!clamped) return null;

	const withOpacity = applyOpacity(clamped, getEffectiveOpacity(node));
	const blend = resolveBlendMode(node, notes);

	return blend ? { ...withOpacity, blend } : withOpacity;
}

export function applyClipMask(mask: CompositeInput, target: CompositeInput): CompositeInput {
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

	return {
		left: target.left,
		top: target.top,
		raw: target.raw,
		input: out,
		blend: target.blend,
	};
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

export function computeEffectiveBounds(node: LayerNode): Bounds | null {
	if (hasRealBounds(node))
		return {
			left: node.left,
			top: node.top,
			right: node.right,
			bottom: node.bottom,
		};
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

export function resolveTextStyle(node: LayerNode, fallback: TextFieldStyle, boxHeight: number) {
	const psdStyle = node.raw?.text?.style;
	const psdFontName = psdStyle?.font?.name?.replace(/-Regular$/i, "");
	const fontFamily = psdFontName || fallback.fontFamily;
	const psdFontSize = psdStyle?.fontSize ?? 0;
	const fontSize =
		fallback.fontSizeOverride ??
		(!fallback.ignorePsdFontSize && psdFontSize > 0
			? Math.round(psdFontSize)
			: Math.round(boxHeight * fallback.sizeRatio));
	const color = psdColorToHex(psdStyle?.fillColor) ?? fallback.color;
	const letterSpacing =
		typeof psdStyle?.tracking === "number"
			? Math.round((psdStyle.tracking / 1000) * fontSize * 100) / 100
			: 0;
	const italic = !!psdStyle?.fauxItalic;

	return { fontFamily, fontSize, color, letterSpacing, italic };
}

const FONT_EXTENSIONS = { ".ttf": "truetype", ".otf": "opentype" } as const;
const fontFaceCssCache = new Map<string, string>();

export function loadFontFaceCss(fontFamily: string): string {
	const cached = fontFaceCssCache.get(fontFamily);
	if (cached !== undefined) return cached;

	let css = "";
	for (const [ext, format] of Object.entries(FONT_EXTENSIONS)) {
		const fontPath = path.join(FONTS_DIR, `${fontFamily}${ext}`);
		if (fs.existsSync(fontPath)) {
			const base64 = fs.readFileSync(fontPath).toString("base64");
			css = `<style>@font-face { font-family: '${fontFamily}'; src: url(data:font/${ext.slice(1)};base64,${base64}) format('${format}'); }</style>`;
			break;
		}
	}

	fontFaceCssCache.set(fontFamily, css);

	return css;
}

export async function renderDynamicText(
	node: LayerNode,
	text: string,
	fallback: TextFieldStyle,
): Promise<CompositeInput> {
	const bounds = computeEffectiveBounds(node) ?? {
		left: node.left,
		top: node.top,
		right: node.left + 1,
		bottom: node.top + 1,
	};
	const boxWidth = Math.max(1, bounds.right - bounds.left);
	const boxHeight = Math.max(1, bounds.bottom - bounds.top);
	const { fontFamily, fontSize, color, letterSpacing, italic } = resolveTextStyle(
		node,
		fallback,
		boxHeight,
	);

	const estimatedTextWidth = Math.ceil(text.length * (fontSize * 0.7 + letterSpacing)) + 8;
	const width = Math.max(boxWidth, estimatedTextWidth);
	const left =
		fallback.align === "right"
			? Math.round(bounds.right - width)
			: fallback.align === "left"
				? bounds.left
				: Math.round(bounds.left - (width - boxWidth) / 2);

	const estimatedTextHeight = Math.ceil(fontSize * 1.2) + 8;
	const height = Math.max(boxHeight, estimatedTextHeight);
	const top = Math.round(bounds.top - (height - boxHeight) / 2) + (fallback.offsetY ?? 0);
	const nudgedLeft = left + (fallback.offsetX ?? 0);

	const anchor =
		fallback.align === "left" ? "start" : fallback.align === "right" ? "end" : "middle";
	const x = fallback.align === "left" ? 0 : fallback.align === "right" ? width : width / 2;
	const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${loadFontFaceCss(fontFamily)}
    <text x="${x}" y="${height / 2}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="bold" font-style="${italic ? "italic" : "normal"}" letter-spacing="${letterSpacing}" fill="${color}" text-anchor="${anchor}" dominant-baseline="central">${escaped}</text>
  </svg>`;
	const buffer = await sharp(Buffer.from(svg)).png().toBuffer();

	return { left: nudgedLeft, top, input: buffer };
}

export async function collectCompositeInputs(
	node: LayerNode,
	plan: RenderPlan,
	out: CompositeInput[],
	canvasWidth: number,
	canvasHeight: number,
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

	const leaf = extractLeafInput(node, canvasWidth, canvasHeight, plan.notes);
	if (leaf) out.push(leaf);
}

export function toOverlayOptions(input: CompositeInput): OverlayOptions {
	const base = input.raw
		? { input: input.input, raw: input.raw, left: input.left, top: input.top }
		: { input: input.input, left: input.left, top: input.top };

	return input.blend ? { ...base, blend: input.blend } : base;
}

export async function compositeWithLayers(
	tree: PsdTree,
	art: CompositeInput,
	plan: RenderPlan,
	canvasWidth: number,
	canvasHeight: number,
): Promise<Buffer> {
	const layerInputs: CompositeInput[] = [];
	for (const { maskNode, clippedNodes } of plan.clipMasks) {
		const maskInput = extractLeafInput(maskNode, canvasWidth, canvasHeight, plan.notes);
		if (!maskInput) continue;
		const shapeOpacity = getEffectiveOpacity(maskNode);
		for (const clippedNode of clippedNodes) {
			const targetInput = extractLeafInput(clippedNode, canvasWidth, canvasHeight, plan.notes);
			if (targetInput)
				layerInputs.push(applyOpacity(applyClipMask(maskInput, targetInput), shapeOpacity));
		}
	}

	await collectCompositeInputs(tree.root, plan, layerInputs, canvasWidth, canvasHeight);

	const composites: OverlayOptions[] = [
		toOverlayOptions(art),
		...layerInputs.map(toOverlayOptions),
	];

	const png = await sharp({
		create: {
			width: canvasWidth,
			height: canvasHeight,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.composite(composites)
		.png()
		.toBuffer();

	return png;
}
