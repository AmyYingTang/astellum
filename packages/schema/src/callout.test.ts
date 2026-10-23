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

/**
 * The curator's two levers. Both live on the feature, so they survive a save
 * and travel with the reading rather than with the session that set them.
 */
describe("what the curator says about an inset", () => {
  const two = [pillar(1200, 900, 60), pillar(2800, 2100, 80)];

  it('refuses one, and gives its place to the next mark down', () => {
    const all = planCallouts(frame(two));
    expect(all.map((c) => c.id)).toEqual(['f0', 'f1']);

    const off = frame([{ ...(two[0] as object), callout: { off: true } }, two[1]]);
    expect(planCallouts(off).map((c) => c.id)).toEqual(['f1']);
  });

  /*
   * Reversible is the point: `off` is a flag, not a deletion, so the panel
   * comes back exactly as it was rather than having to be recreated.
   */
  it('gives it back when the refusal is lifted', () => {
    const on = frame([{ ...(two[0] as object), callout: { off: false } }, two[1]]);
    expect(planCallouts(on).map((c) => c.id)).toEqual(['f0', 'f1']);
  });

  it('puts a panel where it was dragged, not where it would have chosen', () => {
    const pinned = frame([{ ...(two[0] as object), callout: { x: 3100, y: 2000 } }, two[1]]);
    const [c] = planCallouts(pinned);
    expect(c!.inset.x).toBe(3100);
    expect(c!.inset.y).toBe(2000);
  });

  /*
   * A drag can put a panel half off the picture; the automatic placement
   * cannot. So the pin is honoured but still held inside the frame.
   */
  it('holds a dragged panel inside the frame', () => {
    const r = frame([{ ...(two[0] as object), callout: { x: -500, y: 99999 } }, two[1]]);
    const [c] = planCallouts(r);
    expect(c!.inset.x).toBe(0);
    expect(c!.inset.y).toBe(r.image.height - c!.inset.h);
  });

  it('keeps a hand-placed panel when the cap bites, over an automatic one', () => {
    const crowd = [0, 1, 2, 3].map((i) => pillar(600 + i * 900, 600 + i * 600, 60));
    const withPin = [
      ...crowd.slice(0, 3),
      { ...(crowd[3] as object), callout: { x: 3200, y: 2600 } },
    ];
    const out = planCallouts(frame(withPin), { max: 1 });
    expect(out.map((c) => c.id)).toEqual(['f3']);
  });
});

/**
 * Out at the edge, because the middle of an astrophoto is the photograph. The
 * "unless there is something there" half needs no special case: an occupied
 * edge is already excluded by the search.
 */
describe('how far out the inset sits', () => {
  /*
   * "At the edge" is a band, not a line: positions within a third of the
   * inset's own size of the margin all count as edge, and which of them is
   * taken is then decided by how near the mark it is. Exact comparison made a
   * position two pixels further in lose to one that was worse in every other
   * way.
   */
  it('goes to an edge when an edge is free', () => {
    const r = frame([pillar(2000, 1500, 60)]);
    const [c] = planCallouts(r);
    const edge = Math.min(
      c!.inset.x,
      c!.inset.y,
      r.image.width - (c!.inset.x + c!.inset.w),
      r.image.height - (c!.inset.y + c!.inset.h),
    );
    const margin = Math.round(0.02 * Math.min(r.image.width, r.image.height));
    expect(edge).toBeLessThanOrEqual(margin + c!.inset.w / 3);
    // And nowhere near the middle, which is the whole point.
    expect(edge).toBeLessThan(Math.min(r.image.width, r.image.height) / 4);
  });

  /*
   * The far margins have to be in the search. Walked from the near edge with a
   * fixed step it stopped short of them, so the bottom and right of every
   * frame scored as inland and panels piled onto the two edges the walk
   * reached.
   */
  it('will use the far edges, not only the two it starts from', () => {
    const r = frame([ring(400, 400, 350), ring(400, 2600, 350), pillar(3600, 1500, 60)]);
    const [c] = planCallouts(r);
    expect(c!.inset.x + c!.inset.w).toBeGreaterThan(r.image.width * 0.6);
  });

  /*
   * 'field' is the subject the frame is a crop of and nothing is drawn for it.
   * Reserving its circle walled off the middle 40% of the frame and pushed
   * panels to the far side, giving them connectors across the whole picture.
   */
  it('is not kept away by the subject, which draws nothing', () => {
    const open = planCallouts(frame([pillar(2000, 1500, 60)]));
    const withField = planCallouts(
      frame([pillar(2000, 1500, 60), { shape: 'field', circle: { cx: 2000, cy: 1500, r: 1200 } }]),
    );
    expect(withField).toHaveLength(1);
    expect(withField[0]!.inset).toEqual(open[0]!.inset);
  });
});
