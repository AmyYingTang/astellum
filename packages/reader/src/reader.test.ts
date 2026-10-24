import { describe, expect, it, vi } from 'vitest';
import { ColorKey, type FactSheet } from '@astellum/schema';
import { extractJson, parseTailoring } from './parseJson.js';
import { parseSimbadAscii } from './simbad.js';
import { buildTailorPrompt } from './prompt.js';
import { generateReading, readingFromFactsheet, ReaderError, tailorReading } from './index.js';

const obj = (over: Partial<FactSheet['objects'][number]>): FactSheet['objects'][number] => ({
  id: 'obj1',
  role: 'secondary',
  names: ['X'],
  category: 'star',
  type: { otype: '*', zh: '恒星', en: 'Star' },
  coord: { ra_deg: 0, dec_deg: 0, pixel: [100, 100] },
  catalog_ids: {},
  confidence: 0.8,
  features: [],
  ...over,
});

const factsheet: FactSheet = {
  version: '1.0',
  image: { src: 'image.jpg', width: 4000, height: 3000, hash: 'sha256:x', band: 'broadband', starless: false },
  solve: { status: 'solved', ra_deg: 246, dec_deg: -26, pixscale_arcsec: 2.0, frame: 'display' },
  objects: [
    obj({
      id: 'obj1',
      role: 'primary',
      names: ['M 4'],
      category: 'globular_cluster',
      type: { otype: 'GlC', zh: '球状星团', en: 'Globular cluster' },
      coord: { ra_deg: 245.9, dec_deg: -26.5, pixel: [2000, 1500] },
      size_arcmin: [26, 26],
      catalog_ids: { messier: 'M4' },
      confidence: 0.97,
    }),
    obj({
      id: 'obj2',
      names: ['Antares', '* alf Sco'],
      category: 'star',
      type: { otype: 's*r', zh: '恒星', en: 'Star' },
      coord: { ra_deg: 247.3, dec_deg: -26.4, pixel: [3000, 2000] },
    }),
    obj({
      id: 'obj3',
      names: ['PGCC G351.88+15.96'],
      category: 'dark_nebula',
      type: { otype: 'MoC', zh: '暗星云', en: 'Dark nebula' },
      coord: { ra_deg: 246.2, dec_deg: -26.1, pixel: [1000, 1000] },
      size_arcmin: [13, 13],
    }),
  ],
  warnings: [],
  provenance: { queries: ['q'], solver: 'nova', timestamp: '2026-06-21T00:00:00.000Z' },
};

const tailoringJson = JSON.stringify({
  narrative: { zh: '心宿二一带。', en: 'Around Antares.' },
  features: [
    { id: 'obj1', explanation: { zh: '球状星团。', en: 'A globular cluster.' } },
    { id: 'obj2', explanation: { zh: '红超巨星。', en: 'A red supergiant.' } },
    { id: 'obj3', explanation: { zh: '分子云。', en: 'A molecular cloud.' } },
  ],
});

