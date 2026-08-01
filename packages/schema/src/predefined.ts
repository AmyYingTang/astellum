import { z } from 'zod';
import { LocalizedString } from './i18n.js';
import { normalizeId } from './registry.js';

/**
 * Predefined readings — the curated, offline substitute for the LLM.
 *
 * Onsite there is no network and no `claude` CLI, so the explanatory text has to
 * be written ahead of time. Three things are pre-written, and the reader falls
 * through them in order (config `reading.fallback`):
 *
 *   1. **this file** — a specific target, in a chosen style;
 *   2. the annotation's own `note` in the atlas registry;
 *   3. the type-level generic note (`featureNotes.ts`, 11 types);
 *   4. a template built from grounded facts.
 *
 * Never blank, never invented — a target with nothing written still gets the
 * generic layer, and the UI says so.
 *
 * Styles are a map because the audience varies (schools vs public vs advanced),
 * and the kiosk can switch between them live. The first release only ships
 * `general`; the structure is here so adding a style is data, not code.
 */

/** School year 8–12 reading level — also fine for general adult outreach. */
export const DEFAULT_STYLE = 'general' as const;

/**
 * The five things an explanation should cover (Amy, 2026-08-01). They apply to
 * predefined text AND to the LLM prompt, so the two modes read alike:
 *   1. what the object is and where it sits
 *   2. a sense of scale — above all, inside or outside the Milky Way
 *   3. the features worth looking at in this image
 *   4. cultural connections (naming, myth, history)
 *   5. fun facts
 */
export const READING_ELEMENTS = [
  'property_and_position',
  'sense_of_scale',
  'important_features',
  'culture',
  'fun_facts',
] as const;
export type ReadingElement = (typeof READING_ELEMENTS)[number];

/** Text for one annotation, matched by the atlas's stable `anno_…` id. */
export const PredefinedFeatureText = z.object({
  annotation_id: z.string(),
  explanation: LocalizedString,
  physics: LocalizedString.optional(),
  interesting: LocalizedString.optional(),
});
export type PredefinedFeatureText = z.infer<typeof PredefinedFeatureText>;

/**
 * One target in one style. `narrative` carries elements 1/2/4/5 as prose; the
 * optional slots exist so the entry UI can prompt for each element separately
 * and so a reviewer can see at a glance what's missing.
 */
export const PredefinedStyle = z.object({
  narrative: LocalizedString,
  /** Element 2 — inside or outside the Milky Way, how far, how big. */
  scale: LocalizedString.optional(),
  /** Element 4 — naming, myth, history of observation. */
  culture: LocalizedString.optional(),
  /** Element 5. */
  fun_facts: z.array(LocalizedString).default([]),
  /** Element 3 — per-annotation text (element 1 lives in `narrative`). */
  features: z.array(PredefinedFeatureText).default([]),
});
export type PredefinedStyle = z.infer<typeof PredefinedStyle>;

export const PredefinedReading = z.object({
  schema_version: z.literal(1),
  /** Matches the atlas registry entry's `primary_id`. */
  primary_id: z.string(),
  aliases: z.array(z.string()).default([]),
  styles: z.record(z.string(), PredefinedStyle).default({}),
  /** Where the text came from: hand-written, or an AI draft a human approved. */
  source: z.enum(['human', 'ai_draft', 'ai_approved']).default('human'),
  updated_at: z.string().datetime().optional(),
});
export type PredefinedReading = z.infer<typeof PredefinedReading>;

export const PredefinedLibrary = z.object({
  schema_version: z.literal(1),
  entries: z.array(PredefinedReading).default([]),
});
export type PredefinedLibrary = z.infer<typeof PredefinedLibrary>;

export const PREDEFINED_VERSION = 1 as const;

/** Merge libraries in priority order (later overlays win per target+style). */
export function mergeLibraries(libs: PredefinedLibrary[]): PredefinedLibrary {
  const byKey = new Map<string, PredefinedReading>();
  const order: string[] = [];
  for (const lib of libs) {
    for (const entry of lib.entries) {
      const key = normalizeId(entry.primary_id);
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, { ...entry, aliases: [...entry.aliases], styles: { ...entry.styles } });
        order.push(key);
      } else {
        for (const a of entry.aliases) if (!prev.aliases.includes(a)) prev.aliases.push(a);
        prev.styles = { ...prev.styles, ...entry.styles }; // overlay wins per style
        prev.source = entry.source;
      }
    }
  }
  return { schema_version: 1, entries: order.map((k) => byKey.get(k)!) };
}

/** Find the entry matching any of an object's identity strings (normalised). */
export function findPredefined(
  lib: PredefinedLibrary,
  ids: readonly string[],
): PredefinedReading | undefined {
  const keys = new Set(ids.map(normalizeId));
  return lib.entries.find(
    (e) => keys.has(normalizeId(e.primary_id)) || e.aliases.some((a) => keys.has(normalizeId(a))),
  );
}

/**
 * Pick a style, degrading rather than failing: the requested one, else the
 * default, else whichever single style exists. Onsite must always render
 * something when the target has any text at all.
 */
export function pickStyle(
  entry: PredefinedReading,
  style: string = DEFAULT_STYLE,
): { name: string; style: PredefinedStyle } | undefined {
  const names = Object.keys(entry.styles);
  const name = entry.styles[style] ? style : entry.styles[DEFAULT_STYLE] ? DEFAULT_STYLE : names[0];
  const picked = name ? entry.styles[name] : undefined;
  return name && picked ? { name, style: picked } : undefined;
}

/** Which of the five elements a style is still missing — drives the review UI. */
export function missingElements(style: PredefinedStyle): ReadingElement[] {
  const out: ReadingElement[] = [];
  if (!style.narrative.zh && !style.narrative.en) out.push('property_and_position');
  if (!style.scale) out.push('sense_of_scale');
  if (!style.features.length) out.push('important_features');
  if (!style.culture) out.push('culture');
  if (!style.fun_facts.length) out.push('fun_facts');
  return out;
}
