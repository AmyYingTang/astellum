import { z } from 'zod';

/**
 * A user-facing string that must carry both Chinese and English.
 * astellum i18n rule: every type / feature name / explanation ships zh + en.
 */
export const LocalizedString = z.object({
  zh: z.string(),
  en: z.string(),
});
export type LocalizedString = z.infer<typeof LocalizedString>;

/**
 * Pick a starting UI language from what the browser says it wants.
 *
 * Defaulting to Chinese was fine while the only users were the two people who
 * built this, and wrong the moment anyone else opens it. Kept pure and given the
 * candidate list rather than reading `navigator` itself, so it is testable and
 * so this module stays safe to bundle anywhere.
 *
 * Anything Chinese — zh, zh-CN, zh-TW, zh-Hant — gets Chinese; everything else
 * gets English, since those are the only two the content is written in.
 */
export function preferredLang(candidates: readonly string[]): 'zh' | 'en' {
  return candidates.some((l) => l.toLowerCase().startsWith('zh')) ? 'zh' : 'en';
}
