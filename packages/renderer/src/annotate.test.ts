import { describe, expect, it } from 'vitest';
import { LIFT, type Reading } from '@astellum/schema';
import { buildOverlaySvg, pieceMask } from './annotate.js';

const report = {
  version: '2.0',
  image: { src: 'image.jpg', width: 1000, height: 800 },
  display_language: 'zh',
  object: { name: 'Sh2-308', aliases: [], type: { zh: 'WR 气泡', en: 'WR bubble' } },
  narrative: { zh: '测试', en: 'test' },
  features: [
    {
      id: 'f1',
      fact_ref: null,
      label: { zh: 'a', en: 'a' },
      color_key: 'hot',
      circle: { cx: 500, cy: 400, r: 100 },
      badge: { num: '1', offset_x: 0, offset_y: 0, bubble_r: 30 },
      explanation: { zh: 'x', en: 'x' },
      needs_human_review: false,
    },
    {
      id: 'f2',
      fact_ref: null,
      label: { zh: 'b', en: 'b' },
      color_key: 'shock',
      circle: { cx: 200, cy: 200, r: 50 },
      badge: { num: '2', offset_x: 10, offset_y: -10, bubble_r: 30 },
      explanation: { zh: 'y', en: 'y' },
      needs_human_review: false,
    },
  ],
  extra_facts: [],
  created_at: '2026-05-27T00:00:00.000Z',
  generator: { tool: 'astellum', tool_version: '0.1.0', llm: 'claude' },
} satisfies Reading;

describe('buildOverlaySvg', () => {
  it('sizes the svg to the image', () => {
    const svg = buildOverlaySvg(report);
    expect(svg).toContain('width="1000" height="800"');
    expect(svg).toContain('viewBox="0 0 1000 800"');
  });

  it('draws an outline circle + badge bubble + number + name per feature', () => {
    const svg = buildOverlaySvg(report);
    // 2 outline circles + 2 badge bubbles = 4 <circle>; each feature gets a
    // number and a name = 4 <text>.
    expect(svg.match(/<circle/g)).toHaveLength(4);
    expect(svg.match(/<text/g)).toHaveLength(4);
    expect(svg).toContain('>1</text>');
    expect(svg).toContain('>2</text>');
    expect(svg).toContain('>a</text>');
    expect(svg).toContain('>b</text>');
  });

  // A printed frame has no list to look a number up in, so the name has to
  // survive whatever is under it — hence the dark halo rather than a plate.
  it('sets the name on the same dark plate the kiosk uses', () => {
    const svg = buildOverlaySvg(report);
    expect(svg).toContain('fill="#080b12" fill-opacity="0.9"');
    expect(svg).toContain('fill="#f2f5fb"');
  });

  it('colors strokes from the palette', () => {
    const svg = buildOverlaySvg(report);
    expect(svg).toContain('stroke="#ffd84a"'); // hot
    expect(svg).toContain('stroke="#4ec3e0"'); // shock
  });

  it('matches snapshot', () => {
    expect(buildOverlaySvg(report)).toMatchSnapshot();
  });
});

/**
 * The magnified insets. Where they go is `planCallouts`' business and tested
 * there; this is about what gets drawn once the answer is in.
 */
