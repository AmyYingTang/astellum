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
  // few hundred pixels, so the glyph carries its own contrast.
  it('paints a dark halo under the feature colour', () => {
    const svg = overlayLabel(base);
    expect(svg).toContain('fill="#bb9af7"');
    expect(svg).toContain('stroke="#0b0e14"');
    expect(svg).toContain('paint-order="stroke"');
  });

  it('sits to the right of the badge in open space', () => {
    const svg = overlayLabel(base);
    expect(svg).toContain('text-anchor="start"');
    expect(svg).toMatch(/x="1[0-9][0-9]"/); // pushed right of x=100
  });

  // Nothing else in the kiosk guards the frame edge, and half a name hanging
  // off the picture is worse than no name.
  it('changes sides rather than running off the right edge', () => {
    const svg = overlayLabel({ ...base, x: 900 });
    expect(svg).toContain('text-anchor="end"');
    expect(svg).toMatch(/x="8[0-9][0-9]"/); // pulled back left of x=900
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
