# Card Proxy Generator Refactoring

## Overview
The `cardProxyGenerator.ts` file has been split into modular components in a new `cardProxy/` directory. All excessive comments have been removed, keeping only essential documentation and clarifying comments.

## Module Structure

### `cardProxy/types.ts`
Core type definitions:
- `LayerNode` - PSD layer tree node structure
- `PsdTree` - Parsed PSD file representation
- `TextFieldStyle` - Text rendering configuration
- `RenderPlan` - Layer visibility and text override instructions
- `CompositeInput` - Image layer for compositing
- `FrameOption`, `FxOption` - UI option lists
- `ArtBox` - Artwork placement configuration

### `cardProxy/constants.ts`
Configuration and mapping constants (no comments needed - names are self-documenting):
- `ART_BOX` - Artwork placement for normal/pendulum cards
- `LAYER_PATHS` - PSD layer name candidates for tree traversal
- `BORDER_NAME_CANDIDATES` - Frame type to PSD layer mapping
- `ATTRIBUTE_NAME_CANDIDATES` - Monster attributes to layer names
- `SPELL_TYPE_NAME_CANDIDATES`, `TRAP_TYPE_NAME_CANDIDATES` - Type icons
- `LINK_ARROW_NAME_CANDIDATES` - Link marker arrow names
- `TEXT_STYLE` - Font/color/alignment for dynamic text fields
- `FX_LABELS` - Display labels for special effects
- `BLEND_MODE_MAP` - Photoshop to sharp/libvips blend mode mapping

### `cardProxy/layerUtils.ts`
Layer tree traversal and utility functions:
- `normalizeName()` - Case/space-insensitive name comparison
- `findChild()`, `findDescendant()` - Layer search with fuzzy matching
- `findChildBySignature()` - Find layers by their children's names
- `resolvePath()`, `tryResolvePath()` - Navigate layer hierarchy
- `resolveContentRoot()` - Handle Photoshop auto-grouping
- `humanizeFrameName()`, `humanizeFxName()` - User-friendly labels
- `psdColorToHex()` - PSD color to hex conversion
- `formatStat()` - Format card stats (unknown as '?')
- `collectFxNodes()` - Find all special effect layers
- `nodePath()` - Debug: print layer hierarchy path

### `cardProxy/psdTree.ts`
PSD file loading and tree construction:
- `loadPsdTree()` - Parse PSD with ag-psd, cache result
- `buildNode()` - Recursively build layer tree
- `dumpLayerTree()` - Debug: print tree structure

### `cardProxy/renderPlan.ts`
Build rendering instructions from card data:
- `forceVisibleChain()`, `forceHiddenNode()`, `forceOnlyVisible()` - Visibility control
- `buildRenderPlan()` - Main plan builder
- `buildMonsterPlan()`, `buildSpellTrapPlan()` - Card type-specific logic
- `applyStarCount()` - Show level/rank pip layers
- Text field queueing for dynamic values

### `cardProxy/compositing.ts`
Image compositing and rendering:
- `isEffectivelyVisible()` - Check layer visibility in plan
- `resolveBlendMode()` - Map Photoshop blend modes
- `getEffectiveOpacity()` - Calculate compounded opacity
- `applyOpacity()`, `clampRawToCanvas()` - Raw pixel manipulation
- `extractLeafInput()` - Extract layer pixels for compositing
- `applyClipMask()` - Emulate Photoshop clipping groups
- `computeEffectiveBounds()` - Handle group bounds
- `resolveTextStyle()` - Get text formatting from PSD
- `renderDynamicText()` - SVG-based text rendering
- `collectCompositeInputs()` - Traverse tree for compositable layers
- `toOverlayOptions()` - Convert to sharp overlay format
- `compositeWithLayers()` - Main compositing orchestration

### `cardProxy/index.ts`
Public API and main rendering logic:
- Exports re-exports from utility modules
- `loadArtworkComposite()`, `loadOverframeComposite()` - Load artwork images
- `normalizeCardType()` - Parse card type/frame type
- `listFrameOptions()` - Available frame types
- `listFxOptions()` - Available special effects
- `renderProxyCard()` - Main public API

### `cardProxyGenerator.ts`
Clean re-export module for backward compatibility with existing imports.

## Comment Cleanup

All comments in the original file have been trimmed with the following strategy:

1. **Removed**: Implementation details that are obvious from the code
2. **Removed**: Temporary/debugging notes
3. **Kept**: Only essential clarifications for non-obvious logic
4. **Kept**: JSDoc for exported functions (minimal)
5. **Kept**: References to related functions or Photoshop concepts

Examples of kept comments:
- "Crop raw buffer to canvas bounds" (non-obvious algorithm)
- "Photoshop's layer opacity compounds through group nesting" (domain knowledge)
- "ag-psd cannot re-rasterize edited text layers" (tool limitation explanation)

Examples of removed comments:
- "exactly one frameType child visible" (obvious from code)
- "all zero left/top/right/bottom" (implementation detail)
- Repetitive variable descriptions

## Benefits

1. **Separation of Concerns**: Each module has a single responsibility
2. **Better Maintainability**: Easier to find and fix related code
3. **Reduced Cognitive Load**: Smaller files are easier to understand
4. **Cleaner Code**: Removed redundant/excessive comments improve readability
5. **Type Safety**: Types are centralized and easier to manage
6. **Easier Testing**: Modules can be tested independently
7. **Better IDE Support**: Smaller files = faster IntelliSense

## File Size Comparison

Original: `cardProxyGenerator.ts` - 1469 lines

Split into:
- `types.ts` - 59 lines (types only)
- `constants.ts` - 138 lines (configuration)
- `layerUtils.ts` - 113 lines (utilities)
- `psdTree.ts` - 81 lines (PSD loading)
- `renderPlan.ts` - 394 lines (plan building)
- `compositing.ts` - 308 lines (image ops)
- `index.ts` - 139 lines (main API)
- `cardProxyGenerator.ts` - 22 lines (re-exports)

Total: **1254 lines** (-215 lines from removed comments, same functionality)

## Backward Compatibility

The public API remains unchanged. All exports are re-exported through `cardProxyGenerator.ts` and `cardProxy/index.ts`, so existing code continues to work without modification.
