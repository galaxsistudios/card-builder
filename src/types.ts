/**
 * Minimal, self-contained card shape - deliberately NOT the full `CardRecord` from the main
 * Duel Worlds backend (`backend/src/db/cardsDb.ts`), so this tool has zero dependency on that
 * codebase's database layer and can be lifted out into its own project as-is.
 */
export interface ProxyCard {
  /** Used only for notes/logging and as the default output filename when `--out` isn't given. */
  id: string | number;
  name: string;
  /**
   * Must contain "Monster" for any monster type (e.g. "Normal Monster", "Effect Monster",
   * "Fusion Monster", "Synchro Monster", "XYZ Monster", "Link Monster", "Ritual Monster",
   * "Pendulum Effect Monster"), or be exactly "Spell Card" / "Trap Card". Anything else (e.g.
   * "Token") renders as a border-only card with no Overlays.
   */
  type: string;
  /**
   * Selects the Border frame layer - one of: normal, normal_pendulum, effect, effect_pendulum,
   * ritual, ritual_pendulum, fusion, fusion_pendulum, synchro, synchro_pendulum, dark_synchro,
   * xyz, xyz_pendulum, link, spell, trap, token, obelisk, ra, slifer. Run with `--list-frames` to
   * confirm these against the actual template.
   */
  frameType: string;
  atk?: number | null;
  def?: number | null;
  /** Level (or Rank, for an XYZ monster) - ignored for everything else. Negative values, or
   *  `frameType: 'dark_synchro'`, render as Dark Synchro's "Minus Level" pips instead. */
  level?: number | null;
  /** Spell/Trap subtype only - one of Quick-Play/Continuous/Equip/Field/Ritual (Spell) or
   *  Continuous/Counter (Trap), or omit/"Normal" for a plain Spell/Trap. Ignored for monsters. */
  race?: string | null;
  /** Monster attribute - one of DARK/LIGHT/EARTH/WATER/FIRE/WIND/DIVINE. Ignored for Spell/Trap
   *  (which always get the generic Spell/Trap corner icon) and anything else. */
  attribute?: string | null;
  /** Pendulum Scale - ignored unless `type`/`frameType` indicates Pendulum. */
  scale?: number | null;
  linkValue?: number | null;
  /** Any of Top/Bottom/Left/Right/Top-Left/Top-Right/Bottom-Left/Bottom-Right. */
  linkMarkers?: string[] | null;
  /**
   * Path to the card's artwork image (JPG/PNG), resolved relative to the card JSON file's own
   * directory (not the current working directory) so card data + art can be moved around
   * together.
   */
  art: string;
}