describe('magnified insets', () => {
  const tiny: Reading = {
    ...report,
    features: [
      ...report.features,
      {
        id: 'f3',
        fact_ref: null,
        label: { zh: '柱', en: 'pillar' },
        color_key: 'pillar',
        shape: 'polygon',
        circle: { cx: 800, cy: 650, r: 15 },
        polygon: [
          [785, 635],
          [815, 635],
          [815, 665],
        ],
        badge: { num: '3', offset_x: 0, offset_y: 0, bubble_r: 30 },
        explanation: { zh: 'z', en: 'z' },
        needs_human_review: false,
      },
    ],
  } as unknown as Reading;

  it('frames the patch, numbers it, and runs a line back to the mark', () => {
    const svg = buildOverlaySvg(tiny);
    expect(svg).toContain('clipPath id="k-cal-f3"');
    expect(svg).toContain('stroke-dasharray'); // the connector
    expect(svg).toMatch(/<text[^>]*>3<\/text>/); // the inset carries the badge number
  });

  it('draws nothing extra for a frame whose marks are all readable', () => {
    expect(buildOverlaySvg(report as unknown as Reading)).not.toContain('clipPath');
  });

  /*
   * Only the poster can supply the pixels through the SVG; the exported frame
   * has sharp composite them underneath, and an <image> there would make
   * librsvg re-decode the whole photograph out of base64.
   */
  it('puts the picture in the inset only when given somewhere to get it', () => {
    expect(buildOverlaySvg(tiny)).not.toContain('<image');
    expect(buildOverlaySvg(tiny, { imageHref: 'data:image/png;base64,AA' })).toContain(
      '<image href="data:image/png;base64,AA"',
    );
  });

  it('honours a plan it was handed, rather than making its own', () => {
    const svg = buildOverlaySvg(tiny, { callouts: [] });
    expect(svg).not.toContain('clipPath');
  });
});

/*
 * A panel is a frame and the piece inside it. Nothing fills it: the picture
 * goes on showing through, so a magnified mark costs the viewer a box outline
 * and the piece's own footprint instead of a square of photograph painted
 * over. What marks the region is the piece being raised, not a wash.
 */
