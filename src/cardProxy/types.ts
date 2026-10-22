import { OverlayOptions } from "sharp";

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
	raw: any;
}

export interface PsdTree {
	root: LayerNode;
	width: number;
	height: number;
}

export interface TextFieldStyle {
	fontFamily: string;
	color: string;
	align: "left" | "center" | "right";
	sizeRatio: number;
	fontSizeOverride?: number;
	ignorePsdFontSize?: boolean;
	offsetX?: number;
	offsetY?: number;
}

export interface RenderPlan {
	forceVisible: Set<LayerNode>;
	forceHidden: Set<LayerNode>;
	textOverrides: Array<{ node: LayerNode; text: string; style: TextFieldStyle }>;
	notes: string[];
	clipMasks: Array<{ maskNode: LayerNode; clippedNodes: LayerNode[] }>;
}

export interface CompositeInput {
	left: number;
	top: number;
	raw?: { width: number; height: number; channels: 4 };
	input: Buffer;
	blend?: NonNullable<OverlayOptions["blend"]>;
}

export interface FrameOption {
	key: string;
	label: string;
}

export interface FxOption {
	key: string;
	label: string;
	group: "art" | "card";
}

export interface ArtBox {
	left: number;
	top: number;
	width: number;
	height: number;
}
