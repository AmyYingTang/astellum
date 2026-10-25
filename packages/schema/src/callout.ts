import { badgeAnchor } from './badge.js';
import type { Feature, Reading } from './reading.js';

/**
 * Magnified insets for the marks that are too small to read.
 *
 * The kiosk solves this with the pointer: come near a mark and it magnifies
 * under your finger. A poster and an exported frame have no pointer, and a
 * pillar 28 pixels across on a 4000-pixel frame is a scribble — the viewer can
 * see that something is circled and never what.
 *
 * So the still picture carries its own magnifier: a panel in an empty corner
 * showing that patch enlarged, with a line back to where it came from.
 *
 * This module decides *where*, and nothing else. It touches no pixels and
 * emits no markup, because four surfaces have to agree on the answer — the
 * exported frame (compositing crops with sharp), the poster (an <image> in an
 * SVG), the studio canvas (Konva), and the tests. Layout that is computed
 * twice is layout that disagrees.
 */

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * What a feature actually covers on the frame.
 *
 * A polygon's extent is its points; everything else falls back to the circle,
 * which is what the badge anchors on and what the ring is drawn from.
 */
export function featureBounds(f: Feature): Box {
  if (f.polygon?.length && (f.shape === 'polygon' || f.shape === 'polyline')) {
    const xs = f.polygon.map((q) => q[0]);
    const ys = f.polygon.map((q) => q[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  if (f.shape === 'arc' && f.arc) {
    // The whole circle the arc is cut from, which is never smaller than the arc
    // and is one line instead of sampling the sweep.
    const { cx, cy, r } = f.arc;
    return { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r };
  }
  const { cx, cy, r } = f.circle;
  return { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r };
}

const widthOf = (b: Box): number => b.x1 - b.x0;
const heightOf = (b: Box): number => b.y1 - b.y0;
const longerSide = (b: Box): number => Math.max(widthOf(b), heightOf(b));
const centreOf = (b: Box): { x: number; y: number } => ({
  x: (b.x0 + b.x1) / 2,
  y: (b.y0 + b.y1) / 2,
});

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * The shapes whose point is their *shape*.
 *
 * A catalogue object's ring says "the thing is here"; magnified it is a larger
 * ring around the same point, and the picture has paid for an inset that shows
 * nothing new. The human-drawn morphology — a pillar, a bright rim, an
 * ionization front — is a drawn contour, and a contour too small to follow is
 * exactly the failure this fixes.
 */
const MAGNIFIABLE = new Set(['polygon', 'polyline', 'arc']);

/**
 * What a feature actually covers, for the purpose of keeping out of its way.
 *
 * An area — a ring, a pillar's closed contour — is its bounding box. An open
 * line is not: a bright rim wandering across a third of the frame has a huge
 * bounding box and occupies almost none of it, and treating the box as full
 * pushed insets to the far side of the picture to avoid a stroke they would
 * never have touched. So a line reserves a band along itself, segment by
 * segment, which is what it actually covers.
 */
function occupiedBy(f: Feature, shortEdge: number): Box[] {
  // 'field' is the subject the frame is a crop of. Nothing is drawn for it —
  // a ring would claim a boundary the picture does not contain — so there is
  // nothing to keep out of the way of. Reserving its circle instead walled off
  // the middle 40% of the frame and pushed insets to the far edge, giving them
  // connectors that crossed the whole photograph. Its badge still counts; that
  // is added by the caller.
  if (f.shape === 'field') return [];
  if (f.shape !== 'polyline' || !f.polygon || f.polygon.length < 2) return [featureBounds(f)];
  const band = Math.max(4, shortEdge / 120);
  const out: Box[] = [];
  for (let i = 1; i < f.polygon.length; i++) {
    const a = f.polygon[i - 1]!;
    const b = f.polygon[i]!;
    out.push({
      x0: Math.min(a[0], b[0]) - band,
      y0: Math.min(a[1], b[1]) - band,
      x1: Math.max(a[0], b[0]) + band,
      y1: Math.max(a[1], b[1]) + band,
    });
  }
  return out;
}

export interface CalloutOptions {
  /** Hard cap. Each inset costs a piece of the picture. */
  max?: number;
  /** A feature qualifies when its longer side is under this share of the
   *  frame's short edge. */
  maxShare?: number;
  /** The inset's size, as a share of the short edge. */
  insetShare?: number;
  /** Below this there is nothing to gain; above it, the source has no more
   *  detail to give and the inset is just a blurrier version of the same
   *  patch. */
  minScale?: number;
  maxScale?: number;
  /** Keep insets this far (share of the short edge) from the frame edge. */
  marginShare?: number;
}

const DEFAULTS = {
  max: 3,
  maxShare: 0.12,
  insetShare: 0.22,
  minScale: 2,
  maxScale: 8,
  marginShare: 0.02,
} as const;

/**
 * Whether a mark is one an inset could be for: a drawn contour too small to
 * read. Says nothing about whether one is planned — the curator may have
 * refused it, three may already be taken, the frame may have no free space —
 * only whether asking the question makes sense. The studio uses it to decide
 * which marks get the switch at all.
 */
export function canMagnify(
  f: Feature,
  image: { width: number; height: number },
  maxShare: number = DEFAULTS.maxShare,
): boolean {
  const short = Math.min(image.width, image.height);
  return MAGNIFIABLE.has(f.shape) && longerSide(featureBounds(f)) < maxShare * short;
}

export interface Callout {
  /** The feature this magnifies. */
  id: string;
  /** Its badge number, so the inset and the mark can be tied together. */
  num: string;
  /** The patch of the source image to enlarge, in image pixels. */
  crop: { x: number; y: number; w: number; h: number };
  /** Where the enlarged patch is drawn, in image pixels. */
  inset: { x: number; y: number; w: number; h: number };
  /** How much bigger the patch is drawn than it is. */
  scale: number;
  /** The point on the original mark the connector points at. */
  anchor: { x: number; y: number };
}

/**
 * Which marks get an inset, and where it goes.
 *
 * Returns an empty list when nothing qualifies, which is the common case and
 * the one to keep cheap: most frames have nothing too small on them.
 */
export function planCallouts(report: Reading, opts: CalloutOptions = {}): Callout[] {
  const o = { ...DEFAULTS, ...opts };
  const { width, height } = report.image;
  const short = Math.min(width, height);
  if (!short || o.max <= 0) return [];

  const drawn = report.features.filter((f) => f.draw !== false);

  // Everything already on the picture, so an inset can be put where nothing is.
  // The marks, and the badges with a generous allowance for the name beside
  // them: how wide a string renders is the renderer's business and differs per
  // font, so this reserves a block rather than pretending to measure one.
  const occupied: Box[] = [];
  for (const f of drawn) {
    occupied.push(...occupiedBy(f, short));
    const br = f.badge.bubble_r;
    const [ax, ay] = badgeAnchor(f, br);
    const bx = ax + f.badge.offset_x;
    const by = ay + f.badge.offset_y;
    const nameW = br * 12;
    occupied.push({
      x0: bx - (bx > width * 0.66 ? nameW : br * 2),
      y0: by - br * 2,
      x1: bx + (bx > width * 0.66 ? br * 2 : nameW),
      y1: by + br * 2,
    });
  }

  const candidates = drawn
    .filter((f) => !f.callout?.off && canMagnify(f, report.image, o.maxShare))
    .map((f) => ({ f, bounds: featureBounds(f) }))
    // A panel somebody placed by hand keeps its place in the queue: it exists
    // because they wanted it, so it is not the one to drop when the cap bites.
    .sort(
      (a, b) =>
        Number(!a.f.callout) - Number(!b.f.callout) ||
        longerSide(a.bounds) - longerSide(b.bounds),
    );

  const insetSize = Math.round(o.insetShare * short);
  const margin = Math.round(o.marginShare * short);
  const out: Callout[] = [];

  for (const { f, bounds } of candidates) {
    if (out.length >= o.max) break;

    // The patch, with room around it: a contour cropped to its own edges reads
    // as a cut-out, and what makes a pillar legible is the gas it stands in.
    const want = longerSide(bounds) * 1.8;
    const scale = Math.min(o.maxScale, Math.max(o.minScale, insetSize / Math.max(want, 1)));
    const cropSize = Math.min(Math.round(insetSize / scale), short);
    const c = centreOf(bounds);
    const crop = {
      x: Math.round(Math.max(0, Math.min(width - cropSize, c.x - cropSize / 2))),
      y: Math.round(Math.max(0, Math.min(height - cropSize, c.y - cropSize / 2))),
      w: cropSize,
      h: cropSize,
    };

    // A neighbour already showing inside somebody's crop is already magnified.
    // Three pillars in a row should cost one inset, not three — and the test is
    // whether the shape overlaps that crop at all, not whether its centre
    // happens to fall in it: two pillars eight pixels apart are one subject.
    const alreadyShown = out.some(
      (p) => overlap(bounds, { x0: p.crop.x, y0: p.crop.y, x1: p.crop.x + p.crop.w, y1: p.crop.y + p.crop.h }) > 0,
    );
    if (alreadyShown) continue;

    // Where somebody dragged it wins over anywhere this would choose, and is
    // only held inside the frame — a panel half off the picture is a mistake
    // the automatic placement cannot make but a drag can.
    const pinned = f.callout?.x !== undefined && f.callout.y !== undefined;
    const inset = pinned
      ? {
          x: Math.round(Math.max(0, Math.min(width - insetSize, f.callout!.x!))),
          y: Math.round(Math.max(0, Math.min(height - insetSize, f.callout!.y!))),
          w: insetSize,
          h: insetSize,
        }
      : placeInset(insetSize, c, { width, height, margin }, occupied);
    if (!inset) continue; // nowhere free — better no inset than one over a mark

    out.push({
      id: f.id,
      num: f.badge.num,
      crop,
      inset,
      scale: Math.round((insetSize / cropSize) * 100) / 100,
      anchor: { x: Math.round(c.x), y: Math.round(c.y) },
    });
    // The inset itself is now in the way of the next one.
    occupied.push({ x0: inset.x, y0: inset.y, x1: inset.x + inset.w, y1: inset.y + inset.h });
  }

  return out;
}

/**
 * Somewhere the inset covers nothing, as near the frame's edge as that allows.
 *
 * Walks a coarse grid, keeps only the positions that cover nothing, and among
 * those prefers the one closest to an edge, then the one closest to the mark.
 *
 * Out at the edge for the same reason a caption is: the middle of an
 * astrophoto is the photograph, and a panel there covers the subject even when
 * no *mark* happens to be under it. "Unless there is something at the edge" is
 * not a special case — an edge with a mark on it is already occupied, so the
 * search passes over it on its own.
 *
 * Returns null when every position covers something: a frame can be full, and
 * an inset over another mark trades one unreadable feature for two.
 */
function placeInset(
  size: number,
  from: { x: number; y: number },
  frame: { width: number; height: number; margin: number },
  occupied: Box[],
): { x: number; y: number; w: number; h: number } | null {
  const { width, height, margin } = frame;
  if (size + 2 * margin > width || size + 2 * margin > height) return null;
  const step = Math.max(8, Math.round(size / 4));
  // The far margins are included explicitly, not left to wherever the step
  // happens to land: a grid walked from the near edge stops short of the far
  // one, which made the bottom and right of every frame score as "inland" and
  // sent panels to the two edges the walk did reach.
  const ticks = (limit: number): number[] => {
    const out: number[] = [];
    for (let v = margin; v < limit; v += step) out.push(v);
    out.push(limit);
    return out;
  };
  const xs = ticks(width - size - margin);
  const ys = ticks(height - size - margin);
  // How close to an edge counts as "at the edge". Without this the comparison
  // is exact, and a position two pixels further in loses to one that is worse
  // in every other way.
  const band = Math.max(1, size / 3);
  let best: { x: number; y: number; edge: number; dist: number } | null = null;

  for (const y of ys) {
    for (const x of xs) {
      const box: Box = { x0: x, y0: y, x1: x + size, y1: y + size };
      let cost = 0;
      for (const b of occupied) cost += overlap(box, b);
      if (cost > 0) continue;
      const cx = x + size / 2;
      const cy = y + size / 2;
      const dist = Math.hypot(cx - from.x, cy - from.y);
      // Never on top of the thing it magnifies, however empty the rest is.
      if (dist < size * 0.75) continue;
      const edge = Math.floor(
        Math.min(x - margin, y - margin, width - margin - (x + size), height - margin - (y + size)) /
          band,
      );
      if (!best || edge < best.edge || (edge === best.edge && dist < best.dist)) {
        best = { x, y, edge, dist };
      }
    }
  }
  if (!best) return null;
  return { x: best.x, y: best.y, w: size, h: size };
}

/**
 * Where a line aimed at the inset's centre crosses its edge.
 *
 * The connector starts here, not at the centre: drawn from the centre it runs
 * across the enlarged patch, over the one thing the inset exists to show.
 *
 * Parametric along the segment and clipped to the box's two slabs, so whichever
 * of the four sides the line actually meets falls out of the smaller ratio,
 * with no corner cases to enumerate.
 */
export function insetEdgePoint(
  inset: { x: number; y: number; w: number; h: number },
  from: { x: number; y: number },
): { x: number; y: number } {
  const cx = inset.x + inset.w / 2;
  const cy = inset.y + inset.h / 2;
  const dx = from.x - cx;
  const dy = from.y - cy;
  if (!dx && !dy) return { x: Math.round(cx), y: Math.round(cy) };
  const t = Math.min(
    dx ? inset.w / 2 / Math.abs(dx) : Infinity,
    dy ? inset.h / 2 / Math.abs(dy) : Infinity,
  );
  return { x: Math.round(cx + dx * t), y: Math.round(cy + dy * t) };
}

/**
 * How a magnified region is raised above the picture.
 *
 * A panel is a frame and the piece inside it — nothing else. The picture goes
 * on showing through, so a magnified mark costs the viewer only the outline of
 * a box and the footprint of the piece itself, instead of a square of
 * photograph painted over.
 *
 * Two cues make the piece read as lifted rather than pasted: a shadow onto the
 * picture below, and the piece drawn a little larger, because a thing held
 * nearer the eye is bigger. The shadow alone was tried first and is nearly
 * invisible; the size change is what carries it.
 *
 * Shares of the inset's own size, so a panel on a 1200px frame and one on a
 * 4000px frame are lifted by the same amount to look at.
 */
export const LIFT = {
  /** How much bigger the raised piece is drawn. */
  scale: 1.1,
  /** Shadow offset, down and to the right. */
  offsetShare: 0.03,
  blurShare: 0.035,
  shadowOpacity: 0.9,
} as const;

/**
 * Scale a point about the feature's own centre, the way the raised piece is.
 *
 * Shared because three surfaces draw this piece — an SVG transform, a sharp
 * crop, a canvas path — and a piece drawn from three slightly different
 * centres is three pieces that do not line up with their own shadow.
 */
export function raisedPoint(f: Feature, x: number, y: number): [number, number] {
  const b = featureBounds(f);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  return [cx + (x - cx) * LIFT.scale, cy + (y - cy) * LIFT.scale];
}

/**
 * The source window that fills an inset when its piece is drawn raised.
 *
 * Smaller than the ordinary crop by exactly the lift, and centred so the two
 * agree where the feature is: that is what makes the raised piece sit over the
 * hole it came from rather than beside it.
 */
export function raisedCrop(c: Callout, f: Feature): { x: number; y: number; w: number; h: number } {
  const b = featureBounds(f);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const k = LIFT.scale;
  return {
    x: cx + (c.crop.x - cx) / k,
    y: cy + (c.crop.y - cy) / k,
    w: c.crop.w / k,
    h: c.crop.h / k,
  };
}
