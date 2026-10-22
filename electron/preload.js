// Plain JS, not TypeScript: Electron's preload scripts run in a sandboxed context by default
// (sandbox: true since Electron 20) that only allows requiring Electron's own built-in modules -
// `require('ts-node/register')` is blocked there, so this can't be run through ts-node like the
// rest of main.ts/electron's code. contextBridge/ipcRenderer are fine to require even sandboxed.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
	searchCards: (query) => ipcRenderer.invoke("cards:search", query),
	getCardArtworks: (id) => ipcRenderer.invoke("cards:artworks", id),
	generateProxy: (id, artId, fx, frameType) =>
		ipcRenderer.invoke("cards:generate", id, artId, fx, frameType),
	listFxOptions: () => ipcRenderer.invoke("fx:list"),
	listFrameOptions: () => ipcRenderer.invoke("frames:list"),
	pickYdkFile: () => ipcRenderer.invoke("ydk:pick"),
	listMdpro4Decks: () => ipcRenderer.invoke("ydk:listMdpro4Decks"),
	importMdpro4Deck: (fileName) => ipcRenderer.invoke("ydk:importMdpro4Deck", fileName),
	generateYdkBatch: (deckName, selections, rawSections) =>
		ipcRenderer.invoke("ydk:generate", deckName, selections, rawSections),
	pickArtworkFile: () => ipcRenderer.invoke("custom:pickArt"),
	previewCustomCard: (card, artPath) => ipcRenderer.invoke("custom:preview", card, artPath),
	saveCustomCard: (card, artPath) => ipcRenderer.invoke("custom:save", card, artPath),
	getMdpro4Settings: () => ipcRenderer.invoke("mdpro4:getSettings"),
	setMdpro4Path: (mdpro4Path) => ipcRenderer.invoke("mdpro4:setPath", mdpro4Path),
	browseMdpro4Folder: () => ipcRenderer.invoke("mdpro4:browse"),
	resyncMdpro4: () => ipcRenderer.invoke("mdpro4:resync"),
	onMdpro4Progress: (callback) => {
		const listener = (_event, progress) => callback(progress);
		ipcRenderer.on("mdpro4:progress", listener);

		return () => ipcRenderer.removeListener("mdpro4:progress", listener);
	},
});
