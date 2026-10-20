import { describe, expect, it } from 'vitest';
import { badgeAnchor, maxBadgeDrift } from './badge.js';

/** Distance from a point to the nearest point of a polyline. */
function distToPath(p: [number, number], pts: [number, number][]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t)));
  }
  return best;
}

describe('badgeAnchor', () => {
  it('keeps a circle on its rim, up and to the right', () => {
    const [x, y] = badgeAnchor({ circle: { cx: 100, cy: 100, r: 50 }, shape: 'circle' }, 10);
    expect(x).toBeCloseTo(100 + 60 * 0.7071, 3);
    expect(y).toBeCloseTo(100 - 60 * 0.7071, 3);
  });

  // The failure this replaces: a long line's badge was placed from the
  // bounding-box centre, which for a bent line is nowhere near the line.
  it('puts a polyline badge beside the line, not out in the field', () => {
    const line: [number, number][] = [
      [410, 292],
      [345, 345],
      [430, 520],
      [510, 580],
    ];
    const bubbleR = 24;
    const at = badgeAnchor({ circle: { cx: 427, cy: 436, r: 160 }, shape: 'polyline', polygon: line }, bubbleR);
    // Within a badge or two of the stroke it belongs to.
    expect(distToPath(at, line)).toBeLessThan(bubbleR * 2);
  });

  it('puts a polygon badge on the outline, clear of the inside', () => {
    const poly: [number, number][] = [
      [100, 100],
      [200, 100],
      [200, 200],
      [100, 200],
    ];
    const bubbleR = 12;
    const [x, y] = badgeAnchor({ circle: { cx: 150, cy: 150, r: 70 }, shape: 'polygon', polygon: poly }, bubbleR);
    // The top-right corner is the one nearest up-and-right, and the badge sits
    // just outside it rather than within the shape.
    expect(x).toBeGreaterThan(200);
    expect(y).toBeLessThan(100);
    expect(Math.hypot(x - 200, y - 100)).toBeLessThan(bubbleR * 2);
  });

  it('falls back to the rim when a shape has no usable vertices', () => {
    const bare = badgeAnchor({ circle: { cx: 10, cy: 10, r: 4 }, shape: 'polygon', polygon: [] }, 3);
    const ring = badgeAnchor({ circle: { cx: 10, cy: 10, r: 4 }, shape: 'circle' }, 3);
    expect(bare).toEqual(ring);
  });

  it('caps drift relative to the badge size', () => {
    expect(maxBadgeDrift(10)).toBeGreaterThan(10);
    expect(maxBadgeDrift(20)).toBe(maxBadgeDrift(10) * 2);
  });
});
