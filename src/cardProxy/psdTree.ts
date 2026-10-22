import fs from "fs";
import path from "path";
import { readPsd } from "ag-psd";
import "ag-psd/initialize-canvas";
import { LayerNode, PsdTree } from "./types";

export const PSD_PATH = path.join(__dirname, "..", "..", "card-template.psd");

export function buildNode(raw: any, parent: LayerNode | null): LayerNode {
	const isGroup = Array.isArray(raw.children);
	const node: LayerNode = {
		name: raw.name ?? "(unnamed)",
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

function countNodes(node: LayerNode): number {
	return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

let cachedTree: PsdTree | null = null;

export function loadPsdTree(): PsdTree {
	if (cachedTree) return cachedTree;

	if (!fs.existsSync(PSD_PATH)) {
		throw new Error(`PSD template not found at ${PSD_PATH}`);
	}

	console.log(
		`Parsing PSD template (${(fs.statSync(PSD_PATH).size / 1024 / 1024).toFixed(1)} MB)... this can take a bit.`,
	);
	const buffer = fs.readFileSync(PSD_PATH);
	const psd = readPsd(buffer, {
		skipCompositeImageData: true,
		skipThumbnail: true,
		skipLinkedFilesData: true,
		useImageData: true,
	});

	if (psd.bitsPerChannel && psd.bitsPerChannel !== 8) {
		console.warn(
			`⚠️  PSD is ${psd.bitsPerChannel} bits/channel, not 8 - pixel compositing below assumes 8-bit RGBA and may be wrong.`,
		);
	}

	const root: LayerNode = {
		name: "(root)",
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

export function dumpLayerTree(node: LayerNode, depth: number, lines: string[]): void {
	const indent = "  ".repeat(depth);
	const size = `${node.right - node.left}x${node.bottom - node.top} @(${node.left},${node.top})`;
	const flags = [
		node.isGroup ? "group" : "layer",
		node.hidden ? "hidden" : "visible",
		node.raw?.text ? "text" : null,
	]
		.filter(Boolean)
		.join(",");
	lines.push(`${indent}- ${node.name}  [${flags}] ${size}`);
	for (const child of node.children) dumpLayerTree(child, depth + 1, lines);
}
