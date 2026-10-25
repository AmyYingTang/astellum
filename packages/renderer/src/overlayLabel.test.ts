import { describe, expect, it } from 'vitest';
import { overlayLabel } from './overlayLabel.js';

const base = {
  text: 'Pillar 1',
  x: 100,
  y: 200,
  bubbleR: 30,
  color: '#bb9af7',
  frameWidth: 1000,
};

describe('overlayLabel', () => {
  it('sizes itself from the badge, so it holds up on any frame', () => {
    const small = overlayLabel({ ...base, bubbleR: 24 });
    const large = overlayLabel({ ...base, bubbleR: 72 });
    expect(small).toContain('font-size="23"');
    expect(large).toContain('font-size="68"');
  });

  // The background under a name can go from black sky to a white core within a
  // few hundred pixels, so the name brings its own background — one colour
  // for every feature, not the feature's.
  it('sets light text on a dark plate, whatever the feature colour', () => {
    const svg = overlayLabel(base);
    expect(svg).toContain('fill="#080b12"');
    expect(svg).toContain('fill="#f2f5fb"');
    expect(svg).not.toContain('#bb9af7');
  });

  const rectOf = (svg: string): { x: number; w: number } => {
    const m = /<rect x="(-?\d+)" y="-?\d+" width="(\d+)"/.exec(svg)!;
    return { x: Number(m[1]), w: Number(m[2]) };
  };

  it('sits to the right of the badge in open space', () => {
    const r = rectOf(overlayLabel(base));
    expect(r.x).toBeGreaterThan(100);
  });

  // Nothing else in the kiosk guards the frame edge, and half a name hanging
  // off the picture is worse than no name.
  it('changes sides rather than running off the right edge', () => {
    const r = rectOf(overlayLabel({ ...base, x: 900 }));
    expect(r.x + r.w).toBeLessThan(900);
  });

  // librsvg cannot measure, so the plate is sized from the characters: a CJK
  // name of the same length needs a wider one than a Latin name.
  it('sizes the plate to the name', () => {
    const latin = rectOf(overlayLabel({ ...base, text: 'Pillar' }));
    const cjk = rectOf(overlayLabel({ ...base, text: '象鼻柱状体' }));
    const long = rectOf(overlayLabel({ ...base, text: 'Pillar with a long name' }));
    expect(cjk.w).toBeGreaterThan(latin.w);
    expect(long.w).toBeGreaterThan(cjk.w);
  });

  it('carries both languages when asked, as its only content', () => {
    const svg = overlayLabel({ ...base, bilingual: { zh: '柱 1', en: 'Pillar 1' } });
    expect(svg).toContain('data-zh="柱 1" data-en="Pillar 1"');
    // The language switch assigns textContent, so anything else inside is lost.
    expect(svg).toMatch(/>[^<]*<\/text>/);
  });

  it('draws nothing for a feature with no name', () => {
    expect(overlayLabel({ ...base, text: '   ' })).toBe('');
  });

  it('escapes a name that would otherwise break the markup', () => {
    expect(overlayLabel({ ...base, text: 'M<1 & "big"' })).toContain(
      'M&lt;1 &amp; &quot;big&quot;',
    );
  });
});

// librsvg ignores dominant-baseline, so a name centred that way sat in the top
// half of its plate in every exported frame. The baseline is placed instead.
describe('a name on its plate', () => {
  it('is centred by its baseline, not by an attribute librsvg ignores', () => {
    const svg = overlayLabel(base);
    expect(svg).not.toContain('dominant-baseline');
    const plate = /<rect x="-?\d+" y="(-?\d+)" width="\d+" height="(\d+)"/.exec(svg)!;
    const textY = Number(/<text[^>]* y="(-?\d+)"/.exec(svg)![1]);
    const centre = Number(plate[1]) + Number(plate[2]) / 2;
    expect(textY).toBeGreaterThan(centre); // baseline below the middle
    expect(textY - centre).toBeCloseTo(Math.round(30 * 0.95) * 0.35, 0);
  });
});
