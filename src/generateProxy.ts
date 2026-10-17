/**
 * CLI for the standalone proxy card builder.
 *
 * Usage:
 *   npm run generate -- --card cards/example.json              # render one card
 *   npm run generate -- --card cards/example.json --out out.png
 *   npm run generate -- --dir cards                            # render every *.json in a folder
 *   npm run inspect -- --card cards/example.json                # dry-run: show what would render
 *   npm run list-frames                                         # valid frameType values for this PSD
 *   npm run list-layers                                         # dump the PSD's full layer tree
 */
import fs from 'fs';
import path from 'path';
import {
  loadPsdTree,
  renderProxyCard,
  buildRenderPlan,
  listFrameOptions,
  dumpLayerTree,
  nodePath,
  PsdTree,
} from './cardProxyGenerator';
import { ProxyCard } from './types';

const OUTPUT_DIR = path.join(__dirname, '..', 'output');

interface Args {
  card?: string;
  dir?: string;
  out?: string;
  listLayers: boolean;
  listFrames: boolean;
  inspect: boolean;
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const args: Args = { listLayers: false, listFrames: false, inspect: false };
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === '--card') args.card = raw[++i];
    else if (a === '--dir') args.dir = raw[++i];
    else if (a === '--out') args.out = raw[++i];
    else if (a === '--list-layers') args.listLayers = true;
    else if (a === '--list-frames') args.listFrames = true;
    else if (a === '--inspect') args.inspect = true;
    else console.warn(`Unknown argument: ${a}`);
  }
  return args;
}

function loadCard(jsonPath: string): { card: ProxyCard; artPath: string } {
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (!raw.name || !raw.type || !raw.frameType || !raw.art) {
    throw new Error(`${jsonPath}: card JSON must at least have "name", "type", "frameType", and "art".`);
  }
  const card: ProxyCard = { id: raw.id ?? path.basename(jsonPath, '.json'), ...raw };
  const artPath = path.resolve(path.dirname(jsonPath), raw.art);
  return { card, artPath };
}

function defaultOutPath(jsonPath: string): string {
  return path.join(OUTPUT_DIR, `${path.basename(jsonPath, '.json')}.png`);
}

function runListLayers(tree: PsdTree): void {
  const lines: string[] = [`${tree.width}x${tree.height}`];
  dumpLayerTree(tree.root, 0, lines);
  console.log(lines.join('\n'));
}

function runListFrames(): void {
  console.log('Valid frameType values for the current card-template.psd:');
  for (const key of listFrameOptions()) console.log(`  - ${key}`);
}

function runInspect(tree: PsdTree, jsonPath: string): void {
  const { card } = loadCard(jsonPath);
  console.log(`Card: ${card.name} (type=${card.type} frameType=${card.frameType})`);
  console.log(
    `  atk=${card.atk} def=${card.def} level=${card.level} race=${card.race} attribute=${card.attribute} ` +
      `scale=${card.scale} linkValue=${card.linkValue} linkMarkers=${JSON.stringify(card.linkMarkers)}`
  );

  let plan;
  try {
    plan = buildRenderPlan(tree, card);
  } catch (err) {
    console.error(`  ✗ Failed to build render plan: ${(err as Error).message}`);
    return;
  }

  console.log('\n  Forced VISIBLE:');
  for (const n of plan.forceVisible) console.log(`    + ${nodePath(n)}`);
  console.log('\n  Forced HIDDEN:');
  for (const n of plan.forceHidden) console.log(`    - ${nodePath(n)}`);
  console.log('\n  Dynamic text:');
  for (const o of plan.textOverrides) console.log(`    "${o.text}" -> ${nodePath(o.node)}`);
  if (plan.notes.length) {
    console.log('\n  Notes/warnings:');
    for (const n of plan.notes) console.log(`    ⚠️  ${n}`);
  }
}

async function renderOne(tree: PsdTree, jsonPath: string, outOverride?: string): Promise<void> {
  const { card, artPath } = loadCard(jsonPath);
  console.log(`… ${card.name}`);
  const { png, notes } = await renderProxyCard(tree, card, artPath);
  if (notes.length) console.warn(`  ⚠️  ${notes.join(' | ')}`);

  const outPath = outOverride ?? defaultOutPath(jsonPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png);
  console.log(`✓ wrote ${outPath}`);
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.listFrames) {
    runListFrames();
    return;
  }

  const tree = loadPsdTree();

  if (args.listLayers) {
    runListLayers(tree);
    return;
  }

  if (args.inspect) {
    if (!args.card) {
      console.error('--inspect requires --card <path-to-card.json>');
      process.exitCode = 1;
      return;
    }
    runInspect(tree, args.card);
    return;
  }

  if (args.dir) {
    const files = fs
      .readdirSync(args.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(args.dir!, f));
    if (!files.length) {
      console.warn(`No *.json files found in ${args.dir}`);
      return;
    }
    let ok = 0;
    let failed = 0;
    for (const file of files) {
      try {
        await renderOne(tree, file);
        ok++;
      } catch (err) {
        failed++;
        console.error(`✗ ${file}: ${(err as Error).message}`);
      }
    }
    console.log(`\nDone. ${ok} generated, ${failed} failed.`);
    return;
  }

  if (!args.card) {
    console.error('Usage: --card <path-to-card.json> [--out <path>]  OR  --dir <path-to-folder>');
    process.exitCode = 1;
    return;
  }

  await renderOne(tree, args.card, args.out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
