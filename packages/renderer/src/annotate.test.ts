import { describe, expect, it } from 'vitest';
import type { Reading } from '@astellum/schema';
import { buildOverlaySvg } from './annotate.js';

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
  it('gives the name a halo in the feature\u2019s own colour', () => {
    const svg = buildOverlaySvg(report);
    expect(svg).toContain('fill="#ffd84a" stroke="#0b0e14"');
    expect(svg).toContain('paint-order="stroke"');
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
