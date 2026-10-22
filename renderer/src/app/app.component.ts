import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
	CardArtwork,
	CardSummary,
	FrameOption,
	FxOption,
	GenerateResult,
	Mdpro4Settings,
	Mdpro4SyncProgress,
	Mdpro4SyncSummary,
	YdkBatchResult,
	YdkCardEntry,
	YdkImportResult,
	YdkSection,
} from "./electron-api";

const MDPRO4_PHASE_LABELS: Record<Mdpro4SyncProgress["phase"], string> = {
	reading: "Reading cards.cdb…",
	art: "Copying artwork…",
	overframes: "Copying overframes…",
	done: "Done.",
};

interface YdkExportItem {
	cardId: number;
	artId: number;
	section: YdkSection;
	name: string;
	dataUrl: string;
	fileName: string;
}

const YDK_SECTION_LABELS: Record<YdkSection, string> = {
	main: "Main Deck",
	extra: "Extra Deck",
	side: "Side Deck",
};

// Mirrors scripts/cardData.ts's sanitizeFilename, cosmetic only so the preview label matches
// what will really get written (the actual file is sanitized server-side regardless).
function sanitizeFilenamePreview(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, "").trim();
}

@Component({
	selector: "app-root",
	standalone: true,
	imports: [FormsModule],
	templateUrl: "./app.component.html",
	styleUrl: "./app.component.css",
})
export class AppComponent implements OnInit {
	mode: "search" | "ydk" | "settings" = "search";

	query = "";
	results: CardSummary[] = [];
	searching = false;
	searchError: string | null = null;

	selectedCard: CardSummary | null = null;
	artworks: CardArtwork[] = [];
	artworksError: string | null = null;
	selectedArtId: number | null = null;

	// --- hover preview (search results pop their artwork up to the side) ---
	hoverPreviewCard: CardSummary | null = null;
	hoverPreviewArt: CardArtwork[] = [];
	hoverPreviewLoading = false;
	hoverPreviewError: string | null = null;
	private hoverPreviewToken = 0;

	fxOptions: FxOption[] = [];
	selectedFx = new Set<string>();
	fxPanelOpen = false;

	frameOptions: FrameOption[] = [];
	// null = render with the card's own frame (the default).
	selectedFrame: string | null = null;

	generating = false;
	generateError: string | null = null;
	generated: GenerateResult | null = null;

	// --- .ydk deck import ---
	ydkLoading = false;
	ydkError: string | null = null;
	ydkResult: YdkImportResult | null = null;
	// cardId -> set of art ids selected for that card; keyed by cardId alone since a given id is
	// only ever listed under one section (see YdkImportResult).
	ydkSelections = new Map<number, Set<number>>();

	// .ydk filenames sitting in the configured MDPro4 install's own Deck/ folder - empty/unset
	// until ngOnInit loads it (or there's no valid MDPro4 folder configured at all).
	mdpro4Decks: string[] = [];
	mdpro4SelectedDeck: string | null = null;

	ydkGenerating = false;
	ydkGenerateError: string | null = null;
	ydkBatchResult: YdkBatchResult | null = null;

	// --- MDPro4 settings/sync ---
	mdpro4Settings: Mdpro4Settings | null = null;
	mdpro4PathInput = "";
	mdpro4Browsing = false;
	mdpro4Error: string | null = null;

	mdpro4Syncing = false;
	mdpro4Progress: Mdpro4SyncProgress | null = null;
	mdpro4SyncError: string | null = null;
	mdpro4Summary: Mdpro4SyncSummary | null = null;
	private mdpro4Unsubscribe: (() => void) | null = null;

	private debounceHandle: ReturnType<typeof setTimeout> | null = null;

	get artFxOptions(): FxOption[] {
		return this.fxOptions.filter((fx) => fx.group === "art");
	}

	get cardFxOptions(): FxOption[] {
		return this.fxOptions.filter((fx) => fx.group === "card");
	}

