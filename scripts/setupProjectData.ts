/**
 * Sets up the project's card data area:
 *   1. Pulls the full card database from the YGOPRODeck API and saves it to
 *      data/cardinfo.json.
 *   2. Downloads every card's cropped artwork (card_images[].image_url_cropped)
 *      into card-artworks/<image id>.jpg.
 *
 * Both steps are cached on disk - re-running the script only fetches what's
 * missing unless --force is passed.
 *
 * Usage:
 *   npm run setup-data                    # fetch card data + download all artworks
 *   npm run setup-data -- --skip-images    # only refresh data/cardinfo.json
 *   npm run setup-data -- --force          # re-download even if files already exist
 *   npm run setup-data -- --limit 50       # only download the first N artworks (testing)
 */
import fs from 'fs';
import path from 'path';

const API_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'cardinfo.json');
const ARTWORK_DIR = path.join(__dirname, '..', 'card-artworks');
const CONCURRENCY = 8;

interface CardImage {
  id: number;
  image_url: string;
  image_url_small: string;
  image_url_cropped: string;
}

interface Card {
  card_images?: CardImage[];
}

interface CardDatabase {
  data: Card[];
}

interface Args {
  force: boolean;
  skipImages: boolean;
  limit?: number;
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const args: Args = { force: false, skipImages: false };
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === '--force') args.force = true;
    else if (a === '--skip-images') args.skipImages = true;
    else if (a === '--limit') args.limit = Number(raw[++i]);
    else console.warn(`Unknown argument: ${a}`);
  }
  return args;
}

async function fetchCardDatabase(force: boolean): Promise<CardDatabase> {
  if (!force && fs.existsSync(DATA_FILE)) {
    console.log(`… using existing ${path.relative(process.cwd(), DATA_FILE)} (pass --force to re-fetch)`);
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  }

  console.log(`… fetching card database from ${API_URL}`);
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`API request failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as CardDatabase;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(json, null, 2));
  console.log(`✓ wrote ${json.data.length} cards to ${path.relative(process.cwd(), DATA_FILE)}`);
  return json;
}

interface ArtworkJob {
  id: number;
  url: string;
}

function collectArtworkJobs(cardDatabase: CardDatabase): ArtworkJob[] {
  const jobs: ArtworkJob[] = [];
  const seen = new Set<number>();
  for (const card of cardDatabase.data) {
    for (const image of card.card_images ?? []) {
      if (image.id && image.image_url_cropped && !seen.has(image.id)) {
        seen.add(image.id);
        jobs.push({ id: image.id, url: image.image_url_cropped });
      }
    }
  }
  return jobs;
}

async function downloadArtwork(job: ArtworkJob, force: boolean): Promise<'downloaded' | 'skipped' | 'failed'> {
  const outPath = path.join(ARTWORK_DIR, `${job.id}.jpg`);
  if (!force && fs.existsSync(outPath)) return 'skipped';

  try {
    const res = await fetch(job.url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outPath, buffer);
    return 'downloaded';
  } catch (err) {
    console.error(`✗ artwork ${job.id}: ${(err as Error).message}`);
    return 'failed';
  }
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function runNext(): Promise<void> {
    const i = next++;
    if (i >= items.length) return;
    await worker(items[i]);
    return runNext();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
}

async function downloadAllArtworks(cardDatabase: CardDatabase, force: boolean, limit?: number): Promise<void> {
  fs.mkdirSync(ARTWORK_DIR, { recursive: true });
  let jobs = collectArtworkJobs(cardDatabase);
  if (limit) jobs = jobs.slice(0, limit);

  console.log(
    `… downloading ${jobs.length} card artworks to ${path.relative(process.cwd(), ARTWORK_DIR)} (concurrency=${CONCURRENCY})`
  );

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let done = 0;

  await runPool(jobs, CONCURRENCY, async (job) => {
    const result = await downloadArtwork(job, force);
    if (result === 'downloaded') downloaded++;
    else if (result === 'skipped') skipped++;
    else failed++;
    done++;
    if (done % 250 === 0 || done === jobs.length) {
      console.log(`  … ${done}/${jobs.length} (downloaded=${downloaded} skipped=${skipped} failed=${failed})`);
    }
  });

  console.log(`✓ artworks done: ${downloaded} downloaded, ${skipped} skipped, ${failed} failed.`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const cardDatabase = await fetchCardDatabase(args.force);

  if (!args.skipImages) {
    await downloadAllArtworks(cardDatabase, args.force, args.limit);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
