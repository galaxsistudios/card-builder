// Reads every row out of MDPro4's Data/locales/en-US/cards.cdb - a standard ygopro-core SQLite
// `.cdb` file (`datas`/`texts` tables keyed by the same `id`), same shape
// scripts/importRushDuelCards.ts reads from cards-rush.db.
import Database from "better-sqlite3";
import { CdbCardRow } from "./cardDecoder";

export function readCardsCdb(cdbPath: string): CdbCardRow[] {
	const db = new Database(cdbPath, { readonly: true });
	try {
		return db
			.prepare(
				`SELECT d.id, t.name, t.desc, d.ot, d.alias, d.setcode, d.type, d.atk, d.def, d.level,
				        d.race, d.attribute, d.category
				 FROM datas d JOIN texts t ON t.id = d.id`,
			)
			.all() as CdbCardRow[];
	} finally {
		db.close();
	}
}