	// Picking the overframe art thumbnail switches rendering to overframe style (full-bleed art,
	// no border) - the frame override dropdown has nothing to apply to while that's selected.
	get isSelectedArtOverframe(): boolean {
		return !!this.artworks.find((a) => a.id === this.selectedArtId)?.isOverframe;
	}

	async ngOnInit(): Promise<void> {
		[this.fxOptions, this.frameOptions, this.mdpro4Settings, this.mdpro4Decks] = await Promise.all([
			window.api.listFxOptions(),
			window.api.listFrameOptions(),
			window.api.getMdpro4Settings(),
			window.api.listMdpro4Decks(),
		]);
		this.mdpro4PathInput = this.mdpro4Settings.path ?? this.mdpro4Settings.defaultPath;
	}

	onQueryChange(): void {
		this.clearSelectedCard();

		if (this.debounceHandle) clearTimeout(this.debounceHandle);
		const query = this.query.trim();
		if (!query) {
			this.results = [];
			this.searching = false;

			return;
		}

		this.debounceHandle = setTimeout(() => this.runSearch(query), 250);
	}

	private async runSearch(query: string): Promise<void> {
		this.searching = true;
		this.searchError = null;
		try {
			this.results = await window.api.searchCards(query);
		} catch (err) {
			this.searchError = (err as Error).message;
			this.results = [];
		} finally {
			this.searching = false;
		}
	}

	// --- hover preview ---

	async previewHover(card: CardSummary): Promise<void> {
		if (this.hoverPreviewCard?.id === card.id) return;
		const token = ++this.hoverPreviewToken;
		this.hoverPreviewCard = card;
		this.hoverPreviewArt = [];
		this.hoverPreviewError = null;
		this.hoverPreviewLoading = true;

		try {
			const artworks = await window.api.getCardArtworks(card.id);
			if (token !== this.hoverPreviewToken) return; // superseded by a later hover
			this.hoverPreviewArt = artworks;
		} catch (err) {
			if (token !== this.hoverPreviewToken) return;
			this.hoverPreviewError = (err as Error).message;
		} finally {
			if (token === this.hoverPreviewToken) this.hoverPreviewLoading = false;
		}
	}

	clearHoverPreview(): void {
		this.hoverPreviewToken++;
		this.hoverPreviewCard = null;
		this.hoverPreviewArt = [];
		this.hoverPreviewLoading = false;
		this.hoverPreviewError = null;
	}

	async selectCard(card: CardSummary): Promise<void> {
		this.clearHoverPreview();
		this.selectedCard = card;
		this.artworks = [];
		this.artworksError = null;
		this.selectedArtId = null;
		this.selectedFx.clear();
		this.fxPanelOpen = false;
		this.selectedFrame = null;
		this.generated = null;
		this.generateError = null;

		try {
			this.artworks = await window.api.getCardArtworks(card.id);
			// Only one art variant - nothing to pick, so go straight to the generate step.
			if (this.artworks.length === 1) this.selectedArtId = this.artworks[0].id;
		} catch (err) {
			this.artworksError = (err as Error).message;
		}
	}

	// Leaves `results` as-is so the list (hidden while a card is selected) just reappears.
	clearSelectedCard(): void {
		this.selectedCard = null;
		this.artworks = [];
		this.artworksError = null;
		this.selectedArtId = null;
		this.selectedFx.clear();
		this.fxPanelOpen = false;
		this.selectedFrame = null;
		this.generated = null;
		this.generateError = null;
	}

	selectArt(art: CardArtwork): void {
		this.selectedArtId = art.id;
		this.generated = null;
		this.generateError = null;
	}

	toggleFx(key: string, checked: boolean): void {
		if (checked) this.selectedFx.add(key);
		else this.selectedFx.delete(key);
	}

