import { describe, it, expect } from 'vitest';
import type { Wcs } from '@astellum/schema';
import { detectCvFeatures } from './cv.js';
import type { DerivableObject } from './features.js';
import type { LuminanceSampler } from './luminance.js';

const wcs: Wcs = {
  ra0_deg: 167.88,
  dec0_deg: -61.36,
  crpix_x: 2000,
  crpix_y: 1500,
  scale_deg: 2.33 / 3600,
  orientation_deg: 0,
  parity: 1,
  width: 4000,
  height: 3000,
};

const nebula: DerivableObject = {
  id: 'obj1',
  category: 'emission_nebula',
  type: { otype: 'HII', zh: '发射星云', en: 'Emission nebula' },
  coord: { ra_deg: 167.88, dec_deg: -61.36, pixel: [2000, 1500] },
  size_arcmin: [120, 120], // ~1545 px radius at 2.33"/px
  names: ['NGC 3576'],
};

// A coherent glow around the nebula centre (so the visible-radius estimate
// works), with an extra-bright knot on the rim to the right of centre.
const glow =
  (cx: number, cy: number, R: number, knotX: number, knotY: number, bg: number): LuminanceSampler =>
  (x, y) => {
    if (Math.hypot(x - knotX, y - knotY) < 150) return 240; // bright rim knot
    if (Math.hypot(x - cx, y - cy) < R) return 120; // diffuse glow
    return bg;
  };

describe('detectCvFeatures (bright rim)', () => {
  it('detects an ionization front on the brightest part of the nebula rim', () => {
    const feats = detectCvFeatures([nebula], {
      wcs,
      sampler: glow(2000, 1500, 600, 2400, 1500, 20),
      backgroundLum: 20,
    });
    expect(feats).toHaveLength(1);
    const f = feats[0]!;
    expect(f.feature_type).toBe('ionization_front');
    expect(f.detection_source).toBe('cv');
    expect(f.parent_object_id).toBe('obj1');
    expect(f.needs_human_review).toBe(true);
    // landed near the bright knot (to the right of centre)
    expect(f.coord.pixel![0]).toBeGreaterThan(2000);
  });

  it('emits nothing when the rim is not clearly above background', () => {
    const feats = detectCvFeatures([nebula], {
      wcs,
      sampler: () => 21, // flat, ~background everywhere
      backgroundLum: 20,
    });
    expect(feats).toEqual([]);
  });

  it('needs a sampler + wcs (no image → no CV)', () => {
    expect(detectCvFeatures([nebula], {})).toEqual([]);
  });
});
