import { describe, expect, it } from 'vitest';
import type { FactSheet } from '@astellum/schema';
import { dropFieldRings, readingFromFactsheet } from './index.js';

/**
 * The Carina Nebula is 3½° across; the picture that prompted this covers
 * 2.7° by 1.8°. A ring at any size is a claim about where the nebula ends,
 * and this frame does not contain that boundary.
 */
const sheet = (sizeArcmin: number): FactSheet =>
  ({
    version: '1.0',
    image: { src: 'i.jpg', width: 4144, height: 2822, hash: 'h' },
    solve: { status: 'solved', pixscale_arcsec: 2.334 },
    objects: [
      {
        id: 'o1',
        names: ['NGC 3372'],
        designations: ['NGC 3372'],
        category: 'emission_nebula',
        type: { zh: '发射星云', en: 'Emission nebula' },
        tier: 'A',
        confidence: 1,
        size_arcmin: [sizeArcmin, sizeArcmin],
        coord: { ra: 161, dec: -59.7, pixel: [2072, 1411] },
        detection_source: 'catalog',
        needs_human_review: false,
      },
    ],
    warnings: [],
  }) as unknown as FactSheet;

describe('a subject wider than the frame', () => {
  it('gets no ring, because no ring here could enclose it', () => {
    const r = readingFromFactsheet(sheet(210), { toolVersion: 't' });
    expect(r.features[0]!.shape).toBe('field');
  });

  it('still gets its number and its name', () => {
    const r = readingFromFactsheet(sheet(210), { toolVersion: 't' });
    expect(r.features[0]!.badge.num).toBe('1');
    expect(r.features[0]!.label.en.length).toBeGreaterThan(0);
  });

  it('leaves an object that does fit alone', () => {
    const r = readingFromFactsheet(sheet(20), { toolVersion: 't' });
    expect(r.features[0]!.shape).toBe('circle');
  });
});

describe('a reading written before the rule', () => {
  const old = (sizeArcmin: number) => {
    const r = readingFromFactsheet(sheet(sizeArcmin), { toolVersion: 't' });
    return { ...r, features: r.features.map((f) => ({ ...f, shape: 'circle' as const })) };
  };

  it('loses the ring it should never have had', () => {
    expect(dropFieldRings(old(210), sheet(210)).features[0]!.shape).toBe('field');
  });

  it('keeps a ring around something the frame does contain', () => {
    const r = old(20);
    expect(dropFieldRings(r, sheet(20))).toBe(r);
  });
});

// An English name reads fine in a Chinese label; the reverse does not.
describe('a common name known only in Chinese', () => {
  it('does not become the English label', () => {
    const s = sheet(20);
    (s.objects[0] as { common_name?: { zh?: string; en?: string } }).common_name = { zh: '船底座星云' };
    const label = readingFromFactsheet(s, { toolVersion: 't' }).features[0]!.label;
    expect(label.zh).toBe('船底座星云');
    expect(label.en).toBe('NGC 3372');
  });
});