	async generateProxy(): Promise<void> {
		if (!this.selectedCard || this.selectedArtId === null) return;
		this.generating = true;
		this.generateError = null;
		this.generated = null;
		try {
			this.generated = await window.api.generateProxy(
				this.selectedCard.id,
				this.selectedArtId,
				[...this.selectedFx],
				this.selectedFrame ?? undefined,
			);
		} catch (err) {
			this.generateError = (err as Error).message;
		} finally {
			this.generating = false;
		}
	}

	// --- .ydk deck import ---

	// Cosmetic only - deck selections/imports always use the full filename (mdpro4Decks' own
	// entries), this just hides the redundant ".ydk" in the dropdown label.
	stripYdkExtension(fileName: string): string {
		return fileName.replace(/\.ydk$/i, "");
	}

	// Shared by pickYdkFile and importMdpro4Deck - both just differ in how they get a
	// YdkImportResult in the first place.
	private applyYdkImportResult(result: YdkImportResult): void {
		this.ydkResult = result;
		for (const card of [...result.main, ...result.extra, ...result.side]) {
			// Default to the primary art so the whole deck is ready to export as-is; cards with
			// alternate arts can still have more (or different) arts checked below.
			this.ydkSelections.set(card.id, new Set([card.artworks[0].id]));
		}
	}

	async pickYdkFile(): Promise<void> {
		this.ydkLoading = true;
		this.ydkError = null;
		this.ydkResult = null;
		this.ydkSelections = new Map();
		this.ydkBatchResult = null;
		this.ydkGenerateError = null;

		try {
			const result = await window.api.pickYdkFile();
			if (!result) return; // user canceled the file picker
			this.applyYdkImportResult(result);
		} catch (err) {
			this.ydkError = (err as Error).message;
		} finally {
			this.ydkLoading = false;
		}
	}

	async importMdpro4Deck(): Promise<void> {
		if (!this.mdpro4SelectedDeck) return;
		this.ydkLoading = true;
		this.ydkError = null;
		this.ydkResult = null;
		this.ydkSelections = new Map();
		this.ydkBatchResult = null;
		this.ydkGenerateError = null;

		try {
			this.applyYdkImportResult(await window.api.importMdpro4Deck(this.mdpro4SelectedDeck));
		} catch (err) {
			this.ydkError = (err as Error).message;
		} finally {
			this.ydkLoading = false;
		}
	}

	// The card list, grouped under non-empty Main/Extra/Side headings.
	get ydkSectionGroups(): { section: YdkSection; label: string; cards: YdkCardEntry[] }[] {
		if (!this.ydkResult) return [];

		return (["main", "extra", "side"] as YdkSection[])
			.map((section) => ({
				section,
				label: YDK_SECTION_LABELS[section],
				cards: this.ydkResult![section],
			}))
			.filter((group) => group.cards.length > 0);
	}

	isYdkArtSelected(cardId: number, artId: number): boolean {
		return this.ydkSelections.get(cardId)?.has(artId) ?? false;
	}

	toggleYdkArt(cardId: number, artId: number, checked: boolean): void {
		let set = this.ydkSelections.get(cardId);
		if (!set) {
			set = new Set();
			this.ydkSelections.set(cardId, set);
		}

		if (checked) set.add(artId);
		else set.delete(artId);
		this.ydkBatchResult = null;
	}

	// What will actually be rendered + saved if the user confirms right now: one row per selected
	// (card, art) pair, deduped so the same art is never listed (or output) twice.
	get ydkExportList(): YdkExportItem[] {
		if (!this.ydkResult) return [];
		const list: YdkExportItem[] = [];
		const seen = new Set<string>();
		for (const { section, cards } of this.ydkSectionGroups) {
			for (const card of cards) {
				for (const artId of this.ydkSelections.get(card.id) ?? []) {
					const key = `${card.id}:${artId}`;
					if (seen.has(key)) continue;
					seen.add(key);
					const art = card.artworks.find((a) => a.id === artId);
					if (!art) continue;
					const isAltArt = artId !== card.artworks[0].id;
					const suffix = art.isOverframe ? "-overframe" : isAltArt ? `-art${artId}` : "";
					const fileName = `${card.id}-${sanitizeFilenamePreview(card.name)}${suffix}.png`;
					list.push({
						cardId: card.id,
						artId,
						section,
						name: card.name,
						dataUrl: art.dataUrl,
						fileName,
					});
				}
			}
		}

		return list;
	}

