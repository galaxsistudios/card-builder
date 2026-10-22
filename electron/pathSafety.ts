import path from "path";

// Joins `segments` onto `baseDir` and refuses any result that resolves outside it, so a
// renderer-supplied name can never escape the folder it's meant to write into.
export function resolveInside(baseDir: string, ...segments: string[]): string {
	const base = path.resolve(baseDir);
	const resolved = path.resolve(base, ...segments);
	if (resolved !== base && !resolved.startsWith(base + path.sep)) {
		throw new Error("Path escapes its allowed folder.");
	}

	return resolved;
}
