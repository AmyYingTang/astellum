import sharp from 'sharp';
import {
  COLOR_PALETTE,
  badgeAnchor,
  LIFT,
  featureBounds,
  insetEdgePoint,
  planCallouts,
  raisedCrop,
  raisedPoint,
  type Callout,
  type Feature,
  type Reading,
} from '@astellum/schema';
import { CENTRE_BASELINE, overlayLabel } from './overlayLabel.js';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A feature's own geometry, without its badge or name.
 *
 * Pulled out of the loop because a magnified inset draws the same contour a
 * second time, at a different size, and two copies of this would be two
 * drawings of one shape that drift apart.
 */
/** A dotted line: zero-length dashes with round caps, one dot per `period`
 *  stroke widths. The studio canvas draws the same. */
const DOT = { on: 0.01, period: 2.2 } as const;

function featureShape(f: Feature, strokeW: number): string[] {
  const color = COLOR_PALETTE[f.color_key];
  const { cx, cy, r } = f.circle;
  const parts: string[] = [];
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
    // Class-B morphology suggestion (e.g. a pillar): a soft dotted outline,
    // never a hard box — as fine as the rim line beside it, so the two read as
    // one family. An optional arrow shows the 迎光 / illumination direction.
    const pts = f.polygon.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const w = Math.max(1, Math.round(strokeW * 0.8));
    parts.push(
      `<polygon points="${pts}" fill="none" stroke="${color.stroke}" stroke-width="${w}" ` +
        `stroke-dasharray="${DOT.on} ${(w * DOT.period).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`,
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
    // A-class solid ring, or a Class-B shell sample (small dotted circle, as
    // fine as the polygon outline: one style for "suggested, not catalogued").
    // 'field' is the subject the frame is a crop of: a ring around it would
    // claim a boundary this picture does not contain, so it gets none.
    const fine = Math.max(1, Math.round(strokeW * 0.8));
    const ring =
      f.shape === 'shell'
        ? `stroke-width="${fine}" stroke-dasharray="${DOT.on} ${(fine * DOT.period).toFixed(1)}" stroke-linecap="round"`
        : `stroke-width="${strokeW}"`;
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color.stroke}" ${ring}/>`,
    );
  }
  return parts;
}

/** The transform that raises a feature: scaled about its own centre. */
function raisedTransform(f: Feature): string {
  const b = featureBounds(f);
  const cx = ((b.x0 + b.x1) / 2).toFixed(2);
  const cy = ((b.y0 + b.y1) / 2).toFixed(2);
  return `translate(${cx} ${cy}) scale(${LIFT.scale}) translate(-${cx} -${cy})`;
}

/**
 * The region to leave at full brightness inside an inset, as mask black.
 *
 * A closed contour is the area it encloses. An open one — a rim, an arc —
 * encloses nothing, so it gets a band along the line instead: the same choice
 * the kiosk's magnifier makes, and for the same reason. Black in a mask hides
 * what covers it, which is how the region keeps the picture.
 */
function shapeHole(
  f: Feature,
  shortEdge: number,
  /** Optional mapping into another coordinate space, for a standalone mask. */
  at: (x: number, y: number) => [number, number] = (x, y) => [x, y],
  colour = '#000',
): string {
  const band = Math.max(6, Math.round(shortEdge / 100));
  const pt = (x: number, y: number): string => at(x, y).map((v) => v.toFixed(1)).join(',');
  if (f.polygon?.length && (f.shape === 'polygon' || f.shape === 'polyline')) {
    const points = f.polygon.map(([x, y]) => pt(x, y)).join(' ');
    return f.shape === 'polygon'
      ? `<polygon points="${points}" fill="${colour}"/>`
      : `<polyline points="${points}" fill="none" stroke="${colour}" ` +
          `stroke-width="${band * 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  if (f.shape === 'arc' && f.arc) {
    const { cx, cy, r, a0, a1 } = f.arc;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    // The radius is mapped through two points on the arc rather than scaled by
    // hand, so one mapping serves both the overlay and a standalone mask.
    const [sx, sy] = at(cx + r * Math.cos(a0), cy + r * Math.sin(a0));
    const [ex, ey] = at(cx + r * Math.cos(a1), cy + r * Math.sin(a1));
    const [mx, my] = at(cx, cy);
    const rr = Math.hypot(sx - mx, sy - my);
    return (
      `<path d="M ${sx.toFixed(1)} ${sy.toFixed(1)} A ${rr.toFixed(1)} ${rr.toFixed(1)} 0 ${large} 1 ` +
      `${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="${colour}" ` +
      `stroke-width="${band * 2}" stroke-linecap="round"/>`
    );
  }
  const { cx, cy, r } = f.circle;
  const [ccx, ccy] = at(cx, cy);
  const [rx, ry] = at(cx + r, cy);
  return `<circle cx="${ccx.toFixed(1)}" cy="${ccy.toFixed(1)}" r="${Math.hypot(rx - ccx, ry - ccy).toFixed(1)}" fill="${colour}"/>`;
}

