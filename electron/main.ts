import { app, BrowserWindow, dialog, ipcMain, IpcMainInvokeEvent, shell } from "electron";
import path from "path";
import { pathToFileURL } from "url";
import { listFrameOptions, listFxOptions } from "../src/cardProxyGenerator";
import { searchCards } from "./cardSearch";
import {
	generateCustomProxy,
	parseCustomCardInput,
	pickArtworkFile,
	saveCustomCardToDatabase,
} from "./customCardService";
import {
	optionalInt,
	optionalString,
	optionalStringArray,
	requireInt,
	requireString,
} from "./ipcValidation";
import { syncMdpro4, SyncProgress } from "./mdpro4/importService";
import { DEFAULT_MDPRO4_PATH, validateMdpro4Folder } from "./mdpro4/paths";
import { getMdpro4Path, setMdpro4Path } from "./mdpro4/settingsStore";
import { getCardArtworks, generateProxyForCard } from "./proxyService";
import {
	generateYdkBatch,
	importMdpro4Deck,
	listMdpro4Decks,
	pickYdkFile,
	parseYdkGenerateArgs,
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

const rendererDir = path.join(__dirname, "..", "renderer", "dist", "renderer", "browser");

function isTrustedUrl(url: string): boolean {
	try {
		if (devServerUrl) return new URL(url).origin === new URL(devServerUrl).origin;

		return url.startsWith(pathToFileURL(rendererDir).href);
	} catch {
		return false;
	}
}

// Only our own renderer page may call the IPC handlers - rejects anything else (e.g. a frame that
// navigated somewhere unexpected) before it can reach the filesystem-touching handlers.
function handle(
	channel: string,
	listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
): void {
	ipcMain.handle(channel, (event, ...args) => {
		if (!event.senderFrame || !isTrustedUrl(event.senderFrame.url)) {
			throw new Error(`Blocked IPC call to "${channel}" from an untrusted sender.`);
		}

		return listener(event, ...args);
	});
}

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

	// The app never needs to open other windows or leave its own page; external links go to the
	// system browser (https only) instead.
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("https://")) shell.openExternal(url);

		return { action: "deny" };
	});
	win.webContents.on("will-navigate", (event, url) => {
		if (!isTrustedUrl(url)) event.preventDefault();
	});
	win.on("closed", () => {
		if (mainWindow === win) mainWindow = null;
	});

	if (devServerUrl) {
		win.loadURL(devServerUrl);
		if (!app.isPackaged) win.webContents.openDevTools({ mode: "detach" });
	} else {
		win.loadFile(
			path.join(__dirname, "..", "renderer", "dist", "renderer", "browser", "index.html"),
		);
	}
}

function registerIpcHandlers(): void {
	handle("cards:search", (_event, query) => searchCards(requireString(query, "query", 200)));
	handle("cards:artworks", (_event, id) => getCardArtworks(requireInt(id, "id")));
	handle("cards:generate", (_event, id, artId, fx, frameType) =>
		generateProxyForCard(
			requireInt(id, "id"),
			optionalInt(artId, "artId"),
			optionalStringArray(fx, "fx"),
			optionalString(frameType, "frameType"),
		),
	);
	handle("fx:list", () => listFxOptions());
	handle("frames:list", () => listFrameOptions());
	handle("ydk:pick", () => pickYdkFile());
	handle("ydk:listMdpro4Decks", () => listMdpro4Decks());
	handle("ydk:importMdpro4Deck", (_event, fileName) =>
		importMdpro4Deck(requireString(fileName, "fileName", 260)),
	);
	handle("ydk:generate", (_event, deckName, selections, rawSections) => {
		const args = parseYdkGenerateArgs(deckName, selections, rawSections);

		return generateYdkBatch(args.deckName, args.selections, args.rawSections);
	});
	handle("custom:pickArt", () => pickArtworkFile());
	handle("custom:preview", (_event, card, artPath) =>
		generateCustomProxy(parseCustomCardInput(card), requireString(artPath, "artPath", 1000)),
	);
	handle("custom:save", (_event, card, artPath) =>
		saveCustomCardToDatabase(parseCustomCardInput(card), requireString(artPath, "artPath", 1000)),
	);

	handle("mdpro4:getSettings", () => mdpro4Settings());
	handle("mdpro4:setPath", (_event, mdpro4Path) => {
		const folder = requireString(mdpro4Path, "mdpro4Path", 1000);
		if (!path.isAbsolute(folder)) throw new Error("MDPro4 folder must be an absolute path.");
		setMdpro4Path(folder);

		return mdpro4Settings();
	});
	handle("mdpro4:browse", async () => {
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
	handle("mdpro4:resync", () => {
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
