import { Color, RGB } from "ag-psd";
import { LayerNode } from "./types";

export function normalizeName(name: string): string {
	return name.toLowerCase().replace(/[\s\-_/]+/g, "");
}

export function describeChildren(node: LayerNode): string {
	return node.children.length ? node.children.map((c) => `"${c.name}"`).join(", ") : "(none)";
}

export function findChild(node: LayerNode, candidates: readonly string[]): LayerNode | undefined {
	const normCandidates = candidates.map(normalizeName);
	for (const child of node.children) {
		const n = normalizeName(child.name);
		if (normCandidates.includes(n)) return child;
	}

	for (const child of node.children) {
		const n = normalizeName(child.name);
		if (normCandidates.some((c) => c.length > 0 && (n.includes(c) || c.includes(n)))) return child;
	}

	return undefined;
}

export function findDescendant(
	node: LayerNode,
	candidates: readonly string[],
): LayerNode | undefined {
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

export function findChildBySignature(
	node: LayerNode,
	signatureCandidates: readonly string[],
	minMatches = 2,
): LayerNode | undefined {
	for (const child of node.children) {
		if (!child.isGroup) continue;
		const matches = signatureCandidates.filter((c) => findChild(child, [c])).length;
		if (matches >= minMatches) return child;
	}

	return undefined;
}

export function resolvePath(
	from: LayerNode,
	path: readonly (readonly string[])[],
	label: string,
): LayerNode {
	let cur = from;
	for (const segment of path) {
		const next = findChild(cur, segment);
		if (!next) {
			throw new Error(
				`Could not resolve layer path for "${label}": stuck at "${cur.name}" looking for one of [${segment.join(
					", ",
				)}]. Available children of "${cur.name}": ${describeChildren(cur)}. ` +
					`Run with --list-layers and adjust LAYER_PATHS / *_NAME_CANDIDATES in constants.ts.`,
			);
		}

		cur = next;
	}

	return cur;
}

export function tryResolvePath(
	from: LayerNode,
	path: readonly (readonly string[])[],
): LayerNode | undefined {
	let cur = from;
	for (const segment of path) {
		const next = findChild(cur, segment);
		if (!next) return undefined;
		cur = next;
	}

	return cur;
}

export function resolveContentRoot(
	root: LayerNode,
	contentRootCandidates: readonly string[],
): LayerNode {
	return tryResolvePath(root, [contentRootCandidates]) ?? root;
}

export function humanizeFrameName(key: string): string {
	return key
		.split("_")
		.map((w) => (w.toLowerCase() === "xyz" ? "XYZ" : w.charAt(0).toUpperCase() + w.slice(1)))
		.join(" ");
}

export function humanizeFxName(name: string): string {
	const stripped = name.replace(/^fx_(art_)?/i, "");

	return stripped
		.split(/[_\s]+/)
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

export function psdColorToHex(psdColor: Color | undefined): string | undefined {
	// Only plain 0-255/0-1 RGB colors are supported; other ag-psd color models fall through.
	const color = psdColor as Partial<RGB> | undefined;
	if (
		!color ||
		typeof color.r !== "number" ||
		typeof color.g !== "number" ||
		typeof color.b !== "number"
	)
		return undefined;
	const toByte = (v: number) => Math.max(0, Math.min(255, Math.round(v <= 1 ? v * 255 : v)));
	const hex = (v: number) => toByte(v).toString(16).padStart(2, "0");

	return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

export function formatStat(value: number | null | undefined): string {
	return value === null || value === undefined || value === -1 ? "?" : String(value);
}

export function collectFxNodes(node: LayerNode, out: LayerNode[]): void {
	if (/^fx_/i.test(node.name)) {
		out.push(node);

		return;
	}

	for (const child of node.children) collectFxNodes(child, out);
}

export function nodePath(node: LayerNode): string {
	const parts: string[] = [];
	let cur: LayerNode | null = node;
	while (cur && cur.parent) {
		parts.unshift(cur.name);
		cur = cur.parent;
	}

	return parts.join(" > ");
}
