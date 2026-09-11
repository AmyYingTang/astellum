import { ofetch } from 'ofetch';
import type { ObjectCategory } from '@astellum/schema';

/**
 * Wikidata enrichment (Notion §11.1 Tier 1). For an object that already has a
 * common name (⇒ famous ⇒ likely a wiki entry), fetch:
 *  - a **zh name** (label or alias) for the bilingual rule — SIMBAD `NAME` is
 *    English-only;
 *  - a **type** from `instance of` (P31), but only when P31 names a *specific
 *    mechanism* (SNR / PN / reflection …). A generic "H II region" / "emission
 *    nebula" P31 is NOT used to override — Wikidata inherits the same survey
 *    ambiguity (an SNR optical filament still reads as H II), so the catalogue
 *    emission type + its hedge is left as-is. Mechanism fixes for sub-features
 *    (e.g. the Pencil ⊂ Vela SNR) need positional membership = Tier 2 (future).
 *
 * Best-effort: any failure (offline, no match) returns null.
 */

const log = (m: string): void => console.error(`[wikidata] ${m}`);

export interface WikiInfo {
  name_zh?: string;
  /** Only set for a mechanism-specific P31 that should override a generic type. */
  category?: ObjectCategory;
}

/** P31 QIDs we treat as a mechanism-specific override of a generic catalogue type. */
const MECHANISM_P31: Record<string, ObjectCategory> = {
  Q207436: 'supernova_remnant',
  Q13632: 'planetary_nebula',
  Q213936: 'reflection_nebula',
  Q204210: 'dark_nebula',
  Q11276: 'globular_cluster',
  Q11387: 'open_cluster',
  Q318: 'galaxy',
};

/** Astro P31s — used (with P59) to confirm a search hit is a sky object. */
const ASTRO_P31 = new Set<string>([
  ...Object.keys(MECHANISM_P31),
  'Q11282', // H II region
  'Q204194', // emission nebula
  'Q1054444', // nebula
  'Q1931185', // astronomical radio source
  'Q523', // star
  'Q6243', // variable star
]);

export interface WikidataOptions {
  baseUrl?: string;
}

// Wikidata asks API clients to send a descriptive User-Agent (anonymous default
// UAs get throttled / blocked). https://meta.wikimedia.org/wiki/User-Agent_policy
const USER_AGENT = 'astellum/0.1 (deep-sky outreach annotation tool)';

export function createWikidataClient(opts: WikidataOptions = {}) {
  const api = opts.baseUrl ?? 'https://www.wikidata.org/w/api.php';

  async function lookup(name: string): Promise<WikiInfo | null> {
    try {
      // Ambiguous names ("Antares" = star / rocket / company) → take several
      // hits and use the first that's actually astronomical.
      const s = await ofetch<{ search?: { id: string }[] }>(api, {
        query: {
          action: 'wbsearchentities',
          search: name,
          language: 'en',
          type: 'item',
          format: 'json',
          limit: 7,
          origin: '*',
        },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 15_000,
      });
      const ids = (s.search ?? []).map((r) => r.id).filter(Boolean);
      if (!ids.length) return null;

      const e = await ofetch<{ entities?: Record<string, WdEntity> }>(api, {
        query: {
          action: 'wbgetentities',
          ids: ids.join('|'),
          props: 'labels|aliases|claims',
          languages: 'en|zh',
          format: 'json',
          origin: '*',
        },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 15_000,
      });

      for (const qid of ids) {
        const ent = e.entities?.[qid];
        if (!ent) continue;
        const p31 = (ent.claims?.P31 ?? [])
          .map((c) => c.mainsnak?.datavalue?.value?.id)
          .filter((id): id is string => !!id);
        // Astro sanity check: an astronomy P31, or a constellation (P59) claim —
        // nearly every sky object has one; a same-named brand/song does not.
        const isAstro = p31.some((id) => ASTRO_P31.has(id)) || !!ent.claims?.P59?.length;
        if (!isAstro) continue;
        const name_zh = ent.labels?.zh?.value ?? ent.aliases?.zh?.[0]?.value;
        const mech = p31.find((id) => MECHANISM_P31[id]);
        return { name_zh, category: mech ? MECHANISM_P31[mech] : undefined };
      }
      return null;
    } catch (err) {
      log(`lookup "${name}" failed: ${(err as Error)?.message ?? err}`);
      return null;
    }
  }

  return { lookup };
}

interface WdEntity {
  labels?: Record<string, { value: string }>;
  aliases?: Record<string, { value: string }[]>;
  claims?: {
    P31?: { mainsnak?: { datavalue?: { value?: { id?: string } } } }[];
    P59?: unknown[]; // constellation — presence = astronomical object
  };
}
