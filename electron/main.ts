import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "path";
import { listFrameOptions, listFxOptions } from "../src/cardProxyGenerator";
import { searchCards } from "./cardSearch";
import {
	CustomCardInput,
	generateCustomProxy,
	pickArtworkFile,
	saveCustomCardToDatabase,
} from "./customCardService";
import { syncMdpro4, SyncProgress } from "./mdpro4/importService";
import { DEFAULT_MDPRO4_PATH, validateMdpro4Folder } from "./mdpro4/paths";
import { getMdpro4Path, setMdpro4Path } from "./mdpro4/settingsStore";
import { getCardArtworks, generateProxyForCard } from "./proxyService";
import {
	generateYdkBatch,
	importMdpro4Deck,
	listMdpro4Decks,
	pickYdkFile,
	YdkGenerateSelection,
	YdkSection,
} from "./ydkService";

function mdpro4Settings() {
	const mdpro4Path = getMdpro4Path();

	return {
		path: mdpro4Path,
		defaultPath: DEFAULT_MDPRO4_PATH,
		validation: mdpro4Path ? validateMdpro4Folder(mdpro4Path) : { valid: false, missing: [] },
	};
}

// Set by `npm run dev` to point at the Angular dev server instead of the built renderer.
const devServerUrl = process.env.ELECTRON_START_URL;

// Tracked so mdpro4:resync can push progress events to it (see registerIpcHandlers) - there's
// only ever one window in this app.
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
	const win = new BrowserWindow({
		width: 1280,
		height: 960,
		icon: path.join(__dirname, "..", "renderer", "public", "favicon.ico"),
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	mainWindow = win;
	win.on("closed", () => {
		if (mainWindow === win) mainWindow = null;
	});

	if (devServerUrl) {
		win.loadURL(devServerUrl);
		win.webContents.openDevTools({ mode: "detach" });
	} else {
		win.loadFile(
			path.join(__dirname, "..", "renderer", "dist", "renderer", "browser", "index.html"),
		);
	}
}

function registerIpcHandlers(): void {
	ipcMain.handle("cards:search", (_event, query: string) => searchCards(query));
	ipcMain.handle("cards:artworks", (_event, id: number) => getCardArtworks(id));
	ipcMain.handle(
		"cards:generate",
		(_event, id: number, artId?: number, fx?: string[], frameType?: string) =>
			generateProxyForCard(id, artId, fx, frameType),
	);
	ipcMain.handle("fx:list", () => listFxOptions());
	ipcMain.handle("frames:list", () => listFrameOptions());
	ipcMain.handle("ydk:pick", () => pickYdkFile());
	ipcMain.handle("ydk:listMdpro4Decks", () => listMdpro4Decks());
	ipcMain.handle("ydk:importMdpro4Deck", (_event, fileName: string) => importMdpro4Deck(fileName));
	ipcMain.handle(
		"ydk:generate",
		(
			_event,
			deckName: string,
			selections: YdkGenerateSelection[],
			rawSections: Record<YdkSection, number[]>,
		) => generateYdkBatch(deckName, selections, rawSections),
	);
	ipcMain.handle("custom:pickArt", () => pickArtworkFile());
	ipcMain.handle("custom:preview", (_event, card: CustomCardInput, artPath: string) =>
		generateCustomProxy(card, artPath),
	);
	ipcMain.handle("custom:save", (_event, card: CustomCardInput, artPath: string) =>
		saveCustomCardToDatabase(card, artPath),
	);

	ipcMain.handle("mdpro4:getSettings", () => mdpro4Settings());
	ipcMain.handle("mdpro4:setPath", (_event, mdpro4Path: string) => {
		setMdpro4Path(mdpro4Path);

		return mdpro4Settings();
	});
	ipcMain.handle("mdpro4:browse", async () => {
		const current = getMdpro4Path();
		const { canceled, filePaths } = await dialog.showOpenDialog({
			title: "Select your MDPro4 install folder",
			defaultPath: current ?? DEFAULT_MDPRO4_PATH,
			properties: ["openDirectory"],
		});
		if (canceled || !filePaths[0]) return null;

		setMdpro4Path(filePaths[0]);

		return mdpro4Settings();
	});
	ipcMain.handle("mdpro4:resync", () => {
		const mdpro4Path = getMdpro4Path();
		if (!mdpro4Path) throw new Error("No MDPro4 folder configured yet.");

		return syncMdpro4(mdpro4Path, (progress: SyncProgress) =>
			mainWindow?.webContents.send("mdpro4:progress", progress),
		);
	});
}

app.whenReady().then(() => {
	registerIpcHandlers();
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
