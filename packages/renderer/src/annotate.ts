import sharp from 'sharp';
import { COLOR_PALETTE, badgeAnchor, type Reading } from '@astellum/schema';
import { overlayLabel } from './overlayLabel.js';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build the SVG overlay (circles + numbered badges) for a report. */
export function buildOverlaySvg(report: Reading): string {
  const { width, height } = report.image;
  const lang = report.display_language;
  const strokeW = Math.max(2, Math.round(Math.min(width, height) / 300));
  const parts: string[] = [];

  for (const f of report.features) {
    if (f.draw === false) continue; // listed in the Facts panel but not drawn
    const color = COLOR_PALETTE[f.color_key];
    const { cx, cy, r } = f.circle;
    if (f.shape === 'arrow' && f.arrow_to) {
      // Class-B direction arrow (line + arrowhead).
      const [ax, ay] = f.arrow_to;
      const ang = Math.atan2(ay - cy, ax - cx);
      const hl = strokeW * 6;
      const p2 = `${(ax - hl * Math.cos(ang - 0.4)).toFixed(1)},${(ay - hl * Math.sin(ang - 0.4)).toFixed(1)}`;
      const p3 = `${(ax - hl * Math.cos(ang + 0.4)).toFixed(1)},${(ay - hl * Math.sin(ang + 0.4)).toFixed(1)}`;
      parts.push(
        `<line x1="${cx}" y1="${cy}" x2="${ax}" y2="${ay}" stroke="${color.stroke}" stroke-width="${strokeW}"/>`,
        `<polygon points="${ax},${ay} ${p2} ${p3}" fill="${color.stroke}"/>`,
      );
    } else if (f.shape === 'dot') {
      // Comet nucleus: small filled dot (badge anchors at the coma radius).
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="${strokeW * 2.5}" fill="${color.stroke}" stroke="#0b0e14" stroke-width="${Math.max(1, Math.round(strokeW / 2))}"/>`,
      );
    } else if (f.shape === 'arc' && f.arc) {
      // Class-B ionization front: a curved arc along the nebula rim.
      const { cx: acx, cy: acy, r: ar, a0, a1 } = f.arc;
      const x0 = (acx + ar * Math.cos(a0)).toFixed(1);
      const y0 = (acy + ar * Math.sin(a0)).toFixed(1);
      const x1 = (acx + ar * Math.cos(a1)).toFixed(1);
      const y1 = (acy + ar * Math.sin(a1)).toFixed(1);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      parts.push(
        `<path d="M ${x0} ${y0} A ${ar.toFixed(1)} ${ar.toFixed(1)} 0 ${large} 1 ${x1} ${y1}" fill="none" stroke="${color.stroke}" stroke-width="${strokeW}" stroke-linecap="round"/>`,
      );
    } else if (f.shape === 'polyline' && f.polygon && f.polygon.length > 1) {
      // A pillar's bright rim: a thin open line tracing the lit edge (its own
      // colour/label distinguishes it from the dashed column outline).
      const rpts = f.polygon.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
      parts.push(
        `<polyline points="${rpts}" fill="none" stroke="${color.stroke}" stroke-width="${Math.max(1, Math.round(strokeW * 0.8))}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    } else if (f.shape === 'polygon' && f.polygon && f.polygon.length > 1) {
      // Class-B morphology suggestion (e.g. a pillar): a soft dashed outline,
      // never a hard box. An optional arrow shows the 迎光 / illumination direction.
      const pts = f.polygon.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
      parts.push(
        `<polygon points="${pts}" fill="none" stroke="${color.stroke}" stroke-width="${strokeW}" stroke-dasharray="${strokeW * 4} ${strokeW * 3}" stroke-linejoin="round"/>`,
      );
      if (f.arrow_to) {
        const [ax, ay] = f.arrow_to;
        const ang = Math.atan2(ay - cy, ax - cx);
        const hl = strokeW * 5;
        const p2 = `${(ax - hl * Math.cos(ang - 0.4)).toFixed(1)},${(ay - hl * Math.sin(ang - 0.4)).toFixed(1)}`;
        const p3 = `${(ax - hl * Math.cos(ang + 0.4)).toFixed(1)},${(ay - hl * Math.sin(ang + 0.4)).toFixed(1)}`;
        parts.push(
          `<line x1="${cx}" y1="${cy}" x2="${ax}" y2="${ay}" stroke="${color.stroke}" stroke-width="${strokeW}"/>`,
          `<polygon points="${ax},${ay} ${p2} ${p3}" fill="${color.stroke}"/>`,
        );
      }
    } else if (f.shape !== 'field') {
      // A-class solid ring, or a Class-B shell sample (small dashed circle).
      // 'field' is the subject the frame is a crop of: a ring around it would
      // claim a boundary this picture does not contain, so it gets none.
      const dash = f.shape === 'shell' ? ` stroke-dasharray="${strokeW * 5} ${strokeW * 3}"` : '';
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color.stroke}" stroke-width="${strokeW}"${dash}/>`,
      );
    }

    // Badge anchored fully outside the circle (offset by r + bubble radius) so
    // it never covers small circles, then nudged by the user offset — but kept
    // inside the image so a big circle near an edge can't push it off-frame.
    const br = f.badge.bubble_r;
    const clamp = (v: number, lo: number, hi: number): number =>
      hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));
    const [ax, ay] = badgeAnchor(f, br);
    const bx = clamp(ax + f.badge.offset_x, br, width - br);
    const by = clamp(ay + f.badge.offset_y, br, height - br);
    const fontSize = Math.round(br * 1.1);
    parts.push(
      `<circle cx="${bx}" cy="${by}" r="${br}" fill="${color.badge}" stroke="#0b0e14" stroke-width="${Math.max(1, Math.round(strokeW / 2))}"/>`,
    );
    parts.push(
      `<text x="${bx}" y="${by}" font-family="sans-serif" font-size="${fontSize}" font-weight="700" fill="#0b0e14" text-anchor="middle" dominant-baseline="central">${escapeXml(f.badge.num)}</text>`,
    );
    // The name, beside the number. A printed frame has no list to look the
    // number up in, so without this the badge is a riddle. Full strength: there
    // is no selection here to fade anything against.
    parts.push(
      overlayLabel({
        text: f.label[lang],
        x: bx,
        y: by,
        bubbleR: br,
        color: color.stroke,
        frameWidth: width,
      }),
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
}

