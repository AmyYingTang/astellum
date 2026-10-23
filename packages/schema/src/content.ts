import { z } from 'zod';
import { LocalizedString } from './i18n.js';
import { FEATURE_NOTES } from './featureNotes.js';
import { DEFAULT_ROLE, ROLE_IDS } from './predefined.js';
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
  /**
   * For an `audience` preset this is a role id, and therefore also a style key
   * in the predefined library — see `ROLE_IDS`. For a `focus` preset it names
   * nothing outside this list.
   */
  id: z.string(),
  /**
   * `audience` is the role: who is being written for. Exactly one is in force
   * at a time, and something always is — a reading is written for somebody.
   * `focus` is what to lean on, any number of them, or none.
   */
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
 * asks the same question — the studio beside its prompt, the kiosk in its
 * picker and on the frame itself. A curator's `content.json` still wins over
 * this list; these are what stands when nothing is supplied.
 *
 * The three `audience` entries are the roles, and their ids are style keys in
 * the predefined library. Renaming one in an overlay therefore renames the key
 * the library is read by, which is why `ROLE_IDS` is the source of truth for
 * the ids and this list only supplies their wording.
 */
export const BUILT_IN_STYLE_PRESETS: StylePreset[] = [
  {
    id: 'primary',
    group: 'audience',
    labelZh: '小学生',
    labelEn: 'Primary school',
    textZh:
      '目标读者是小学生(7-12 岁)。用生动的语言、比喻和故事,句子要短,避开专业术语。',
    textEn:
      'Target audience is primary school children (7-12). Use vivid language, metaphors and stories; keep sentences short and avoid jargon.',
  },
  {
    id: 'adult',
    group: 'audience',
    labelZh: '成人',
    labelEn: 'Adult',
    textZh:
      '目标读者是普通成年观众,没有天文学背景但愿意了解。可以用少量专业词,但每个都要解释。',
    textEn:
      'Target audience is general adult visitors with no astronomy background but real curiosity. A few technical terms are fine, but explain each one.',
  },
  {
    id: 'teacher',
    group: 'audience',
    labelZh: '中学科学老师',
    labelEn: 'Science teacher',
    textZh:
      '目标读者是中学科学老师。可以直接使用专业术语,侧重物理机制,以及能带进课堂的要点。',
    textEn:
      'Target audience is secondary school science teachers. Use technical terms freely; lean on the physical mechanisms and on what they could take into a lesson.',
  },
  {
    // A tone, not a role — so it sits with the focus presets, which stack and
    // are optional. It used to be a third audience, where it competed with the
    // question of who is in the room instead of answering it.
    id: 'humor',
    group: 'focus',
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

/**
 * The preset list in force: a curator's, if they supplied one.
 *
 * Every surface used to decide this for itself, and they disagreed about what
 * an empty array meant. One answer here, because an overlay that replaces the
 * buttons has to replace them everywhere — the role ids are style keys, and a
 * kiosk reading a key the studio never writes finds nothing.
 */
export function stylePresets(): StylePreset[] {
  return overlay.stylePresets?.length ? overlay.stylePresets : BUILT_IN_STYLE_PRESETS;
}

/** The roles, in the order they are offered. Exactly one is ever in force. */
export function rolePresets(): StylePreset[] {
  return stylePresets().filter((p) => p.group === 'audience');
}

/** What to lean on. Any number, including none. */
export function focusPresets(): StylePreset[] {
  return stylePresets().filter((p) => p.group === 'focus');
}

/**
 * Which role a surface starts in.
 *
 * `adult` unless an overlay dropped it, in which case the first role it does
 * offer — a surface has to open in some role, and refusing to choose would
 * leave it with no text to show.
 */
export function defaultRoleId(): string {
  const roles = rolePresets();
  return roles.find((r) => r.id === DEFAULT_ROLE)?.id ?? roles[0]?.id ?? DEFAULT_ROLE;
}

/**
 * Is this one of the roles currently on offer?
 *
 * Guards the query strings and request bodies the roles now travel in: an
 * unknown role would reach `pickStyle` as a style key, find nothing, and
 * degrade — quietly showing the catch-all text under a role name nobody
 * chose. Built-in ids are accepted even when an overlay has narrowed the list,
 * so a frame written before the overlay changed still resolves.
 */
export function isRoleId(id: string | undefined): boolean {
  if (!id) return false;
  return rolePresets().some((r) => r.id === id) || (ROLE_IDS as readonly string[]).includes(id);
}
