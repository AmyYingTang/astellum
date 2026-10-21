import { describe, expect, it } from 'vitest';
import type { FactSheet, FactSheetObject } from '@astellum/schema';
import { trimForKiosk } from './kiosk.js';
import { targetFromFilename } from './kiosk.js';

describe('target from a stacking program filename', () => {
  it('picks the catalogue designation out of common naming patterns', () => {
    expect(targetFromFilename('M42_300s_stack.tif')).toBe('M42');
    expect(targetFromFilename('NGC 7000-Ha-120x180s.fit')).toBe('NGC 7000');
    expect(targetFromFilename('2026-08-01_Sh2-155_stacked.png')).toBe('Sh2-155');
    // The trailing letter is kept on purpose: IC 1396A (the Elephant Trunk) is
    // a real designation, and a different object from IC 1396 as a whole.
    expect(targetFromFilename('/tmp/out/IC1396a_final.jpg')).toBe('IC1396a');
    expect(targetFromFilename('b33_horsehead.jpg')).toBe('b33');
  });

  it('gives up rather than guessing when there is no designation', () => {
    expect(targetFromFilename('stack_final_v3.tif')).toBeUndefined();
    expect(targetFromFilename('IMG_0421.jpg')).toBeUndefined();
  });
});

/**
 * The same filter runs when a frame is first built and when it comes back in
 * another style, so "the same frame, different words" is actually true.
 */
describe('what a kiosk frame keeps', () => {
  const obj = (over: Partial<FactSheetObject> & { id: string }): FactSheetObject =>
    ({
      id: over.id,
      name: { zh: over.id, en: over.id },
      tier: 'A',
      role: 'subject',
      otype: 'Neb',
      coord: {},
      ...over,
    }) as FactSheetObject;
  const sheet = (objects: FactSheetObject[]): FactSheet =>
    ({
      version: '1.0',
      image: { src: 'image.jpg', width: 100, height: 100, hash: 'x', band: 'unknown', starless: false },
      solve: { status: 'solved' },
      objects,
      warnings: [],
    }) as unknown as FactSheet;
  const cfg = { dropContext: true, requireAtlasForB: true, maxFeatures: 2, idleResetSec: 0, switchableStyle: true, readingSource: 'predefined' } as const;

  it('drops the incidental, and the unapproved morphology with it', () => {
    const out = trimForKiosk(
      sheet([
        obj({ id: 'subject' }),
        obj({ id: 'bystander', role: 'context' }),
        obj({ id: 'guessed', tier: 'B', detection_source: 'cv' }),
        obj({ id: 'drawn', tier: 'B', detection_source: 'atlas' }),
      ]),
      cfg,
    );
    expect(out.objects.map((o) => o.id)).toEqual(['subject', 'drawn']);
  });

  it('caps the morphology but never the catalogue objects', () => {
    const out = trimForKiosk(
      sheet([
        obj({ id: 'a' }),
        obj({ id: 'b' }),
        obj({ id: 'c' }),
        ...['m1', 'm2', 'm3'].map((id) => obj({ id, tier: 'B', detection_source: 'atlas' })),
      ]),
      cfg,
    );
    expect(out.objects.map((o) => o.id)).toEqual(['a', 'b', 'c', 'm1', 'm2']);
  });

  it('leaves everything else about the frame alone', () => {
    const s = sheet([obj({ id: 'a' })]);
    const out = trimForKiosk(s, cfg);
    expect(out.image).toBe(s.image);
    expect(out.solve).toBe(s.solve);
  });
});