type ImageFormat = 'jpeg' | 'png';

function annotatedPipeline(
  imagePath: string,
  svgOverlay: string,
  format: ImageFormat,
  quality: number,
): sharp.Sharp {
  const pipeline = sharp(imagePath).composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }]);
  return format === 'png' ? pipeline.png() : pipeline.jpeg({ quality });
}

export interface RenderAnnotatedOptions {
  report: Reading;
  imagePath: string; // absolute path to the source image
  outPath: string; // absolute output path (.jpg/.jpeg or .png)
  quality?: number; // JPEG quality, default 92
}

/** Composite the overlay onto the source image and write annotated output. */
export async function renderAnnotated(opts: RenderAnnotatedOptions): Promise<void> {
  const format: ImageFormat = opts.outPath.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
  await annotatedPipeline(opts.imagePath, buildOverlaySvg(opts.report), format, opts.quality ?? 92).toFile(
    opts.outPath,
  );
}

export interface RenderAnnotatedBufferOptions {
  report: Reading;
  imagePath: string;
  format?: ImageFormat; // default jpeg
  quality?: number;
}

/** Same as renderAnnotated but returns the encoded image bytes instead of writing. */
export async function renderAnnotatedBuffer(opts: RenderAnnotatedBufferOptions): Promise<Buffer> {
  return annotatedPipeline(
    opts.imagePath,
    buildOverlaySvg(opts.report),
    opts.format ?? 'jpeg',
    opts.quality ?? 92,
  ).toBuffer();
}
