/**
 * A feature's name, written on the picture beside its number.
 *
 * The number alone makes the viewer hold "4" in their head and go hunting for
 * it in a list — and on a poster or an exported frame there is no list to hunt
 * in. The name next to the mark removes that errand.
 *
 * Legibility over an astrophoto is the whole difficulty: the background can be
 * anything from black sky to a white core within a few hundred pixels. Every
 * name sits on the same dark plate, light text on it, so nothing depends on the
 * colour behind it. (It began as the feature's colour over a dark halo, which
 * kept the picture freer of boxes and was unreadable whenever the colour was
 * grey and the background bright — the kiosk moved to plates first.)
 */

export interface OverlayLabelOptions {
  /** The text as it should appear now. */
  text: string;
  /** Both languages, when the page can switch without reloading. Adds the
   *  data-zh/data-en pair the kiosk's switcher looks for. */
  bilingual?: { zh: string; en: string };
  /** Badge centre, in image coordinates. */
  x: number;
  y: number;
  /** The badge's authored radius — everything here is sized from it, so the
   *  label holds its proportions on a 1200px frame and a 4000px one alike. */
  bubbleR: number;
  /** Radius the badge is actually drawn at, if the renderer shrank it. */
  drawnR?: number;
  /** The feature's stroke colour. Not painted — the plate is one colour for
   *  every name — but kept so callers describe the feature the same way. */
  color: string;
  /** Frame width, to decide which side of the badge the name goes on. */
  frameWidth: number;
  className?: string;
  /** Leave the plate unsized for the caller to fit at runtime — the kiosk,
   *  which can measure the text in a browser. Otherwise the plate is sized
   *  here, from an estimate (see `estimateTextEm`). */
  plate?: boolean;
}

/**
 * Where to put a line's baseline so its letters sit centred on a point: this
 * many font sizes below it.
 *
 * `dominant-baseline="central"` says the same thing and browsers honour it,
 * but librsvg — which renders the exported frame — ignores it and sets the
 * baseline on the centre, so every name and number sat in the top half of its
 * plate or badge. Measured there: 0.35 centres Latin capitals, CJK and digits
 * alike (descenders hang below, as they should).
 */
export const CENTRE_BASELINE = 0.35;

/** The plate's look, shared by every surface that draws one. */
export const LABEL_PLATE = {
  fill: '#080b12',
  opacity: 0.9,
  text: '#f2f5fb',
  /** Horizontal padding, in font sizes. */
  padX: 0.4,
  /** Plate height, in font sizes. */
  height: 1.5,
  /** Corner radius, in font sizes. */
  radius: 0.3,
} as const;

/**
 * How wide a string sets in bold sans, in ems.
 *
 * An estimate, because librsvg — which renders the exported frame — cannot be
 * asked. The text is centred on its plate, so an error of a few percent shows
 * as a hair more or less padding on both sides rather than a name running off
 * one end.
 */
export function estimateTextEm(text: string): number {
  let em = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x2e80) em += 1; // CJK and full-width punctuation
    else if (/[ijlI.,:;!|'·\s]/.test(ch)) em += 0.3;
    else if (/[A-Z]/.test(ch)) em += 0.7;
    else if (/[0-9]/.test(ch)) em += 0.58;
    else if (/[mwMW]/.test(ch)) em += 0.85;
    else em += 0.57;
  }
  return em;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function overlayLabel(o: OverlayLabelOptions): string {
  const text = o.text.trim();
  if (!text) return '';
  const fontSize = Math.round(o.bubbleR * 0.95);
  const gap = (o.drawnR ?? o.bubbleR) * 1.5;
  // Near the right edge the name would run off the picture, so it changes
  // sides. Nothing else in the kiosk guards the frame edge, and a name half
  // outside it is worse than no name.
  const onLeft = o.x > o.frameWidth * 0.66;
  const x = onLeft ? o.x - gap : o.x + gap;
  const i18n = o.bilingual
    ? ` data-zh="${esc(o.bilingual.zh)}" data-en="${esc(o.bilingual.en)}"`
    : '';
  const cls = o.className ? ` class="${o.className}"` : '';
  const anchor = onLeft ? 'end' : 'start';

  if (o.plate) {
    // The plate is left unsized: only the browser knows how wide this string
    // renders, and guessing from character counts goes wrong the moment the
    // two scripts mix. Whoever draws this measures the text and fits the rect.
    return (
      `<g${cls}><rect class="k-plate" rx="${Math.round(fontSize * 0.3)}"/>` +
      `<text class="k-label-t"${i18n} x="${Math.round(x)}" y="${Math.round(o.y)}" ` +
      `font-family="sans-serif" font-size="${fontSize}" font-weight="700" ` +
      `fill="#f2f5fb" text-anchor="${anchor}" dominant-baseline="central">${esc(text)}</text></g>`
    );
  }

  const w = (estimateTextEm(text) + LABEL_PLATE.padX * 2) * fontSize;
  const h = LABEL_PLATE.height * fontSize;
  const left = onLeft ? x - w : x;
  return (
    `<g${cls}><rect x="${Math.round(left)}" y="${Math.round(o.y - h / 2)}" ` +
    `width="${Math.round(w)}" height="${Math.round(h)}" rx="${Math.round(fontSize * LABEL_PLATE.radius)}" ` +
    `fill="${LABEL_PLATE.fill}" fill-opacity="${LABEL_PLATE.opacity}"/>` +
    `<text${i18n} x="${Math.round(left + w / 2)}" y="${Math.round(o.y + fontSize * CENTRE_BASELINE)}" ` +
    `font-family="sans-serif" font-size="${fontSize}" font-weight="700" ` +
    `fill="${LABEL_PLATE.text}" text-anchor="middle">${esc(text)}</text></g>`
  );
}