describe('extractJson', () => {
  it('unwraps a ```json fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});

describe('buildTailorPrompt', () => {
  it('lists the grounded object ids and forbids inventing identity', () => {
    const p = buildTailorPrompt({
      headline: 'M 4',
      items: [{ id: 'obj1', name: 'M 4 / M 4', type: 'Globular cluster' }],
    });
    expect(p).toContain('id=obj1');
    expect(p).toContain('绝不编造');
  });
});

describe('parseTailoring', () => {
  it('accepts valid bilingual tailoring', () => {
    expect(parseTailoring(tailoringJson).ok).toBe(true);
  });
  it('rejects a monolingual explanation', () => {
    expect(parseTailoring(tailoringJson.replace(',"en":"A globular cluster."', '')).ok).toBe(false);
  });
});

describe('parseSimbadAscii', () => {
  it('extracts angular size and distance', () => {
    const sample = ['Angular size: 40.0 40.0 0 (Opt) D ~', 'Distance results: 1.5 kpc'].join('\n');
    const facts = parseSimbadAscii(sample);
    expect(facts.size_arcmin).toBe(40);
    expect(facts.distance_ly).toBe(Math.round(1.5 * 1000 * 3.26156));
  });
});

describe('generateReading', () => {
  const base = { toolVersion: '0.1.0' };

  it('annotates every catalogued object (one circle each)', async () => {
    const runner = vi.fn().mockResolvedValue(tailoringJson);
    const reading = await generateReading(factsheet, { ...base, runner });
    expect(reading.version).toBe('2.0');
    expect(reading.features).toHaveLength(3);
    expect(reading.object.name).toEqual({ zh: 'M 4', en: 'M 4' }); // headline = primary display name
    expect(runner).toHaveBeenCalledOnce();
  });

  it('sizes circles by angular diameter and colors by category', async () => {
    const reading = await generateReading(factsheet, { ...base, runner: vi.fn().mockResolvedValue(tailoringJson) });
    const m4 = reading.features.find((f) => f.id === 'obj1')!;
    // 26' major @ 2.0"/px → radius (26*60/2.0)/2 = 390px
    expect(m4.circle.r).toBe(390);
    expect(m4.color_key).toBe('star'); // globular_cluster → star
    expect(m4.explanation.en).toBe('A globular cluster.');
  });

  it('shows proper names, falls back to the generic type label for survey designations', async () => {
    const reading = await generateReading(factsheet, { ...base, runner: vi.fn().mockResolvedValue(tailoringJson) });
    const antares = reading.features.find((f) => f.id === 'obj2')!;
    expect(antares.label).toEqual({ zh: 'Antares', en: 'Antares' });
    expect(antares.color_key).toBe('hot'); // star → hot
    expect(antares.circle.r).toBe(50); // no angular size → small star marker (min(4000,3000)/60)

    const cloud = reading.features.find((f) => f.id === 'obj3')!;
    expect(cloud.label).toEqual({ zh: '暗星云', en: 'Dark nebula' }); // PGCC junk → generic type
    expect(cloud.color_key).toBe('dark');
  });

  it('throws when the fact sheet has no objects (never fabricates)', async () => {
    const empty: FactSheet = { ...factsheet, objects: [] };
    await expect(generateReading(empty, { ...base, runner: vi.fn() })).rejects.toBeInstanceOf(
      ReaderError,
    );
  });
});

describe('readingFromFactsheet (facts-only stub, no LLM)', () => {
  it('builds grounded annotations with empty explanations', () => {
    const reading = readingFromFactsheet(factsheet, { toolVersion: '0.1.0' });
    expect(reading.features).toHaveLength(3);
    expect(reading.features[0]!.explanation).toEqual({ zh: '', en: '' });
    expect(reading.features[0]!.circle.r).toBe(390); // still sized from facts
    expect(reading.generator.llm).toContain('facts-only');
  });
});

/**
 * The object list in the studio's prompt used to give each feature's palette
 * slot as its type — Eta Carinae arrived as "(hot)", a dark cloud as "(dark)" —
 * which the model reads as a claim about the object.
 */
describe('tailorReading prompt', () => {
  const prompted = async (): Promise<string> => {
    const runner = vi.fn().mockResolvedValue(tailoringJson);
    const reading = readingFromFactsheet(factsheet, { toolVersion: '0.1.0' });
    await tailorReading(reading, { factsheet, runner });
    return (runner.mock.calls[0]![0] as { prompt: string }).prompt;
  };
  const listLines = (prompt: string): string[] =>
    prompt.split('\n').filter((l) => l.startsWith('  - id='));

  it('never names an object by its colour key', async () => {
    const lines = listLines(await prompted());
    expect(lines).toHaveLength(3);
    for (const k of ColorKey.options) {
      for (const l of lines) expect(l).not.toContain(`(${k})`);
    }
  });

  it('gives the real type, and a star its specific one', async () => {
    const lines = listLines(await prompted());
    expect(lines.find((l) => l.includes('id=obj1'))).toContain('(Globular cluster)');
    expect(lines.find((l) => l.includes('id=obj3'))).toContain('(Dark nebula)');
    expect(lines.find((l) => l.includes('id=obj2'))).not.toContain('(Star)');
  });

  it('leaves the type out when there is no fact sheet to take it from', async () => {
    const runner = vi.fn().mockResolvedValue(tailoringJson);
    await tailorReading(readingFromFactsheet(factsheet, { toolVersion: '0.1.0' }), { runner });
    const prompt = (runner.mock.calls[0]![0] as { prompt: string }).prompt;
    for (const l of listLines(prompt)) expect(l).not.toMatch(/\(\w+\)/);
  });
});
