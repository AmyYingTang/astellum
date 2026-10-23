import { describe, expect, it } from 'vitest';
import { Reading } from './reading.js';
import { featureBounds, insetEdgePoint, planCallouts, type Box } from './callout.js';

/**
 * A frame with whatever marks a test needs on it.
 *
 * Parsed through the schema rather than cast, so a test cannot quietly depend
 * on a shape the real thing would reject.
 */
function frame(features: unknown[], width = 4000, height = 3000): Reading {
  return Reading.parse({
    version: '2.0',
    created_at: '2026-10-23T00:00:00.000Z',
    generator: { tool: 'astellum', tool_version: '0', llm: 'none' },
    display_language: 'zh',
    object: {
      name: { zh: '测试', en: 'Test' },
      type: { zh: '星云', en: 'Nebula' },
    },
    narrative: { zh: '', en: '' },
    image: { src: 'image.jpg', width, height },
    features: features.map((f, i) => ({
      id: `f${i}`,
      label: { zh: `标注${i}`, en: `Feature ${i}` },
      explanation: { zh: '', en: '' },
      color_key: 'pillar',
      badge: { num: String(i + 1), bubble_r: 30, offset_x: 0, offset_y: 0 },
      ...(f as object),
    })),
  });
}

/** A small drawn contour at (x, y), `size` across. */
const pillar = (x: number, y: number, size: number): unknown => ({
  shape: 'polygon',
  circle: { cx: x, cy: y, r: size / 2 },
  polygon: [
    [x - size / 2, y - size / 2],
    [x + size / 2, y - size / 2],
    [x + size / 2, y + size / 2],
  ],
});

const ring = (x: number, y: number, r: number): unknown => ({
  shape: 'circle',
  circle: { cx: x, cy: y, r },
});

const overlaps = (a: Box, b: Box): boolean =>
  Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);

const insetBox = (c: { inset: { x: number; y: number; w: number; h: number } }): Box => ({
  x0: c.inset.x,
  y0: c.inset.y,
  x1: c.inset.x + c.inset.w,
  y1: c.inset.y + c.inset.h,
});

describe('featureBounds', () => {
  it('measures a contour by its points, not by the circle it carries', () => {
    const r = frame([pillar(1000, 1000, 100)]);
    const b = featureBounds(r.features[0]!);
    expect(b).toEqual({ x0: 950, y0: 950, x1: 1050, y1: 1050 });
  });

  it('measures an arc by the circle it is cut from — never smaller than the arc', () => {
    const r = frame([
      { shape: 'arc', circle: { cx: 500, cy: 500, r: 10 }, arc: { cx: 500, cy: 500, r: 200, a0: 0, a1: 1 } },
    ]);
    expect(featureBounds(r.features[0]!)).toEqual({ x0: 300, y0: 300, x1: 700, y1: 700 });
  });
});

describe('which marks get an inset', () => {
  it('leaves a frame alone when nothing on it is too small', () => {
    expect(planCallouts(frame([ring(2000, 1500, 800), pillar(1200, 900, 900)]))).toEqual([]);
  });

  /*
   * A catalogue ring magnified is a bigger ring around the same point — the
   * picture has given up a panel and shown nothing new. What goes small and
   * illegible is a drawn contour, which is the whole of what it is.
   */
  it('passes over a small ring and takes the small contour', () => {
    const out = planCallouts(frame([ring(2000, 1500, 40), pillar(1200, 900, 80)]));
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('f1');
  });

  it('never draws more than it was allowed', () => {
    const many = [0, 1, 2, 3, 4, 5].map((i) => pillar(400 + i * 600, 400 + i * 350, 60));
    expect(planCallouts(frame(many)).length).toBeLessThanOrEqual(3);
    expect(planCallouts(frame(many), { max: 1 })).toHaveLength(1);
    expect(planCallouts(frame(many), { max: 0 })).toEqual([]);
  });

  /*
   * Three pillars in a row are one subject and one inset: the first crop
   * already shows the others, and three panels of the same patch would be
   * three pieces of the picture spent on one thing.
   */
  it('counts neighbours already inside a crop as shown', () => {
    const out = planCallouts(frame([pillar(2000, 1500, 60), pillar(2040, 1500, 60), pillar(2080, 1500, 60)]));
    expect(out).toHaveLength(1);
  });

  it('takes the smallest first — they are the ones nobody can read', () => {
    const out = planCallouts(frame([pillar(800, 700, 300), pillar(2600, 2100, 60)]), { max: 1 });
    expect(out[0]!.id).toBe('f1');
  });
});

describe('where the inset goes', () => {
  const report = frame([pillar(2000, 1500, 60), ring(900, 700, 400)]);

  it('covers nothing that is already on the picture', () => {
    const out = planCallouts(report);
    expect(out).toHaveLength(1);
    const box = insetBox(out[0]!);
    for (const f of report.features) expect(overlaps(box, featureBounds(f))).toBe(false);
  });

  it('stays inside the frame', () => {
    const [c] = planCallouts(report);
    expect(c!.inset.x).toBeGreaterThanOrEqual(0);
    expect(c!.inset.y).toBeGreaterThanOrEqual(0);
    expect(c!.inset.x + c!.inset.w).toBeLessThanOrEqual(report.image.width);
    expect(c!.inset.y + c!.inset.h).toBeLessThanOrEqual(report.image.height);
  });

  it('crops inside the image, around the mark', () => {
    const [c] = planCallouts(report);
    expect(c!.crop.x).toBeGreaterThanOrEqual(0);
    expect(c!.crop.y).toBeGreaterThanOrEqual(0);
    expect(c!.crop.x + c!.crop.w).toBeLessThanOrEqual(report.image.width);
    expect(c!.crop.y + c!.crop.h).toBeLessThanOrEqual(report.image.height);
    expect(c!.anchor).toEqual({ x: 2000, y: 1500 });
  });

  it('enlarges, within what the source can actually give', () => {
    const [c] = planCallouts(report);
    expect(c!.scale).toBeGreaterThanOrEqual(2);
    expect(c!.scale).toBeLessThanOrEqual(8);
  });

  /*
   * A frame with no room left gets no inset. One laid over another mark trades
   * one unreadable feature for two.
   */
  it('gives up rather than covering something', () => {
    const wall = [0, 1, 2, 3].flatMap((i) =>
      [0, 1, 2].map((j) => ring(500 + i * 1000, 500 + j * 1000, 500)),
    );
    expect(planCallouts(frame([pillar(2000, 1500, 60), ...wall]))).toEqual([]);
  });
});

describe('insetEdgePoint', () => {
  const inset = { x: 100, y: 100, w: 200, h: 200 };

  it('lands on the side the line leaves by', () => {
    expect(insetEdgePoint(inset, { x: 1000, y: 200 })).toEqual({ x: 300, y: 200 }); // right
    expect(insetEdgePoint(inset, { x: 200, y: -50 })).toEqual({ x: 200, y: 100 }); // top
  });

  it('lands on a corner when the line goes diagonally', () => {
    expect(insetEdgePoint(inset, { x: 500, y: 500 })).toEqual({ x: 300, y: 300 });
  });

  it('has nowhere to go from the centre, and says the centre', () => {
    expect(insetEdgePoint(inset, { x: 200, y: 200 })).toEqual({ x: 200, y: 200 });
  });
});
