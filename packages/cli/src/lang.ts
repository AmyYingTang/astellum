import { preferredLang } from '@astellum/schema';

export type Lang = 'zh' | 'en';

/** Name of the cookie every server-rendered surface reads and writes. */
export const LANG_COOKIE = 'astellum_lang';

/**
 * Which language a server-rendered page should come back in.
 *
 * The browser's own preference first, overridden by whatever the visitor last
 * chose. The cookie is set on path=/ and cookies ignore the port, so one choice
 * covers the hub, the kiosk and anything else served from localhost — which is
 * the point: walking from the dashboard into the kiosk must not switch language
 * under you.
 */
export function langFor(req: { headers: Record<string, unknown> }): Lang {
  const cookie = String(req.headers['cookie'] ?? '');
  const saved = new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=(zh|en)`).exec(cookie)?.[1];
  if (saved === 'zh' || saved === 'en') return saved;
  const accept = String(req.headers['accept-language'] ?? '');
  return preferredLang(
    accept
      .split(',')
      .map((p) => p.split(';')[0]!.trim())
      .filter(Boolean),
  );
}
