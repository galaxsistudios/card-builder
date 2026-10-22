// Shape of the `window.api` bridge exposed by electron/preload.ts.
export interface CardSummary {
	id: number;
	name: string;
	type: string;
}

export interface CardArtwork {
	// The art image's own id (not the card's id) - distinguishes alternate arts of the same card.
	// Negative for the overframe pseudo-variant (see electron/proxyService.ts's getCardArtworks).
	id: number;
	dataUrl: string;
	// Set only on the overframe entry, if the card has one - picking it switches rendering to
	// overframe style (full-bleed art, no border/frame override).
	isOverframe?: boolean;
}

export interface GenerateResult {
	outputPath: string;
	dataUrl: string;
	notes: string[];
}

export interface FxOption {
	// The PSD layer's own exact name - what to pass back in `generateProxy`'s `fx` array.
	key: string;
	label: string;
	// `art` effects sit over the artwork box; `card` effects cover the whole card.
	group: "art" | "card";
}

export interface FrameOption {
	// What `generateProxy`'s `frameType` must match.
	key: string;
	label: string;
}

export type YdkSection = "main" | "extra" | "side";

export interface YdkCardEntry {
	id: number;
	name: string;
	type: string;
	artworks: CardArtwork[];
}

export interface YdkImportResult {
	// The .ydk file's own name (no extension) - also the output subfolder this batch saves into.
	deckName: string;
	// A card that appears in more than one section is only ever listed once, under whichever
	// section it was first seen in.
	main: YdkCardEntry[];
	extra: YdkCardEntry[];
	side: YdkCardEntry[];
	// Ids in the file that aren't resolvable locally (not in the database, or no downloaded art).
	missingIds: number[];
	// The deck's true composition, per section, duplicates included - passed straight back to
	// generateYdkBatch so it can assemble a decklist.png matching the real deck.
	rawSections: Record<YdkSection, number[]>;
}

export interface YdkGenerateSelection {
	cardId: number;
	artId: number;
	section: YdkSection;
}

export interface YdkGenerateResult extends YdkGenerateSelection {
	outputPath: string;
	dataUrl: string;
}

export interface YdkGenerateFailure extends YdkGenerateSelection {
	error: string;
}

export interface YdkBatchResult {
	results: YdkGenerateResult[];
	failed: YdkGenerateFailure[];
	// The combined overview image (output/<deckName>/decklist.png) - unset if there was nothing to
	// put in one, or the layout step itself failed (see decklistError), without that failing the
	// rest of an otherwise-successful batch.
	decklistImagePath?: string;
	decklistDataUrl?: string;
	decklistError?: string;
}

export interface CustomCardInput {
	name: string;
	type: string;
	frameType: string;
	atk?: number | null;
	def?: number | null;
	level?: number | null;
	race?: string | null;
	attribute?: string | null;
	scale?: number | null;
	linkMarkers?: string[] | null;
	fx?: string[] | null;
}

export interface PickedArtwork {
	path: string;
	dataUrl: string;
}

export interface CustomSaveResult extends GenerateResult {
	id: number;
}

export interface Mdpro4Validation {
	valid: boolean;
	// Required paths (relative to the chosen folder) that are missing, if invalid.
	missing: string[];
}

export interface Mdpro4Settings {
	path: string | null;
	defaultPath: string;
	validation: Mdpro4Validation;
}

export interface Mdpro4SyncProgress {
	phase: "reading" | "art" | "overframes" | "done";
	current: number;
	total: number;
}

export interface Mdpro4SyncSummary {
	totalCards: number;
	added: number;
	updated: number;
	unchanged: number;
	artCopied: number;
	overframesCopied: number;
}

export interface CardBuilderApi {
	searchCards(query: string): Promise<CardSummary[]>;
	getCardArtworks(id: number): Promise<CardArtwork[]>;
	generateProxy(
		id: number,
		artId?: number,
		fx?: string[],
		frameType?: string,
	): Promise<GenerateResult>;
	listFxOptions(): Promise<FxOption[]>;
	listFrameOptions(): Promise<FrameOption[]>;
	pickYdkFile(): Promise<YdkImportResult | null>;
	// .ydk filenames (with extension) sitting in the configured MDPro4 install's Deck/ folder -
	// empty if MDPro4 isn't configured/valid.
	listMdpro4Decks(): Promise<string[]>;
	// `fileName` must be one of listMdpro4Decks()'s own entries.
	importMdpro4Deck(fileName: string): Promise<YdkImportResult>;
	generateYdkBatch(
		deckName: string,
		selections: YdkGenerateSelection[],
		rawSections: Record<YdkSection, number[]>,
	): Promise<YdkBatchResult>;
	pickArtworkFile(): Promise<PickedArtwork | null>;
	previewCustomCard(card: CustomCardInput, artPath: string): Promise<GenerateResult>;
	saveCustomCard(card: CustomCardInput, artPath: string): Promise<CustomSaveResult>;
	getMdpro4Settings(): Promise<Mdpro4Settings>;
	setMdpro4Path(mdpro4Path: string): Promise<Mdpro4Settings>;
	browseMdpro4Folder(): Promise<Mdpro4Settings | null>;
	resyncMdpro4(): Promise<Mdpro4SyncSummary>;
	// Returns an unsubscribe function - call it once the resync this listener was watching finishes.
	onMdpro4Progress(callback: (progress: Mdpro4SyncProgress) => void): () => void;
}

declare global {
	interface Window {
		api: CardBuilderApi;
	}
}
