import { describe, expect, it } from 'vitest';
import { FactSheet, PredefinedLibrary } from '@astrolens/schema';
import { coverageSummary, resolvePredefinedText } from './predefinedText.js';
import { readingFromPredefined } from './index.js';

/** A fact sheet shaped like the real onsite one: an A-class host plus three
 *  atlas-sourced B features, each meant to land on a different fallback layer. */
const factsheet = FactSheet.parse({
  version: '1.0',
  image: { src: 'image.jpg', width: 4000, height: 3000, hash: 'abc' },
  solve: {
    status: 'solved',
    pixscale_arcsec: 2,
    frame: 'display',
    wcs: {
      ra0_deg: 85.2,
      dec0_deg: -2.4,
      crpix_x: 2000,
      crpix_y: 1500,
      scale_deg: 0.00055,
      orientation_deg: 0,
      parity: -1,
      width: 4000,
      height: 3000,
    },
  },
  objects: [
    {
      id: 'o1',
      role: 'primary',
      tier: 'A',
      names: ['B 33'],
      designations: ['Barnard 33'],
      common_name: { zh: '马头星云', en: 'Horsehead Nebula' },
      category: 'dark_nebula',
      type: { zh: '暗星云', en: 'Dark nebula', otype: 'DNe' },
      coord: { ra_deg: 85.24, dec_deg: -2.46, pixel: [2000, 1500] },
      size_arcmin: [8, 6],
      distance: { value: 400, unit: 'pc', source: 'test' },
      catalog_ids: { barnard: 'B 33' },
      confidence: 1,
    },
    {
      id: 'f_target',
      role: 'context',
      tier: 'B',
      parent_object_id: 'o1',
      feature_type: 'silhouette_shape',
      names: ['剪影 / Silhouette'],
      category: 'dark_nebula',
      type: { zh: '剪影暗形', en: 'Dark Silhouette', otype: '', source: 'atlas' },
      coord: { ra_deg: 85.24, dec_deg: -2.46, pixel: [2000, 1500] },
      polygon: [[1900, 1400], [2100, 1400], [2000, 1600]],
      geometry_kind: 'polygon',
      atlas_annotation_id: 'anno_head',
      catalog_ids: {},
      confidence: 1,
      detection_source: 'atlas',
    },
    {
      id: 'f_note',
      role: 'context',
      tier: 'B',
      parent_object_id: 'o1',
      feature_type: 'ionization_front',
      names: ['锋面 / Front'],
      category: 'dark_nebula',
      type: { zh: '电离锋面', en: 'Ionization Front', otype: '', source: 'atlas' },
      coord: { ra_deg: 85.3, dec_deg: -2.5, pixel: [2200, 1600] },
      polygon: [[2100, 1550], [2300, 1650]],
      geometry_kind: 'polyline',
      atlas_annotation_id: 'anno_rim',
      atlas_note: { zh: '策展人写的那条边。', en: "The curator's own note on this rim." },
      catalog_ids: {},
      confidence: 1,
      detection_source: 'atlas',
    },
    {
      id: 'f_generic',
      role: 'context',
      tier: 'B',
      parent_object_id: 'o1',
      feature_type: 'pillar',
      names: ['柱 / Pillar'],
      category: 'dark_nebula',
      type: { zh: '象鼻', en: 'Pillar', otype: '', source: 'atlas' },
      coord: { ra_deg: 85.1, dec_deg: -2.3, pixel: [1800, 1300] },
      polygon: [[1750, 1250], [1850, 1250], [1800, 1400]],
      geometry_kind: 'polygon',
      atlas_annotation_id: 'anno_pillar',
      catalog_ids: {},
      confidence: 1,
      detection_source: 'atlas',
    },
  ],
  provenance: { queries: [], solver: 'test', timestamp: '2026-08-01T00:00:00.000Z' },
});