	// Same export list, grouped by section - also matches the Main/Extra/Side output subfolders.
	get ydkExportGroups(): { section: YdkSection; label: string; items: YdkExportItem[] }[] {
		const list = this.ydkExportList;

		return (["main", "extra", "side"] as YdkSection[])
			.map((section) => ({
				section,
				label: YDK_SECTION_LABELS[section],
				items: list.filter((i) => i.section === section),
			}))
			.filter((group) => group.items.length > 0);
	}

	async confirmYdkExport(): Promise<void> {
		if (!this.ydkResult || !this.ydkExportList.length) return;
		this.ydkGenerating = true;
		this.ydkGenerateError = null;
		this.ydkBatchResult = null;
		try {
			const selections = this.ydkExportList.map(({ cardId, artId, section }) => ({
				cardId,
				artId,
				section,
			}));
			this.ydkBatchResult = await window.api.generateYdkBatch(
				this.ydkResult.deckName,
				selections,
				this.ydkResult.rawSections,
			);
		} catch (err) {
			this.ydkGenerateError = (err as Error).message;
		} finally {
			this.ydkGenerating = false;
		}
	}

	// --- MDPro4 settings/sync ---

	get mdpro4ProgressLabel(): string {
		if (!this.mdpro4Progress) return "";
		const { phase, current, total } = this.mdpro4Progress;
		const label = MDPRO4_PHASE_LABELS[phase];

		return total > 1 ? `${label} (${current}/${total})` : label;
	}

	async browseMdpro4Folder(): Promise<void> {
		this.mdpro4Browsing = true;
		this.mdpro4Error = null;
		try {
			const settings = await window.api.browseMdpro4Folder();
			if (!settings) return; // user canceled the folder picker
			this.mdpro4Settings = settings;
			this.mdpro4PathInput = settings.path ?? settings.defaultPath;
			if (!settings.validation.valid) {
				this.mdpro4Error = `Not a valid MDPro4 folder (missing ${settings.validation.missing.join(", ")}).`;
			}

			this.mdpro4Decks = await window.api.listMdpro4Decks();
			this.mdpro4SelectedDeck = null;
		} catch (err) {
			this.mdpro4Error = (err as Error).message;
		} finally {
			this.mdpro4Browsing = false;
		}
	}

	async applyMdpro4Path(): Promise<void> {
		this.mdpro4Error = null;
		try {
			const settings = await window.api.setMdpro4Path(this.mdpro4PathInput.trim());
			this.mdpro4Settings = settings;
			if (!settings.validation.valid) {
				this.mdpro4Error = `Not a valid MDPro4 folder (missing ${settings.validation.missing.join(", ")}).`;
			}

			this.mdpro4Decks = await window.api.listMdpro4Decks();
			this.mdpro4SelectedDeck = null;
		} catch (err) {
			this.mdpro4Error = (err as Error).message;
		}
	}

	async resyncMdpro4(): Promise<void> {
		if (!this.mdpro4Settings?.validation.valid) return;
		this.mdpro4Syncing = true;
		this.mdpro4SyncError = null;
		this.mdpro4Summary = null;
		this.mdpro4Progress = null;
		this.mdpro4Unsubscribe = window.api.onMdpro4Progress((progress) => {
			this.mdpro4Progress = progress;
		});

		try {
			this.mdpro4Summary = await window.api.resyncMdpro4();
		} catch (err) {
			this.mdpro4SyncError = (err as Error).message;
		} finally {
			this.mdpro4Syncing = false;
			this.mdpro4Unsubscribe?.();
			this.mdpro4Unsubscribe = null;
		}
	}
}
