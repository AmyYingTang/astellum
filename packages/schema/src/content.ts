import { z } from 'zod';
import { LocalizedString } from './i18n.js';
import { FEATURE_NOTES } from './featureNotes.js';
import type { FeatureTypeKey } from './taxonomy.js';

/**
 * Curator-editable text, kept out of the source.
 *
 * Some of what this tool says is engineering — schemas, vocabularies, colour
 * mappings — and belongs in code where the type system can hold it together.
 * The rest is *writing*: the plain-language note for each kind of structure,
 * the amateur nicknames a catalogue has never heard of, the style presets
 * offered next to the prompt, the brief the LLM is given. Those get revised by
 * the people who present with them, and asking them to edit TypeScript and
 * rebuild is the wrong shape for that work.
 *
 * An overlay file supplies any subset; anything it omits falls back to the
 * built-in value. So there is nothing to migrate, an empty file is valid, and a
 * typo in one entry cannot take the others down with it.
 *
 * This module is pure — @astrolens/schema is bundled into the browser clients.
 * Loading lives in `contentLoad.ts`, behind the `@astrolens/schema/node`
 * subpath, and calls `setContentOverlay` once at startup.
 */

export const StylePreset = z.object({
  id: z.string(),
  group: z.enum(['audience', 'focus']),
  labelZh: z.string(),
  labelEn: z.string(),
  /** Appended to the prompt, in the report's content language. */
  textZh: z.string(),
  textEn: z.string(),
});
export type StylePreset = z.infer<typeof StylePreset>;

export const ReadingBrief = z.object({
  /** Who the writing is for, and how it should sound. */
  styleBrief: z.string().optional(),
  /** The things every reading should cover, one per line. */
  elements: z.array(z.string()).optional(),
});
export type ReadingBrief = z.infer<typeof ReadingBrief>;

export const ContentOverlay = z.object({
  /** Plain-language note per drawable feature type, keyed by taxonomy key. */
  featureNotes: z.record(z.string(), LocalizedString).optional(),
  /** Catalogue designation → the name people actually use for it. */
  nicknames: z.record(z.string(), z.object({ en: z.string(), zh: z.string().optional() })).optional(),
  /** The quick-pick style buttons beside the studio's prompt box. */
  stylePresets: z.array(StylePreset).optional(),
  /** What the LLM is told when drafting a reading. */
  readingBrief: ReadingBrief.optional(),
});
export type ContentOverlay = z.infer<typeof ContentOverlay>;

let overlay: ContentOverlay = {};

/** Install the loaded overlay. Server-side entry points call this once. */
export function setContentOverlay(next: ContentOverlay): void {
  overlay = next;
}

export function contentOverlay(): ContentOverlay {
  return overlay;
}

/** The note for a feature type: the curator's wording if they wrote one. */
export function featureNoteFor(ft: FeatureTypeKey): LocalizedString | undefined {
  return overlay.featureNotes?.[ft] ?? FEATURE_NOTES[ft];
}

/** Which feature types have a note, from either layer. */
export function featureNoteKeys(): string[] {
  return [...new Set([...Object.keys(FEATURE_NOTES), ...Object.keys(overlay.featureNotes ?? {})])];
}