const library = PredefinedLibrary.parse({
  schema_version: 1,
  entries: [
    {
      schema_version: 1,
      primary_id: 'B 33',
      aliases: ['Horsehead Nebula'],
      styles: {
        general: {
          narrative: { zh: '猎户座里最有名的一团暗云。', en: 'The most famous dark cloud in Orion.' },
          scale: { zh: '在银河系内,约 1300 光年。', en: 'Inside the Milky Way, ~1,300 light-years away.' },
          culture: { zh: '1888 年由弗莱明在底片上发现。', en: 'Found by Fleming on a photographic plate in 1888.' },
          fun_facts: [{ zh: '它正在被慢慢吹散。', en: 'It is slowly being blown away.' }],
          features: [
            {
              annotation_id: 'anno_head',
              explanation: { zh: '这就是那个马头的形状。', en: 'This is the horse-head shape itself.' },
            },
          ],
        },
      },
    },
  ],
});

describe('predefined text resolution', () => {
  it('walks the four layers, one per feature', () => {
    const r = resolvePredefinedText(factsheet, library);
    expect(r.sources.get('f_target')).toBe('target');
    expect(r.sources.get('f_note')).toBe('annotation_note');
    expect(r.sources.get('f_generic')).toBe('feature_generic');
    expect(r.sources.get('o1')).toBe('facts'); // A-class host has no atlas note
    expect(r.matchedTarget).toBe('B 33');
    expect(r.style).toBe('general');
  });

  it('uses the target narrative and surfaces scale/culture/fun facts', () => {
    const r = resolvePredefinedText(factsheet, library);
    expect(r.narrative.zh).toContain('猎户座');
    expect(r.extraFacts).toHaveLength(3); // scale + culture + one fun fact
    expect(r.extraFacts[0]!.en).toContain('Milky Way'); // sense of scale first
  });

  it('never leaves a feature blank, even with no library at all', () => {
    const r = resolvePredefinedText(factsheet, null);
    for (const obj of factsheet.objects) {
      const t = r.byId.get(obj.id);
      expect(t, obj.id).toBeDefined();
      expect(t!.explanation.zh.length, obj.id).toBeGreaterThan(0);
      expect(t!.explanation.en.length, obj.id).toBeGreaterThan(0);
    }
    // The three atlas features fall to their type-level notes; the host to facts.
    expect(coverageSummary(r)).toEqual({
      target: 0,
      annotation_note: 1,
      feature_generic: 2,
      facts: 1,
    });
  });

  it('builds the facts template only from what the sheet knows', () => {
    const r = resolvePredefinedText(factsheet, null);
    const host = r.byId.get('o1')!.explanation;
    expect(host.zh).toContain('马头星云');
    expect(host.zh).toContain('1,305 光年'); // 400 pc × 3.26156, rounded
    expect(host.en).toContain('dark nebula');
  });

  it('honours a restricted fallback list', () => {
    const r = resolvePredefinedText(factsheet, library, { fallback: ['target', 'facts'] });
    expect(r.sources.get('f_target')).toBe('target');
    expect(r.sources.get('f_note')).toBe('facts'); // annotation_note disabled
    expect(r.sources.get('f_generic')).toBe('facts'); // feature_generic disabled
  });

  it('degrades to another style rather than rendering nothing', () => {
    const r = resolvePredefinedText(factsheet, library, { style: 'kids' });
    expect(r.style).toBe('general');
  });

  it('assembles a complete Reading with no LLM', () => {
    const { reading, coverage } = readingFromPredefined(factsheet, library, {
      toolVersion: '0.1.0',
    });
    expect(reading.generator.llm).toBe('none (predefined:general)');
    expect(reading.object.name.zh).toBe('马头星云');
    expect(reading.narrative.zh).toContain('猎户座');
    expect(reading.extra_facts).toHaveLength(3);
    expect(reading.features.length).toBeGreaterThan(0);
    for (const f of reading.features) expect(f.explanation.zh.length).toBeGreaterThan(0);
    expect(coverage.sources.get('f_target')).toBe('target');
  });
});
