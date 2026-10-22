// Locates and validates an MDPro4 (EDOPro-based master duel client) install folder, and resolves
// every file this app actually reads out of it. See importService.ts for how they're used.
import fs from "fs";
import path from "path";

export const DEFAULT_MDPRO4_PATH = "D:\\Games\\MDPro4";

export interface Mdpro4Validation {
	valid: boolean;
	// Paths (relative to the folder picked) that are missing, if invalid.
	missing: string[];
}

const REQUIRED_RELATIVE_PATHS = [
	"MDPro4.exe",
	"Data",
	"Deck",
	"Picture",
	path.join("Picture", "Art"),
	path.join("Picture", "OverFrame"),
];

// Confirms `folder` actually looks like an MDPro4 install, per the user's own description: the
// exe itself, plus Data/, Deck/, Picture/Art/ and Picture/OverFrame/ (OverFrame nested under
// Picture/, not its own top-level folder).
export function validateMdpro4Folder(folder: string): Mdpro4Validation {
	const missing = REQUIRED_RELATIVE_PATHS.filter((rel) => !fs.existsSync(path.join(folder, rel)));

	return { valid: missing.length === 0, missing };
}

export function cardsCdbPath(mdpro4Path: string): string {
	return path.join(mdpro4Path, "Data", "locales", "en-US", "cards.cdb");
}

export function cidDataDir(mdpro4Path: string): string {
	return path.join(mdpro4Path, "Data", "CID_Data");
}

export function artDir(mdpro4Path: string): string {
	return path.join(mdpro4Path, "Picture", "Art");
}

export function overframeDir(mdpro4Path: string): string {
	return path.join(mdpro4Path, "Picture", "OverFrame");
}

export function deckDir(mdpro4Path: string): string {
	return path.join(mdpro4Path, "Deck");
}