/**
 * One magnified inset: the patch enlarged, framed, and tied back to its mark.
 *
 * `imageHref` is how the enlarged pixels get in, and only one of the two hosts
 * can supply it. In a browser — the poster — the picture is already a data
 * URI, so the inset is an <image> scaled inside a clip. For the exported frame
 * the pixels are composited underneath by sharp, which crops and resizes far
 * more cheaply than librsvg re-decoding the whole photograph from base64; there
 * this draws the frame, the line and the contour, over pixels already in place.
 */
function calloutMarkup(
  c: Callout,
  f: Feature,
  strokeW: number,
  imageHref: string | undefined,
  frameW: number,
  frameH: number,
): string {
  const color = COLOR_PALETTE[f.color_key];
  const clipId = `k-cal-${c.id}`;
  const { x, y, w, h } = c.inset;
  const parts: string[] = [];

  parts.push(
    `<clipPath id="${escapeXml(clipId)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.round(strokeW * 2)}"/></clipPath>`,
  );

  // The line runs from the frame's edge, not its centre: aimed at the centre
  // but cut where it leaves the box. Drawn from the centre it crossed the
  // enlarged patch — a dashed line over the one thing the inset exists to show.
  const e = insetEdgePoint(c.inset, c.anchor);
  parts.push(
    `<line x1="${c.anchor.x}" y1="${c.anchor.y}" x2="${e.x}" y2="${e.y}" ` +
      `stroke="${color.stroke}" stroke-width="${Math.max(1, Math.round(strokeW * 0.7))}" ` +
      `stroke-dasharray="${strokeW * 3} ${strokeW * 2}" opacity="0.75"/>`,
  );

  // Everything inside the frame, in source coordinates: place the inset, scale
  // up, then bring the crop's own origin to zero.
  const tf = `translate(${x} ${y}) scale(${c.scale}) translate(${-c.crop.x} ${-c.crop.y})`;
  parts.push(`<g clip-path="url(#${escapeXml(clipId)})">`);
  // Hold the surround back, the way the kiosk's magnifier does: a wash over
  // everything in the panel except the region being named. Not blacked out —
  // this is a crop of a photograph, and the region has to sit in the sky
  // around it for naming it to mean anything.
  //
  // Nothing fills the panel. The picture goes on showing through it, so a
  // magnified mark costs the viewer the outline of a box and the footprint of
  // the piece, and not a square of photograph painted over. What makes the
  // piece read as lifted rather than pasted is the pair of cues in `LIFT`: a
  // shadow onto the picture below, and the piece drawn a little larger.
  //
  // `LIFT` is in the schema because the exported frame composites this piece
  // with sharp and the studio canvas draws it again, and three pieces scaled
  // about three slightly different centres are three pieces that miss their
  // own shadows.
  //
  // The shadow wears a mask that excludes the *raised* shape, so it cannot
  // reach the piece however the host orders its layers — which is what lets
  // the exported frame put the piece in as a raster layer under this whole
  // overlay.
  const near = raisedTransform(f);
  const maskId = `${clipId}-m`;
  const raisedHole = `<g transform="${tf}"><g transform="${near}">${shapeHole(f, Math.min(frameW, frameH))}</g></g>`;
  parts.push(
    `<mask id="${escapeXml(maskId)}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}">` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff"/>` +
      raisedHole +
      `</mask>`,
  );

  const lift = Math.max(3, Math.min(w, h) * LIFT.offsetShare);
  const blur = Math.max(2, Math.min(w, h) * LIFT.blurShare);
  const shadowId = `${clipId}-s`;
  parts.push(
    `<filter id="${escapeXml(shadowId)}" x="-40%" y="-40%" width="180%" height="180%">` +
      `<feGaussianBlur stdDeviation="${(blur / c.scale).toFixed(2)}"/></filter>`,
    `<g mask="url(#${escapeXml(maskId)})" opacity="${LIFT.shadowOpacity}">` +
      `<g transform="translate(${(lift / c.scale).toFixed(2)} ${(lift / c.scale).toFixed(2)})" filter="url(#${escapeXml(shadowId)})">` +
      raisedHole +
      `</g></g>`,
  );

  // The piece itself, where the picture can reach the SVG. Where it cannot —
  // the exported frame — sharp has already laid it down underneath, cut to the
  // same shape by the same arithmetic.
  if (imageHref) {
    const pieceId = `${clipId}-p`;
    parts.push(
      `<mask id="${escapeXml(pieceId)}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}">` +
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000"/>` +
        // White, passed in rather than inherited: `shapeHole` writes its own
        // fill, so a colour set on the group above it is overridden and the
        // mask ends up black on black — leaving only the hairline the stroke
        // inherits, which is exactly what the panel showed.
        `<g transform="${tf}"><g transform="${near}">${shapeHole(f, Math.min(frameW, frameH), undefined, '#fff')}</g></g>` +
        `</mask>`,
      `<g mask="url(#${escapeXml(pieceId)})"><g transform="${tf}"><g transform="${near}">` +
        `<image href="${imageHref}" x="0" y="0" width="${frameW}" height="${frameH}" preserveAspectRatio="none"/>` +
        `</g></g></g>`,
    );
  }

  // No contour around the piece. Its own edge against the picture already
  // says where it ends, and a second line on that same boundary competes with
  // it — which leaves the eye less sure what is being named, not more.
  parts.push(`</g>`);

  // The frame, and the number in its corner so the inset and the mark are
  // obviously the same thing.
  parts.push(
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.round(strokeW * 2)}" fill="none" ` +
      `stroke="${color.stroke}" stroke-width="${Math.max(1, Math.round(strokeW * 0.5))}"/>`,
  );
  const br = Math.round(Math.min(w, h) * 0.09);
  const bx = x + br * 1.4;
  const by = y + br * 1.4;
  parts.push(
    `<circle cx="${bx}" cy="${by}" r="${br}" fill="${color.badge}" stroke="#0b0e14" stroke-width="${Math.max(1, Math.round(strokeW / 2))}"/>`,
    `<text x="${bx}" y="${Math.round(by + br * 1.1 * CENTRE_BASELINE)}" font-family="sans-serif" font-size="${Math.round(br * 1.1)}" font-weight="700" fill="#0b0e14" text-anchor="middle">${escapeXml(c.num)}</text>`,
  );
  return parts.join('');
}

