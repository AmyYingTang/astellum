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
      '目标读者是小学生(约 7–12 岁),想象一个孩子正站在这张图前面。每个结构先用日常的东西打比方,说它像什么(塔、泡泡、发光的边、暗暗的缺口),再用一个简单的动作讲原因——是什么很热的东西在推它、吹它、照亮它。整段最多用一个让人惊叹的大数字,单位要孩子能想象(比如公里)。多引导孩子在图里找东西。句子要短,不用专业术语,结尾留一个可以去发现的小悬念(比如藏在里面的「星星宝宝」)。可以简化,但不能说错。',
    textEn:
      "Audience: primary school students (about 7–12). Picture a child standing in front of this image. For each structure, first say what it looks like in everyday words (towers, bubbles, glowing edges, dark gaps), then give the cause as one simple action: something very hot pushing it, blowing it or lighting it up. Use at most one big-number 'wow', in units a child can picture (such as kilometres). Invite them to find things in the picture. Keep sentences short, use no technical terms, and end with something to discover (a baby star hiding inside, a hidden clue). Simplify, but never say anything untrue.",
  },
  {
    id: 'adult',
    group: 'audience',
    labelZh: '成人',
    labelEn: 'Adult',
    textZh:
      '目标读者是对科学好奇、但没有专业背景的成年人。每个结构先说出观众在图上能看到的样子,再用大白话讲清楚是什么物理过程把它塑造成这个形状(比如星光把云层一点点蒸发掉、恒星风吹出一个空腔)。每条至少给一个观众能在这张图上自己验证的细节——它朝哪个方向、亮边在哪一侧、旁边挨着什么。尽量联系到此刻仍在发生的过程。需要用术语时,在同一句里顺带解释。语气尊重,不要哄小孩,也不要「令人叹为观止」这类空话。',
    textEn:
      'Audience: curious adults with no science background. For each structure, first name what the viewer can see, then explain in plain words the physical process that gave it this shape (for example, starlight slowly evaporating a cloud, or a stellar wind blowing out a cavity). Give at least one detail the viewer can check on this image themselves: which way it points, which side the bright edge is on, what sits next to it. Where possible, connect it to something still happening now. If a technical term helps, explain it in the same sentence. Be respectful rather than childish, and avoid empty superlatives.',
  },
  {
    id: 'teacher',
    group: 'audience',
    labelZh: '中学科学老师',
    labelEn: 'Science teacher',
    textZh:
      '目标读者是正在备课的中学科学教师。使用规范的科学术语(如电离锋面、光致蒸发、恒星风、超新星遗迹),如果知道是哪个源头塑造了某个结构,要点名说出来(优先使用给定清单里的天体)。把每个结构和课程里会讲到的一般物理原理联系起来(辐射与物质、能量传递、引力、恒星的一生)。narrative 开头给一句可以直接拿到课堂上用的引子。不确定的地方要明说:机制有争议或数值不确定时,用「可能」「目前认为」等措辞,不要说成定论。不要编造数字,没把握的就不写。',
    textEn:
      "Audience: secondary school science teachers preparing a lesson. Use correct scientific terms (for example, ionisation front, photoevaporation, stellar wind, supernova remnant), and name the source responsible for each structure when it is known, preferring objects in the given list. Tie each structure to a general physical principle that a curriculum covers (radiation and matter, energy transfer, gravity, the life cycle of stars). Open the narrative with a one-line classroom hook. State uncertainty plainly: where a mechanism is debated or a value is uncertain, say so ('possibly', 'is thought to') rather than presenting it as settled. Do not invent numbers; leave out any you are not sure of.",
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
