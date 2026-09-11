/**
 * Curated common-name overlay — popular amateur nicknames that exist in no
 * structured source we query (verified absent from SIMBAD `NAME`, Wikidata
 * labels/aliases, Wikipedia, and OpenNGC's Common-names column). They live only
 * in observing apps (SkySafari / Telescopius) and the astrophotography
 * community, so the only reliable way to surface them is this hand-maintained
 * map. Keyed by a catalogue designation; extend it as new targets come up.
 */

import { contentOverlay } from '@astellum/schema';

export interface Nickname {
  en: string;
  zh?: string;
}

export const NICKNAMES: Record<string, Nickname> = {
  'NGC 3576': { en: 'Statue of Liberty Nebula', zh: '自由女神星云' },
  // Famous dark nebula with no catalogued common name — only survey designations
  // (Dobashi TGU). Keyed on its main one so it surfaces + gets named.
  'TGU H1868': { en: 'Dark Doodad', zh: '暗黑涂鸦' },
  // η Carinae — the iconic central engine of the Carina Nebula. Wildly variable
  // (V≈6.5 now), so it's beyond the bright-star cutoff and never fetched/kept
  // without curation. Keyed on the SIMBAD main_id.
  '* eta Car': { en: 'Eta Carinae', zh: '海山二' },
};

/** Normalise a designation for matching: collapse whitespace, upper-case. */
function norm(d: string): string {
  return d.replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Normalised lookup, built from the built-in map plus any curator overlay.
 *
 * Cached against the overlay object so it is built once per process in the
 * normal case, but a test (or a reload) that swaps the overlay still sees the
 * change rather than a stale index.
 */
let cachedFor: object | null = null;
let index: Record<string, Nickname> = {};

function lookupIndex(): Record<string, Nickname> {
  const extra = contentOverlay().nicknames;
  const key = extra ?? NICKNAMES;
  if (cachedFor !== key) {
    index = Object.fromEntries(
      Object.entries({ ...NICKNAMES, ...(extra ?? {}) }).map(([k, v]) => [norm(k), v]),
    );
    cachedFor = key;
  }
  return index;
}

/** First curated nickname matching any of the object's designations, if any. */
export function lookupNickname(designations: string[]): Nickname | undefined {
  const idx = lookupIndex();
  for (const d of designations) {
    const n = idx[norm(d)];
    if (n) return n;
  }
  return undefined;
}
