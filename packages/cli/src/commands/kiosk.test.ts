import { describe, expect, it } from 'vitest';
import type { FactSheet, FactSheetObject } from '@astellum/schema';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trimForKiosk, loadFrameRecord } from './kiosk.js';
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

/**
 * What the role switch turns on.
 *
 * It is a per-frame fact, not a configuration one: a deployment can be set to
 * write on the night and still have offline frames sitting in its workdir from
 * earlier, and offering the switch on a frame the model wrote would replace its
 * prose with the library's at a touch, in front of a room.
 */
describe('what a frame remembers about itself', () => {
  const dir = async (record: unknown): Promise<string> => {
    const d = await mkdtemp(join(tmpdir(), 'astellum-frame-'));
    if (record !== undefined) {
      await writeFile(join(d, 'frame.json'), JSON.stringify(record), 'utf8');
    }
    return d;
  };

  it('reads back how it was written and for whom', async () => {
    expect(await loadFrameRecord(await dir({ source: 'predefined', role: 'teacher' }))).toEqual({
      source: 'predefined',
      role: 'teacher',
    });
  });

  it('says nothing for a directory an older version wrote', async () => {
    expect(await loadFrameRecord(await dir(undefined))).toBeNull();
  });

  /*
   * Nothing, rather than a guess: the caller's fallback is to show the frame as
   * it stands, which is always safe. Guessing `predefined` here would re-read a
   * frame the model may have written.
   */
  it('refuses a record it cannot believe', async () => {
    expect(await loadFrameRecord(await dir({ role: 'adult' }))).toBeNull();
    expect(await loadFrameRecord(await dir({ source: 'something-else' }))).toBeNull();
  });

  it('falls back to the default role when only the source was recorded', async () => {
    expect(await loadFrameRecord(await dir({ source: 'ai' }))).toEqual({
      source: 'ai',
      role: 'adult',
    });
  });
});
