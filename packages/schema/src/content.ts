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
 * This module is pure — @astellum/schema is bundled into the browser clients.
 * Loading lives in `contentLoad.ts`, behind the `@astellum/schema/node`
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

/**
 * The quick-pick style buttons, as shipped.
 *
 * They live here rather than in one surface's client because more than one
 * asks the same question — the studio when it drafts, the kiosk when it is
 * configured to write on the night. A curator's `content.json` still wins over
 * this list; these are what stands when nothing is supplied.
 */
export const BUILT_IN_STYLE_PRESETS: StylePreset[] = [
  {
    id: 'kids',
    group: 'audience',
    labelZh: '儿童',
    labelEn: 'Kids',
    textZh: '目标读者是 8-12 岁的孩子,用生动的语言、比喻和故事。',
    textEn: 'Target audience is 8-12 year olds; use vivid language, metaphors and stories.',
  },
  {
    id: 'expert',
    group: 'audience',
    labelZh: '资深爱好者',
    labelEn: 'Experienced',
    textZh: '目标读者是有几年经验的天文观测者,可以使用专业术语,但仍要解释机制。',
    textEn:
      'Target audience is observers with several years of experience; technical terms are OK but still explain the mechanisms.',
  },
  {
    id: 'humor',
    group: 'audience',
    labelZh: '轻松幽默',
    labelEn: 'Playful',
    textZh: '用轻松、幽默的语气,可以适当加入流行文化的梗。',
    textEn: 'Use a light, humorous tone; some pop-culture references are welcome.',
  },
  {
    id: 'art',
    group: 'focus',
    labelZh: '艺术摄影',
    labelEn: 'Artistic',
    textZh: '侧重这张图的艺术与摄影解读,而不仅仅是科学。',
    textEn: 'Focus on the artistic / photographic reading of the image, not just the science.',
  },
  {
    id: 'history',
    group: 'focus',
    labelZh: '观测史',
    labelEn: 'History',
    textZh: '侧重这个天体的观测史——谁发现的、怎么发现的。',
    textEn: 'Focus on the observational history of the object — who discovered it and how.',
  },
  {
    id: 'culture',
    group: 'focus',
    labelZh: '跨文化',
    labelEn: 'Cultures',
    textZh: '用不同文化的古代天文视角来解读这张图。',
    textEn: 'Read the image through the lens of ancient astronomy from different cultures.',
  },
];

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