export interface OverlaySvgOptions {
  /**
   * The insets to draw. Computed here when omitted — but the exported frame
   * composites the enlarged pixels itself and has to crop exactly where this
   * draws, so that path plans once and passes the answer in.
   */
  callouts?: Callout[];
  /** The picture, as something an <image> can reference. See `calloutMarkup`. */
  imageHref?: string;
}

/** Build the SVG overlay (circles + numbered badges + magnified insets). */
export function buildOverlaySvg(report: Reading, opts: OverlaySvgOptions = {}): string {
  const { width, height } = report.image;
  const lang = report.display_language;
  const strokeW = Math.max(2, Math.round(Math.min(width, height) / 300));
  const parts: string[] = [];
  const callouts = opts.callouts ?? planCallouts(report);

  for (const f of report.features) {
    if (f.draw === false) continue; // listed in the Facts panel but not drawn
    const color = COLOR_PALETTE[f.color_key];
    parts.push(...featureShape(f, strokeW));

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
      `<text x="${bx}" y="${Math.round(by + fontSize * CENTRE_BASELINE)}" font-family="sans-serif" font-size="${fontSize}" font-weight="700" fill="#0b0e14" text-anchor="middle">${escapeXml(f.badge.num)}</text>`,
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

  // Insets last: they are panels laid on the picture, and a mark drawn over
  // one would read as part of what it shows.
  for (const c of callouts) {
    const f = report.features.find((x) => x.id === c.id);
    if (f) parts.push(calloutMarkup(c, f, strokeW, opts.imageHref, width, height));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
}

type ImageFormat = 'jpeg' | 'png';

/**
 * The enlarged patches, as image buffers ready to composite.
 *
 * sharp crops and resizes natively. The alternative — base64 the whole
 * photograph into the SVG and let librsvg scale it three times — decodes a
 * multi-megapixel JPEG inside an XML parser, which is as slow as it sounds.
 */
async function calloutLayers(
  report: Reading,
  imagePath: string,
  callouts: Callout[],
): Promise<sharp.OverlayOptions[]> {
  const layers: sharp.OverlayOptions[] = [];
  for (const c of callouts) {
    const f = report.features.find((x) => x.id === c.id);
    try {
      if (f) layers.push(await raisedLayer(imagePath, c, f));
    } catch {
      // A crop that will not extract — a stale geometry against a resized
      // image, say — loses its piece, not the whole export. The frame and the
      // line are still drawn over a picture that was going to show through
      // anyway, so what is left is an empty box: obvious, and better than a
      // curator with no export at all.
    }
  }
  return layers;
}

/**
 * The alpha stencil that cuts the raised piece out of its rectangle.
 *
 * Transparent everywhere but the shape. `dest-in` keeps the destination where
 * the *mask's alpha* is, so a black background is not "keep nothing" — it is
 * opaque, and keeps everything. Getting that wrong leaves a square of
 * magnified picture on the frame — which is what a panel used to look like,
 * and why the mistake went unseen until the panel became see-through.
 */
export function pieceMask(c: Callout, f: Feature): string {
  const toInset = (x: number, y: number): [number, number] => {
    const [rx, ry] = raisedPoint(f, x, y);
    return [(rx - c.crop.x) * c.scale, (ry - c.crop.y) * c.scale];
  };
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${c.inset.w}" height="${c.inset.h}">` +
    shapeHole(f, Math.min(c.inset.w, c.inset.h) * 2, toInset, '#fff') +
    `</svg>`
  );
}

/**
 * The raised piece, as pixels cut to its own shape.
 *
 * The overlay cannot draw this one: it has no picture to draw it from, and
 * handing it the whole photograph as base64 so librsvg can decode it again per
 * panel costs twice the render time and a nine-megabyte SVG — measured, on a
 * 4144×2822 frame.
 *
 * So sharp cuts it instead: a smaller window of the source — smaller by
 * exactly the lift — blown up to the panel, then masked to the raised outline
 * with `dest-in`. It goes *under* the overlay, which is safe because the wash
 * and the shadow both wear a mask that excludes this shape.
 */
async function raisedLayer(
  imagePath: string,
  c: Callout,
  f: Feature,
): Promise<sharp.OverlayOptions> {
  const r = raisedCrop(c, f);
  const win = {
    left: Math.max(0, Math.round(r.x)),
    top: Math.max(0, Math.round(r.y)),
    width: Math.max(1, Math.round(r.w)),
    height: Math.max(1, Math.round(r.h)),
  };
  const piece = await sharp(imagePath)
    .extract(win)
    .resize(c.inset.w, c.inset.h, { fit: 'fill' })
    .composite([{ input: Buffer.from(pieceMask(c, f)), blend: 'dest-in' }])
    .png()
    .toBuffer();
  return { input: piece, left: c.inset.x, top: c.inset.y };
}

async function annotatedPipeline(
  report: Reading,
  imagePath: string,
  format: ImageFormat,
  quality: number,
): Promise<sharp.Sharp> {
  // Planned once and passed to both halves: the pixels are composited at these
  // rectangles and the frames are drawn at them, so two plans would be a frame
  // around the wrong patch.
  const callouts = planCallouts(report);
  const svgOverlay = buildOverlaySvg(report, { callouts });
  const pipeline = sharp(imagePath).composite([
    ...(await calloutLayers(report, imagePath, callouts)),
    { input: Buffer.from(svgOverlay), top: 0, left: 0 },
  ]);
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
  const pipeline = await annotatedPipeline(opts.report, opts.imagePath, format, opts.quality ?? 92);
  await pipeline.toFile(opts.outPath);
}

export interface RenderAnnotatedBufferOptions {
  report: Reading;
  imagePath: string;
  format?: ImageFormat; // default jpeg
  quality?: number;
}

/** Same as renderAnnotated but returns the encoded image bytes instead of writing. */
export async function renderAnnotatedBuffer(opts: RenderAnnotatedBufferOptions): Promise<Buffer> {
  const pipeline = await annotatedPipeline(
    opts.report,
    opts.imagePath,
    opts.format ?? 'jpeg',
    opts.quality ?? 92,
  );
  return pipeline.toBuffer();
}
