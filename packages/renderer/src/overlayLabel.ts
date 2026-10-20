/**
 * A feature's name, written on the picture beside its number.
 *
 * The number alone makes the viewer hold "4" in their head and go hunting for
 * it in a list — and on a poster or an exported frame there is no list to hunt
 * in. The name next to the mark removes that errand.
 *
 * Legibility over an astrophoto is the whole difficulty: the background can be
 * anything from black sky to a white core within a few hundred pixels. A plate
 * behind each name would solve it and litter the picture with boxes, so this
 * does what the atlas canvas already does — the feature's own colour, painted
 * over a dark halo (`paint-order="stroke"` puts the stroke underneath instead
 * of eating the glyph from both sides).
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
  /** The feature's stroke colour. */
  color: string;
  /** Frame width, to decide which side of the badge the name goes on. */
  frameWidth: number;
  className?: string;
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
  const cls = o.className ? ` class="${o.className}"` : '';
  const i18n = o.bilingual
    ? ` data-zh="${esc(o.bilingual.zh)}" data-en="${esc(o.bilingual.en)}"`
    : '';
  return (
    `<text${cls}${i18n} x="${Math.round(x)}" y="${Math.round(o.y)}" ` +
    `font-family="sans-serif" font-size="${fontSize}" font-weight="700" ` +
    `fill="${o.color}" stroke="#0b0e14" stroke-width="${Math.max(1, Math.round(fontSize * 0.05))}" ` +
    `paint-order="stroke" text-anchor="${onLeft ? 'end' : 'start'}" ` +
    `dominant-baseline="central">${esc(text)}</text>`
  );
}