describe('a panel the picture shows through', () => {
  const withShape = (shape: string, extra: object): Reading =>
    ({
      ...report,
      features: [
        {
          id: 'g1',
          fact_ref: null,
          label: { zh: 'x', en: 'x' },
          color_key: 'pillar',
          shape,
          circle: { cx: 800, cy: 650, r: 15 },
          badge: { num: '9', offset_x: 0, offset_y: 0, bubble_r: 30 },
          explanation: { zh: 'z', en: 'z' },
          needs_human_review: false,
          ...extra,
        },
      ],
    }) as unknown as Reading;

  const tri: [number, number][] = [
    [785, 635],
    [815, 635],
    [815, 665],
  ];

  it('paints nothing over the picture inside the frame', () => {
    const svg = buildOverlaySvg(withShape('polygon', { polygon: tri }));
    // No wash, and no copy of the patch laid down behind one: the only filled
    // rectangles left in the file are the mask's own white ground (and the
    // name plates, which sit beside the numbers, not in the panel).
    expect(svg).not.toContain('rgba(3,5,10');
    const fills = (svg.match(/<rect[^>]*fill="(?!none)[^"]*"[^>]*>/g) ?? []).filter(
      (r) => !r.includes('#080b12'),
    );
    expect(fills.every((r) => r.includes('#fff'))).toBe(true);
  });

  it('still keeps the shadow off the piece, which is what the mask is now for', () => {
    const svg = buildOverlaySvg(withShape('polygon', { polygon: tri }));
    expect(svg).toContain('mask id="k-cal-g1-m"');
    expect(svg).toContain('<polygon points="785.0,635.0 815.0,635.0 815.0,665.0" fill="#000"/>');
    expect(svg).toMatch(/<g mask="url\(#k-cal-g1-m\)" opacity="0\.9">/);
  });

  /* An open line encloses nothing, so its region is a band along itself. */
  it('gives an open line a band rather than an area', () => {
    const svg = buildOverlaySvg(withShape('polyline', { polygon: tri }));
    expect(svg).toMatch(/<polyline points="785\.0,635\.0 815\.0,635\.0 815\.0,665\.0" fill="none" stroke="#000"/);
  });

  /*
   * And no outline inside the panel. The wash already says which pixels are
   * the feature; a dashed contour drawn on top of that same boundary competes
   * with it and leaves the eye less sure what is being named, not more. So the
   * shape appears twice in the file — once on the picture, once as the hole in
   * the mask — and never a third time as a drawing inside the panel.
   */
  it('draws no contour inside the panel', () => {
    const svg = buildOverlaySvg(withShape('polygon', { polygon: tri }));
    // The shape is written several times — the mark on the picture, the hole
    // in the wash's mask, the shape that casts the shadow — but only one of
    // them is *drawn*: the rest are stencils, in mask black and white. So the
    // test is how many wear the feature's own colour.
    const copies = svg.match(/<polygon points="785\.0[^>]*>/g) ?? [];
    const drawn = copies.filter((t) => !/#000|#fff/.test(t));
    expect(copies.length).toBeGreaterThan(1);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toContain('stroke-dasharray'); // the dashed mark on the picture
  });

  /*
   * The region is raised out of the patch, not left flat: a shadow on the
   * dimmed sky, and the piece drawn larger. A flat bright patch reads as a
   * stain; the two cues together read as a piece lifted out of the picture.
   */
  it('casts a shadow and keeps it off the piece it lifts', () => {
    const svg = buildOverlaySvg(withShape('polygon', { polygon: tri }));
    expect(svg).toContain('<feGaussianBlur');
    // The shadow's mask excludes the raised shape, so it falls on the picture
    // and never on the thing it is lifting.
    expect(svg).toMatch(/<g mask="url\(#k-cal-g1-m\)" opacity="0\.9">/);
    // And it is offset: a shadow exactly under its own shape is no shadow.
    expect(svg).toMatch(/<g transform="translate\(\d+(\.\d+)? \d+(\.\d+)?\)" filter="url\(#k-cal-g1-s\)">/);
  });

  it('draws the piece larger, only where it has a picture to draw it from', () => {
    expect(buildOverlaySvg(withShape('polygon', { polygon: tri }))).not.toContain('k-cal-g1-p');
    const poster = buildOverlaySvg(withShape('polygon', { polygon: tri }), {
      imageHref: 'data:image/png;base64,AA',
    });
    expect(poster).toContain('mask id="k-cal-g1-p"');
    expect(poster).toContain(`scale(${LIFT.scale})`);
  });
});

/**
 * The stencil that cuts the raised piece for the exported frame.
 *
 * `dest-in` keeps the destination where the *mask's alpha* is. A background
 * rect of any colour is opaque and therefore keeps everything — which pasted
 * a square of magnified picture onto the frame. The wash over it hid that well
 * enough that it survived until a panel was drawn without one.
 */
describe('cutting the piece for the exported frame', () => {
  const c = {
    id: 'g1',
    num: '9',
    crop: { x: 700, y: 550, w: 200, h: 200 },
    inset: { x: 10, y: 10, w: 400, h: 400 },
    scale: 2,
    anchor: { x: 800, y: 650 },
  };
  const f = {
    id: 'g1',
    shape: 'polygon',
    circle: { cx: 800, cy: 650, r: 15 },
    polygon: [
      [785, 635],
      [815, 635],
      [815, 665],
    ],
  } as unknown as Parameters<typeof pieceMask>[1];

  it('is transparent everywhere but the shape', () => {
    const mask = pieceMask(c, f);
    expect(mask).toContain('<polygon');
    expect(mask).not.toContain('<rect');
  });

  it('speaks in the panel\u2019s own pixels, raised', () => {
    const mask = pieceMask(c, f);
    // The feature's centre sits at the middle of the panel either way; the
    // raised outline is the one that is LIFT.scale further out from it.
    const half = (800 - c.crop.x) * c.scale;
    expect(half).toBe(200);
    const xs = [...mask.matchAll(/(\d+\.\d),\d+\.\d/g)].map((m) => Number(m[1]));
    const spread = Math.max(...xs) - Math.min(...xs);
    expect(spread).toBeCloseTo(30 * c.scale * LIFT.scale, 1);
  });
});
