import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCachedCatalogClient, targetFootprint, prewarmTargets } from './catalogCache.js';
import type { CatalogCandidate, CatalogClient } from './types.js';

const cand = (name: string, ra: number, dec: number, size?: number): CatalogCandidate => ({
  main_id: name,
  names: [name],
  otype: 'HII',
  ra_deg: ra,
  dec_deg: dec,
  ...(size ? { size_arcmin: [size, size] as [number, number] } : {}),
  catalog_ids: {},
  source: 'test',
});

function counting(candidates: CatalogCandidate[]): { client: CatalogClient; calls: () => number } {
  let n = 0;
  return {
    client: {
      region: async () => {
        n += 1;
        return candidates;
      },
    },
    calls: () => n,
  };
}

const withDir = async (fn: (dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'astrolens-catcache-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe('catalogue snapshot', () => {
  it('serves a repeat query from disk instead of the network', async () => {
    await withDir(async (dir) => {
      const inner = counting([cand('A', 10, 20)]);
      const q = { ra_deg: 10, dec_deg: 20, radius_deg: 1 };
      const c1 = createCachedCatalogClient(inner.client, { dir });
      expect(await c1.region(q)).toHaveLength(1);
      expect(inner.calls()).toBe(1);

      const c2 = createCachedCatalogClient(inner.client, { dir }); // fresh index
      expect(await c2.region(q)).toHaveLength(1);
      expect(inner.calls()).toBe(1); // not called again
    });
  });

  it('answers a narrower query from a wider stored one, filtering locally', async () => {
    await withDir(async (dir) => {
      const inner = counting([cand('near', 10, 20), cand('far', 10, 23)]);
      const wide = createCachedCatalogClient(inner.client, { dir });
      await wide.region({ ra_deg: 10, dec_deg: 20, radius_deg: 5 });
      expect(inner.calls()).toBe(1);

      const narrow = createCachedCatalogClient(inner.client, { dir });
      const out = await narrow.region({ ra_deg: 10, dec_deg: 20, radius_deg: 1 });
      expect(inner.calls()).toBe(1); // covered — no second call
      expect(out.map((c) => c.main_id)).toEqual(['near']); // 3° away is filtered out
    });
  });

  it('does not treat a smaller stored field as covering a larger request', async () => {
    await withDir(async (dir) => {
      const inner = counting([cand('A', 10, 20)]);
      const c = createCachedCatalogClient(inner.client, { dir });
      await c.region({ ra_deg: 10, dec_deg: 20, radius_deg: 0.5 });
      await c.region({ ra_deg: 10, dec_deg: 20, radius_deg: 4 });
      expect(inner.calls()).toBe(2);
    });
  });

  it('keeps a big object whose centre is outside the requested radius', async () => {
    await withDir(async (dir) => {
      // 3° across, centred 1° away: it reaches well into a 0.2° field.
      const inner = counting([cand('big', 10, 21, 180)]);
      const c = createCachedCatalogClient(inner.client, { dir });
      await c.region({ ra_deg: 10, dec_deg: 20, radius_deg: 5 });
      const c2 = createCachedCatalogClient(inner.client, { dir });
      const out = await c2.region({ ra_deg: 10, dec_deg: 20, radius_deg: 0.2 });
      expect(out.map((x) => x.main_id)).toEqual(['big']);
    });
  });

  it('returns nothing rather than reaching the network in offline mode', async () => {
    await withDir(async (dir) => {
      const inner = counting([cand('A', 10, 20)]);
      const c = createCachedCatalogClient(inner.client, { dir, offline: true });
      expect(await c.region({ ra_deg: 99, dec_deg: -30, radius_deg: 1 })).toEqual([]);
      expect(inner.calls()).toBe(0);
    });
  });
});

describe('target footprint', () => {
  const entry = (verts: [number, number][]) => ({
    primary_id: 'T',
    annotations: [{ geometry: { vertices: verts } }],
  });

  it('centres on the annotated vertices and measures their spread', () => {
    const fp = targetFootprint(entry([
      [10, 20],
      [10.2, 20],
      [10.1, 20.1],
    ]))!;
    expect(fp.ra_deg).toBeCloseTo(10.1, 1);
    expect(fp.dec_deg).toBeCloseTo(20.03, 1);
    expect(fp.radius_deg).toBeGreaterThan(0);
    expect(fp.radius_deg).toBeLessThan(0.2);
  });

  it('handles a target straddling RA 0h without landing at 180°', () => {
    const fp = targetFootprint(entry([
      [359.9, 10],
      [0.1, 10],
    ]))!;
    expect(Math.min(fp.ra_deg, 360 - fp.ra_deg)).toBeLessThan(0.5);
  });

  it('reports nothing for a target with no annotations to locate it by', () => {
    expect(targetFootprint({ primary_id: 'T', annotations: [] })).toBeNull();
  });

  it('prewarms each target with a generous radius', async () => {
    const inner = counting([cand('A', 10, 20)]);
    const radii: number[] = [];
    const client: CatalogClient = {
      region: async (q) => {
        radii.push(q.radius_deg);
        return inner.client.region(q);
      },
    };
    const out = await prewarmTargets(
      [entry([[10, 20], [10.05, 20.05]]), { primary_id: 'empty', annotations: [] }],
      client,
    );
    expect(radii[0]).toBeGreaterThanOrEqual(1); // the floor, not the tiny extent
    expect(out[0]!.candidates).toBe(1);
    expect(out[1]!.skipped).toBeTruthy();
  });
});
