import { describe, it, expect } from 'vitest';
import { mergeCandidates } from './composite.js';
import type { CatalogCandidate } from './types.js';

function cand(over: Partial<CatalogCandidate>): CatalogCandidate {
  return {
    main_id: 'X',
    names: ['X'],
    otype: 'HII',
    ra_deg: 161.27,
    dec_deg: -59.66,
    catalog_ids: {},
    source: 'SIMBAD',
    ...over,
  };
}

describe('mergeCandidates — same-complex cross-category merge', () => {
  it('folds a comparable concentric Cederblad reflection entry into the HII region', () => {
    // Carina: NGC 3372 (HII, 210′) and Ced 109 (Cederblad blanket-typed RNe, 120′)
    // at the same centre — the same complex, listed twice.
    const ngc = cand({
      main_id: 'NGC 3372',
      names: ['NGC 3372'],
      otype: 'HII',
      size_arcmin: [210, 210],
      catalog_ids: { ngc: 'NGC 3372' },
      source: 'VizieR:VII/216/rcw',
    });
    const ced = cand({
      main_id: 'Ced 109',
      names: ['Ced 109'],
      otype: 'RNe',
      size_arcmin: [120, 120],
      catalog_ids: { cederblad: 'Ced 109' },
      source: 'VizieR:VII/231/catalog',
    });
    const merged = mergeCandidates([[ngc], [ced]]);
    expect(merged).toHaveLength(1);
    // NGC (higher prestige) survives; it stays the emission nebula, not RNe.
    expect(merged[0]!.otype).toBe('HII');
    expect(merged[0]!.catalog_ids.ngc).toBe('NGC 3372');
    expect(merged[0]!.cross_match?.some((x) => x.id === 'Ced 109')).toBe(true);
  });

  it('does NOT swallow a genuine small reflection nebula inside a big HII region', () => {
    const hii = cand({ otype: 'HII', size_arcmin: [210, 210], catalog_ids: { ngc: 'NGC 3372' } });
    const smallRfn = cand({
      main_id: 'vdB X',
      otype: 'RNe',
      size_arcmin: [8, 8], // tiny vs 210′ → a real sub-object, not the same complex
      catalog_ids: { vdb: 'vdB X' },
    });
    expect(mergeCandidates([[hii], [smallRfn]])).toHaveLength(2);
  });

  it('does NOT merge comparable nebulae that are far apart', () => {
    const a = cand({ otype: 'HII', size_arcmin: [120, 120], catalog_ids: { ngc: 'NGC A' } });
    const b = cand({
      otype: 'RNe',
      ra_deg: 161.27 + 1.5, // ~45′ away → not concentric
      size_arcmin: [120, 120],
      catalog_ids: { cederblad: 'Ced B' },
    });
    expect(mergeCandidates([[a], [b]])).toHaveLength(2);
  });
});

describe('mergeCandidates — same-category dedup', () => {
  it('does NOT let a giant complex swallow a distinct nebula inside it', () => {
    // The real case: Sh 2-310 is 480′ across and Sh 2-308 (35′, the Dolphin
    // Head — a Wolf–Rayet bubble) sits inside it. Sizing the duplicate test off
    // the larger object gave 288′ of reach and lost Sh 2-308 entirely.
    const giant = cand({
      main_id: 'Sh 2-310',
      names: ['Sh 2-310'],
      size_arcmin: [480, 480],
      catalog_ids: { sharpless: 'Sh 2-310' },
      source: 'VizieR:VII/20/catalog',
    });
    const inner = cand({
      main_id: 'Sh 2-308',
      names: ['Sh 2-308'],
      ra_deg: 161.27 + 0.8,
      size_arcmin: [35, 35],
      catalog_ids: { sharpless: 'Sh 2-308' },
      source: 'VizieR:VII/20/catalog',
    });
    const merged = mergeCandidates([[giant], [inner]]);
    expect(merged.map((c) => c.main_id).sort()).toEqual(['Sh 2-308', 'Sh 2-310']);
  });

  it('still folds two catalogues listing the same nebula', () => {
    // Sh 2-308 ≡ RCW 11: comparable sizes, essentially the same centre.
    const sh = cand({
      main_id: 'Sh 2-308',
      names: ['Sh 2-308'],
      size_arcmin: [35, 35],
      catalog_ids: { sharpless: 'Sh 2-308' },
    });
    const rcw = cand({
      main_id: 'RCW 11',
      names: ['RCW 11'],
      ra_deg: 161.27 + 0.05,
      size_arcmin: [60, 20],
      catalog_ids: { rcw: 'RCW 11' },
    });
    const merged = mergeCandidates([[sh], [rcw]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.catalog_ids.sharpless).toBe('Sh 2-308');
    expect(merged[0]!.cross_match?.some((x) => x.id === 'RCW 11')).toBe(true);
  });

  it('keeps two unsized same-kind entries apart unless they are nearly on top of each other', () => {
    const a = cand({ main_id: 'A', otype: 'WR*', names: ['A'] });
    const b = cand({ main_id: 'B', otype: 'WR*', names: ['B'], ra_deg: 161.27 + 0.2 });
    expect(mergeCandidates([[a], [b]])).toHaveLength(2);
  });
});
