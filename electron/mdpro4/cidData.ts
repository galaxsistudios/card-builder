// Parses MDPro4's Data/CID_Data/*.json reference files, which key everything by MDPro4's own
// internal "cid" rather than the real card passcode (the id cards.cdb/this app actually uses).
//
// Confirmed against a live MDPro4 install:
//  - data.json: { [cid]: { cid, id } } - the master cid -> real passcode map. `id` is sometimes
//    an array of several passcodes for the same cid (old errata/reprint ids that each still have
//    their own row in cards.cdb) - every one of those is treated as its own card.
//  - Alt_Art.json: { [index]: { cid, id } } - `cid` resolves through data.json to the base
//    card(s); `id` is an *additional* local image id (an alternate artwork) for Picture/Art/.
//  - Overframe_Art.json: { [index]: { cid, id } } - same shape; `id` here is the image id (base
//    or alt-art) whose overframe lives at Picture/OverFrame/<id>.png.
import fs from "fs";
import path from "path";

interface CidEntry {
	cid: number;
	id: number | number[];
}

type CidJson = Record<string, CidEntry>;

function readCidJson(filePath: string): CidJson {
	if (!fs.existsSync(filePath)) return {};

	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toPasscodes(id: number | number[]): number[] {
	return (Array.isArray(id) ? id : [id]).filter((n) => n > 0);
}

export interface CidMaps {
	// Every real card passcode MDPro4 knows about.
	passcodes: Set<number>;
	// passcode -> extra alt-art image ids (Picture/Art/<id>.jpg), beyond the card's own primary
	// id (which always doubles as its own primary art image id).
	altArtsByPasscode: Map<number, number[]>;
	// passcode -> image id that has an overframe (Picture/OverFrame/<id>.png) - usually the
	// card's own id, but can be one of its alt-art ids instead.
	overframeIdByPasscode: Map<number, number>;
}

export function loadCidMaps(mdpro4Path: string): CidMaps {
	const cidDataDir = path.join(mdpro4Path, "Data", "CID_Data");
	const data = readCidJson(path.join(cidDataDir, "data.json"));
	const altArt = readCidJson(path.join(cidDataDir, "Alt_Art.json"));
	const overframeArt = readCidJson(path.join(cidDataDir, "Overframe_Art.json"));

	const passcodes = new Set<number>();
	const passcodesByCid = new Map<number, number[]>();
	for (const entry of Object.values(data)) {
		const codes = toPasscodes(entry.id);
		passcodesByCid.set(entry.cid, codes);
		for (const code of codes) passcodes.add(code);
	}

	// A Set per passcode: a few cids have more than one Alt_Art.json entry pointing at the same
	// image id, and an id can never usefully alt-art itself.
	const altArtSetsByPasscode = new Map<number, Set<number>>();
	for (const entry of Object.values(altArt)) {
		const basePasscodes = passcodesByCid.get(entry.cid);
		if (!basePasscodes) continue;
		for (const altId of toPasscodes(entry.id)) {
			for (const passcode of basePasscodes) {
				if (altId === passcode) continue;
				const existing = altArtSetsByPasscode.get(passcode) ?? new Set<number>();
				existing.add(altId);
				altArtSetsByPasscode.set(passcode, existing);
			}
		}
	}

	const altArtsByPasscode = new Map<number, number[]>(
		[...altArtSetsByPasscode.entries()].map(([passcode, ids]) => [passcode, [...ids]]),
	);

	const overframeIdByPasscode = new Map<number, number>();
	for (const entry of Object.values(overframeArt)) {
		const basePasscodes = passcodesByCid.get(entry.cid);
		if (!basePasscodes) continue;
		for (const overframeId of toPasscodes(entry.id)) {
			for (const passcode of basePasscodes) overframeIdByPasscode.set(passcode, overframeId);
		}
	}

	return { passcodes, altArtsByPasscode, overframeIdByPasscode };
}
