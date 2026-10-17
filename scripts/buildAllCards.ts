/**
 * Renders a proxy PNG for every card in data/cardinfo.json, using its primary artwork from
 * card-artworks/ (both produced by scripts/setupProjectData.ts). Reuses the same PSD template +
 * render pipeline as `npm run generate`.
 *
 * ygoprodeck's card fields map almost 1:1 onto ProxyCard (see src/types.ts) - including its "-1
 * means ?" convention for variable ATK/DEF, which cardProxyGenerator.ts already expects.
 *
 * Usage:
 *   npm run build-all                     # render every card
 *   npm run build-all -- --limit 50       # render only the first 50 (testing)
 *   npm run build-all -- --id 46986414    # render a single card by its ygoprodeck id
 *   npm run build-all -- --out-dir other  # change the output folder (default output/cards)
 */
import fs from 'fs';
import path from 'path';
import { loadPsdTree, renderProxyCard } from '../src/cardProxyGenerator';
import { ProxyCard } from '../src/types';
import { CardDatabase, DATA_FILE, loadCardDatabase, resolveArtPath, resolveOverframePath, sanitizeFilename, toProxyCard } from './cardData';

const DEFAULT_OUTPUT_DIR = path.join(__dirname, '..', 'output', 'cards');

interface Args {
  dataFile: string;
  outDir: string;
  limit?: number;
  id?: number;
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const args: Args = { dataFile: DATA_FILE, outDir: DEFAULT_OUTPUT_DIR };
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === '--limit') args.limit = Number(raw[++i]);
    else if (a === '--id') args.id = Number(raw[++i]);
    else if (a === '--data') args.dataFile = path.resolve(raw[++i]);
    else if (a === '--out-dir') args.outDir = path.resolve(raw[++i]);
    else console.warn(`Unknown argument: ${a}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const database: CardDatabase = loadCardDatabase(args.dataFile);

  let cards = database.data;
  if (args.id !== undefined) cards = cards.filter((c) => c.id === args.id);
  if (args.limit) cards = cards.slice(0, args.limit);

  if (!cards.length) {
    console.warn('No cards matched the given filters.');
    return;
  }

  fs.mkdirSync(args.outDir, { recursive: true });
  console.log('… loading PSD template');
  const tree = loadPsdTree();

  let rendered = 0;
  let skipped = 0;
  let failed = 0;

  for (const card of cards) {
    const artPath = resolveArtPath(card);
    if (!artPath) {
      console.warn(`- skip ${card.id} "${card.name}": no downloaded artwork.`);
      skipped++;
      continue;
    }

    const proxyCard: ProxyCard = toProxyCard(card, artPath);
    const overframePath = resolveOverframePath(card);
    const outPath = path.join(args.outDir, `${card.id} - ${sanitizeFilename(card.name)}.png`);
    try {
      const { png, notes } = await renderProxyCard(tree, proxyCard, artPath, overframePath);
      if (notes.length) console.warn(`  ⚠️  ${card.name}: ${notes.join(' | ')}`);
      fs.writeFileSync(outPath, png);
      rendered++;
    } catch (err) {
      console.error(`✗ ${card.id} "${card.name}": ${(err as Error).message}`);
      failed++;
    }

    const done = rendered + skipped + failed;
    if (done % 250 === 0 || done === cards.length) {
      console.log(`  … ${done}/${cards.length} (rendered=${rendered} skipped=${skipped} failed=${failed})`);
    }
  }

  console.log(
    `✓ build done: ${rendered} rendered, ${skipped} skipped, ${failed} failed -> ${path.relative(
      process.cwd(),
      args.outDir
    )}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
