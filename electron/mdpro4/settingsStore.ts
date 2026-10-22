// Persists the user's chosen MDPro4 install path across app restarts, in Electron's own per-user
// data folder (never inside the project folder - this is a local machine setting, not project data).
import fs from "fs";
import path from "path";
import { app } from "electron";
import { DEFAULT_MDPRO4_PATH, validateMdpro4Folder } from "./paths";

interface StoredSettings {
	mdpro4Path?: string;
}

function settingsFilePath(): string {
	return path.join(app.getPath("userData"), "settings.json");
}

function readStoredSettings(): StoredSettings {
	try {
		return JSON.parse(fs.readFileSync(settingsFilePath(), "utf8"));
	} catch {
		return {};
	}
}

function writeStoredSettings(settings: StoredSettings): void {
	fs.mkdirSync(path.dirname(settingsFilePath()), { recursive: true });
	fs.writeFileSync(settingsFilePath(), JSON.stringify(settings, null, 2));
}

// Resolves the path to use right now: whatever the user has explicitly set, falling back to
// DEFAULT_MDPRO4_PATH only while that default actually exists on disk (so a fresh install with
// no MDPro4 at the default location shows as "not configured" rather than a false validation
// failure against a path the user never chose).
export function getMdpro4Path(): string | null {
	const stored = readStoredSettings().mdpro4Path;
	if (stored) return stored;

	return fs.existsSync(DEFAULT_MDPRO4_PATH) ? DEFAULT_MDPRO4_PATH : null;
}

export function setMdpro4Path(mdpro4Path: string): {
	path: string;
	validation: ReturnType<typeof validateMdpro4Folder>;
} {
	const validation = validateMdpro4Folder(mdpro4Path);
	if (validation.valid) writeStoredSettings({ ...readStoredSettings(), mdpro4Path });

	return { path: mdpro4Path, validation };
}
