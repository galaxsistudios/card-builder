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

## If you change the PSD's layer names

Edits to `card-template.psd` in this folder are independent of
`backend/resources/card-template.psd` - they don't sync either direction. If you rename/restructure
layers here, run `npm run list-layers` and check the output against `LAYER_PATHS` /
`*_NAME_CANDIDATES` near the top of `src/cardProxyGenerator.ts`, same as the real generator's own
`CARD_TEMPLATE_GENERATION.md` describes.
