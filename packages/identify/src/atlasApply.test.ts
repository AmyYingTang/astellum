import { describe, expect, it } from 'vitest';
import { pixelToWorld, type Registry, type Wcs } from '@astellum/schema';
import { applyAtlas } from './atlasApply.js';

const wcs: Wcs = {
  ra0_deg: 161,
  dec0_deg: -59.7,
  crpix_x: 1000,
  crpix_y: 1000,
  scale_deg: 2 / 3600,
  orientation_deg: 0,
  parity: -1,
  width: 2000,
  height: 2000,
};

const host = {
  id: 'o1',
  category: 'emission_nebula' as const,
  names: ['NGC 3372'],
  designations: ['NGC 3372'],
  catalog_ids: {},
};

const withLabel = (zh: string, en: string): Registry => ({
  schema_version: 1,
  objects: [
    {
      primary_id: 'NGC 3372',
      aliases: [],
      annotations: [
        {
          id: 'a1',
          feature_type: 'pillar',
          geometry: { type: 'point', vertices: [pixelToWorld(wcs, 1000, 1000)] },
          label: { zh, en },
        },
      ],
    },
  ],
});

const typeOf = (r: Registry): { zh: string; en: string } =>
  (applyAtlas([host], wcs, r).features[0] as { type: { zh: string; en: string } }).type;

// An English name reads fine in a Chinese label; the reverse does not.
describe('a one-sided atlas label', () => {
  it('lends a Chinese label its English name', () => {
    expect(typeOf(withLabel('', 'Mystic Mountain'))).toMatchObject({ zh: 'Mystic Mountain', en: 'Mystic Mountain' });
  });

  it('never puts Chinese in the English label', () => {
    const t = typeOf(withLabel('神秘山', ''));
    expect(t.zh).toBe('神秘山');
    expect(t.en).not.toMatch(/[一-鿿]/);
    expect(t.en.length).toBeGreaterThan(0);
  });
});
