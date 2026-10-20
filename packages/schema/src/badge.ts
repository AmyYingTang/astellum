/**
 * Where a feature's number sits.
 *
 * Every renderer recomputes this and adds the feature's stored offset, and the
 * reader's spread solves overlaps in the same space — so the rule has to live
 * in exactly one place. Change it here and all of them move together; change it
 * in one renderer and that renderer applies offsets measured against a
 * different origin, which puts the numbers somewhere nobody chose.
 *
 * The rule itself: hug the thing being labelled. A number floating in empty sky
 * is a number the viewer has to match up by guesswork, and on a wide frame the
 * guess is wrong as often as not. So a line gets its number on the line, an
 * outline gets it on the outline, and only a circle — where the ring itself
 * already says "this much of the sky" — gets the classic rim position.
 */

export interface BadgeAnchorFeature {
  shape?: string;
  circle: { cx: number; cy: number; r: number };
  /** Vertices in image px, for polygon/polyline features. */
  polygon?: [number, number][] | null;
}

/** Up-and-right on a rim, the same diagonal the tool has always used. */
const RIM = 0.7071;

function centroid(pts: [number, number][]): [number, number] {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

/** The point half way along a polyline, by length — not the middle vertex,
 *  which on an unevenly sampled line can sit near one end. */
function midOfPath(pts: [number, number][]): { at: [number, number]; tangent: [number, number] } {
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    segs.push(d);
    total += d;
  }
  let walked = 0;
  for (let i = 0; i < segs.length; i++) {
    const d = segs[i]!;
    if (walked + d >= total / 2 && d > 0) {
      const t = (total / 2 - walked) / d;
      const a = pts[i]!;
      const b = pts[i + 1]!;
      return {
        at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        tangent: [(b[0] - a[0]) / d, (b[1] - a[1]) / d],
      };
    }
    walked += d;
  }
  const a = pts[0]!;
  return { at: a, tangent: [1, 0] };
}

/**
 * The badge's origin for one feature, before its stored offset is added.
 * `bubbleR` is the badge's radius — the standoff scales with it so a big badge
 * clears the stroke it is sitting next to.
 */
export function badgeAnchor(f: BadgeAnchorFeature, bubbleR: number): [number, number] {
  const poly = f.polygon ?? undefined;

  // A line: sit beside its middle, off to one side rather than on top of it.
  if (f.shape === 'polyline' && poly && poly.length >= 2) {
    const { at, tangent } = midOfPath(poly);
    // Either perpendicular would do; take the one that goes up, so the number
    // reads as a callout above the line instead of hanging under it.
    const n: [number, number] = tangent[1] > 0 ? [tangent[1], -tangent[0]] : [-tangent[1], tangent[0]];
    const d = bubbleR * 1.3;
    return [at[0] + n[0] * d, at[1] + n[1] * d];
  }

  // An outline: on its edge, at the corner nearest up-and-right, pushed just
  // clear of the stroke so the number never sits inside the shape it names.
  if (f.shape === 'polygon' && poly && poly.length >= 3) {
    const [gx, gy] = centroid(poly);
    let best = poly[0]!;
    let bestScore = -Infinity;
    for (const p of poly) {
      const score = p[0] - gx - (p[1] - gy); // right is +, up is +
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    const vx = best[0] - gx;
    const vy = best[1] - gy;
    const len = Math.hypot(vx, vy) || 1;
    const d = bubbleR * 1.15;
    return [best[0] + (vx / len) * d, best[1] + (vy / len) * d];
  }

  // A ring, a dot, an arrow: the rim position. For a circle the ring is itself
  // the statement about extent, so its number belongs on that ring.
  return [
    f.circle.cx + (f.circle.r + bubbleR) * RIM,
    f.circle.cy - (f.circle.r + bubbleR) * RIM,
  ];
}

/**
 * How far the overlap spread may drag a badge away from its anchor.
 *
 * Without a cap the spread is free to push a crowded badge clear across the
 * frame — which is exactly how a number ends up in empty sky with nothing
 * under it. Past this distance a little overlap is the lesser problem: two
 * numbers that touch can still each be read against the mark they belong to.
 */
export function maxBadgeDrift(bubbleR: number): number {
  return bubbleR * 2.6;
}
