/**
 * Shared ygoprodeck card-database helpers used by scripts/buildAllCards.ts and
 * scripts/buildDeckCards.ts - loading data/cardinfo.json, resolving a card's artwork path, and
 * mapping its fields onto ProxyCard (see src/types.ts).
 */
import fs from 'fs';
import path from 'path';
import { ProxyCard } from '../src/types';

export const DATA_FILE = path.join(__dirname, '..', 'data', 'cardinfo.json');
export const ARTWORK_DIR = path.join(__dirname, '..', 'card-artworks');
export const OVERFRAME_DIR = path.join(ARTWORK_DIR, 'overframes');

export interface YgoCardImage {
  id: number;
  image_url_cropped: string;
}

export interface YgoCard {
  id: number;
  name: string;
  type: string;
  frameType: string;
  atk?: number | null;
  def?: number | null;
  level?: number | null;
  attribute?: string | null;
  race?: string | null;
  scale?: number | null;
  linkval?: number | null;
  linkmarkers?: string[] | null;
  card_images?: YgoCardImage[];
}

export interface CardDatabase {
  data: YgoCard[];
}

export function loadCardDatabase(dataFile: string = DATA_FILE): CardDatabase {
  return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
}

/** Strips characters that are illegal in Windows filenames. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').trim();
}

export function toProxyCard(card: YgoCard, artPath: string): ProxyCard {
  return {
    id: card.id,
    name: card.name,
    type: card.type,
    frameType: card.frameType,
    atk: card.atk ?? null,
    def: card.def ?? null,
    level: card.level ?? null,
    attribute: card.attribute ?? null,
    race: card.race ?? null,
    scale: card.scale ?? null,
    linkValue: card.linkval ?? null,
    linkMarkers: card.linkmarkers ?? null,
    art: artPath,
  };
}

/** Resolves a card's primary artwork path on disk, or undefined if it has none / isn't downloaded. */
export function resolveArtPath(card: YgoCard): string | undefined {
  const image = card.card_images?.[0];
  if (!image) return undefined;
  const artPath = path.join(ARTWORK_DIR, `${image.id}.jpg`);
  return fs.existsSync(artPath) ? artPath : undefined;
}

/** Resolves a card's "overframe" full-canvas art replacement, keyed by the card's own id (see
 *  card-artworks/overframes/) - or undefined if this card doesn't have one. */
export function resolveOverframePath(card: YgoCard): string | undefined {
  const overframePath = path.join(OVERFRAME_DIR, `${card.id}.png`);
  return fs.existsSync(overframePath) ? overframePath : undefined;
}
