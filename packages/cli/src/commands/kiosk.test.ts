import { describe, expect, it } from 'vitest';
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
