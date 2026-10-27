import { describe, expect, it } from 'vitest';
import type { Wcs } from './types.js';
import type { CatalogCandidate } from './types.js';
import { gateCandidates, selectObjects } from './select.js';

const wcs: Wcs = {
  ra0_deg: 168,
  dec0_deg: -61.3,
  crpix_x: 1000,
  crpix_y: 1000,
  scale_deg: 2.3 / 3600,
  orientation_deg: 0,
  parity: -1,
  width: 2000,
  height: 2000,
};

const nebula = (over: Partial<CatalogCandidate>): CatalogCandidate => ({
  main_id: 'NGC 3603',
  names: ['NGC 3603'],
  otype: 'EmO',
  ra_deg: 168.1,
  dec_deg: -61.28,
  size_arcmin: [3.3, 3.3],
  catalog_ids: { ngc: 'NGC 3603' },
  source: 'OpenNGC',
  ...over,
});

// The subject is always kept, so each case adds a big, central nebula for that
// role and asks about the small one beside it.
const subject = nebula({ main_id: 'NGC 3579', names: ['NGC 3579'], catalog_ids: { ngc: 'NGC 3579' }, ra_deg: 168, dec_deg: -61.3, size_arcmin: [20, 15] });

const opts = {
  starMagMax: 4,
  nebulaMinArcmin: 8,
  galaxyMinArcmin: 3,
  maxStars: 2,
  maxClusters: 2,
  maxNebulae: 2,
  maxGalaxies: 1,
  topN: 6,
};

const picked = (c: CatalogCandidate): boolean =>
  selectObjects(gateCandidates([subject, c], wcs), opts).some((g) => g.candidate.main_id === c.main_id);

describe('a small named nebula', () => {
  it('is dropped for its size when nothing marks it as special', () => {
    expect(picked(nebula({}))).toBe(false);
  });

  it('is kept when it holds a cluster, as a named cluster would be', () => {
    expect(picked(nebula({ with_cluster: true }))).toBe(true);
  });

  it('still needs a real name to be kept', () => {
    expect(picked(nebula({ with_cluster: true, main_id: 'X1', names: ['[ABC] 12'], catalog_ids: {} }))).toBe(false);
  });
});
