# Card Proxy Builder

A standalone Yu-Gi-Oh! proxy card image generator. Renders a full-resolution card image (the
template's native canvas size, typically 704x1024 - suitable for printing) from `card-template.psd`
plus a simple JSON description of a card and an artwork file.

This folder is deliberately self-contained: it has its own `package.json`/`tsconfig.json` and does
**not** import anything from `backend/` or the rest of the Duel Worlds repo. The goal is to be able
to copy this entire folder out into its own project/repo later with no changes needed.

`src/cardProxyGenerator.ts` is a manually trimmed duplicate of the real game's
`backend/src/services/cardImageGenerator.ts` - mainline template only (no Rush Duel template, no
"4Kids" simplified sprite layout, no "classic" layout, no Overframe, no small-sprite downscaling).
Because it's a copy rather than shared code, the two will drift apart over time if either the PSD
or the real generator changes - that's expected.

## Setup

```bash
cd scripts/card-builder
npm install
```

## Usage

```bash
# Render one card
npm run generate -- --card cards/example.json

# Render to a specific output path
npm run generate -- --card cards/example.json --out my-proxy.png

# Render every *.json file in a folder (output goes to output/<name>.png per file)
npm run generate -- --dir cards

# Dry-run: show what layers would be shown/hidden and what text would be drawn, without rendering
npm run inspect -- --card cards/example.json

# List the frameType values that actually exist in the current card-template.psd
npm run list-frames

# List the fx values (foil/holo/worn-card effects) that actually exist in the current card-template.psd
npm run list-fx

# Dump the full PSD layer tree (useful after editing the template in Photoshop)
npm run list-layers
```

Rendered PNGs are written to `output/` by default.

## Card JSON format

See `cards/example.json`. Fields (all required except where noted):

- `name` - card name (used for logging only).
- `type` - must contain "Monster" for any monster (e.g. `"Effect Monster"`, `"Fusion Monster"`,
  `"Synchro Monster"`, `"XYZ Monster"`, `"Link Monster"`, `"Ritual Monster"`, `"Pendulum Effect
  Monster"`), or be exactly `"Spell Card"` / `"Trap Card"`. Anything else (e.g. `"Token"`) renders
  as a border-only card with no Overlays.
- `frameType` - selects the card border. Run `npm run list-frames` to see valid values for the
  current template; as of writing: `normal`, `normal_pendulum`, `effect`, `effect_pendulum`,
  `ritual`, `ritual_pendulum`, `fusion`, `fusion_pendulum`, `synchro`, `synchro_pendulum`,
  `dark_synchro`, `xyz`, `xyz_pendulum`, `link`, `spell`, `trap`, `token`, `obelisk`, `ra`, `slifer`.
- `art` - path to the artwork image (JPG/PNG), resolved relative to the JSON file's own directory.
- `atk` / `def` (monsters) - numbers, or omit/`-1` for a "?" variable-stat monster.
- `level` (monsters) - Level, or Rank for an XYZ monster. Negative, or `frameType: "dark_synchro"`,
  renders as Dark Synchro's "Minus Level" pips instead.
- `attribute` (monsters) - one of `DARK`/`LIGHT`/`EARTH`/`WATER`/`FIRE`/`WIND`/`DIVINE`.
- `race` (Spell/Trap only) - one of `Quick-Play`/`Continuous`/`Equip`/`Field`/`Ritual` (Spell) or
  `Continuous`/`Counter` (Trap); omit or use `"Normal"` for a plain Spell/Trap.
- `scale` (Pendulum monsters only) - Pendulum Scale value.
- `linkValue` / `linkMarkers` (Link monsters only) - `linkMarkers` is an array of any of `Top`,
  `Bottom`, `Left`, `Right`, `Top-Left`, `Top-Right`, `Bottom-Left`, `Bottom-Right`.
- `fx` (optional) - which foil/holo/worn-card effect layers to turn on, by exact PSD layer name
  (e.g. `["fx_art_holo_rainbow", "fx_wornborder"]`). Run `npm run list-fx` for the current
  template's valid values. Every `fx_*` layer in the PSD is hidden by default, so omitting one (or
  omitting `fx` entirely) is "off" - nothing extra is needed to disable an effect.

## Electron app (search + generate UI)

`electron/` + `renderer/` add a desktop app on top of the same generator, so you don't have to
hand-write card JSON files: search the local card database by name or id (one box, `electron/
cardSearch.ts`), see the card's artwork (picking from alternate arts when the card has more than
one), optionally override which border frame it renders with (a dropdown built from
`listFrameOptions()`, hidden for overframe cards - their art already bakes in its own border, so a
frame override has nothing to apply to), check off which `fx_*` effects to apply from a collapsible
"Effects" panel (`electron/main.ts`'s `fx:list` handler calls `listFxOptions()`, grouped in the UI
into "Art" vs "Card" effects), confirm, and it renders + saves the proxy the same way `npm run
generate` does (`electron/proxyService.ts` calls straight into `src/cardProxyGenerator.ts`).
`renderer/` is a standalone Angular app (its own `package.json`/`node_modules`) that talks to the
main process over `ipcRenderer.invoke` through `electron/preload.js` - there's no HTTP server or
REST API, Electron's main process *is* the backend.

The window is a dark-themed, two-pane layout: a scrollable sidebar (search box + results, or the
.ydk file picker + card list) on the left, and the selected card's detail/review pane on the right,
each scrolling independently so a long card list never pushes the generate button off-screen.
Picking a card from the results list hides the list itself (it's not needed again until you clear
the selection or start a new search), so the detail pane gets the full window instead of the two
competing for space.

```bash
npm install                 # root deps (electron, ts-node, etc.)
npm run renderer:install    # Angular app's own deps

npm run dev                 # ng serve + Electron pointed at it, with hot reload
# or
npm start                   # ng build (prod) once, then launch Electron against the built output
```

Generated proxies are saved to `output/` (same folder the CLI writes to), named
`<id>-<card name>.png`.

### .ydk deck import

The "Import .ydk deck" tab (`electron/ydkService.ts`) batch-generates proxies for a whole deck:
"Choose .ydk file…" opens a native file picker, reads every numeric card id out of the file, kept
split into Main/Extra/Side exactly as the file's own `#main`/`#extra`/`!side` sections have them
(deduped within each - a deck's multiple copies of the same card only need one proxy; a card that
shows up again in a later section, e.g. Side repeating something already in Main, is only ever
listed once, under whichever section it was first seen in), and resolves each id against the local
card database the same way search does. A card with more than one locally-downloaded art variant
gets its own picker so you can check off one or several arts to export for it (defaults to the
primary art, so the whole deck is exportable as-is without touching anything). The review step
shows exactly what will be generated, grouped the same Main/Extra/Side way - one thumbnail and
output filename per selected (card, art) pair, deduped again so the same art is never rendered
twice even if it somehow ended up selected more than once - and they all save to
`output/<the .ydk file's own name>/<Main|Extra|Side>/` once you confirm. Ids the file references
that aren't resolvable locally (not in the card database, or no downloaded artwork) are listed
rather than silently dropped. The batch flow always uses each card's own frame with no `fx_*`
effects - the per-card frame/fx overrides are only available from the single-card "Search" tab.

`electron/main.ts` runs straight from TypeScript via `ts-node` (see `electron/bootstrap.js`)
rather than through a separate `tsc` build step - that's deliberate: it keeps `__dirname` exactly
where `src/cardProxyGenerator.ts` and `scripts/cardData.ts` already expect it (one level under the
project root), the same as running them via `npm run generate` does. `electron/preload.js` is
plain JS, not TypeScript/`ts-node` - Electron's preload scripts run sandboxed by default, which
blocks `require()`-ing anything beyond Electron's own built-ins, so it can't go through the same
`ts-node` registration the main process uses. Only cards with already-downloaded artwork (see
`npm run setup-data`) show up in search results, since a result has to be renderable without a
network fetch.

## If you change the PSD's layer names

Edits to `card-template.psd` in this folder are independent of
`backend/resources/card-template.psd` - they don't sync either direction. If you rename/restructure
layers here, run `npm run list-layers` and check the output against `LAYER_PATHS` /
`*_NAME_CANDIDATES` near the top of `src/cardProxyGenerator.ts`, same as the real generator's own
`CARD_TEMPLATE_GENERATION.md` describes.
