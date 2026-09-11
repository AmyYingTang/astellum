import { describe, expect, it } from 'vitest';
import { AstellumConfig, DEFAULT_CONFIG, PartialConfig, fromLegacyProfiles, mergeConfig } from './index.js';

describe('control file', () => {
  it('is usable with no file at all', () => {
    expect(DEFAULT_CONFIG.solve.mode).toBe('nova');
    expect(DEFAULT_CONFIG.reading.mode).toBe('ai');
    // The kiosk's presentation defaults are opinionated: few, confident labels.
    expect(DEFAULT_CONFIG.kiosk.dropContext).toBe(true);
    expect(DEFAULT_CONFIG.kiosk.requireAtlasForB).toBe(true);
  });

  it('merges a partial file section-wise, keeping untouched settings', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, PartialConfig.parse({ solve: { mode: 'local' } }));
    expect(merged.solve.mode).toBe('local');
    expect(merged.solve.cache).toBe(true); // not restated, not lost
    expect(merged.reading.mode).toBe('ai');
  });

  it('accepts a file that sets one thing', () => {
    expect(PartialConfig.safeParse({ reading: { mode: 'predefined' } }).success).toBe(true);
    expect(PartialConfig.safeParse({}).success).toBe(true);
  });

  it('rejects a value outside the enum rather than silently ignoring it', () => {
    expect(PartialConfig.safeParse({ solve: { mode: 'astap' } }).success).toBe(false);
  });
});

describe('a config written before the profiles were flattened', () => {
  const legacy = {
    version: 1,
    activeProfile: 'kiosk',
    profiles: {
      studio: { solve: { mode: 'nova' } },
      kiosk: {
        solve: { mode: 'local' },
        catalog: { sources: ['offline'] },
        reading: { mode: 'predefined', style: 'kids' },
        select: { maxFeatures: 6, dropContext: true },
        flow: { idleResetSec: 90 },
      },
    },
  };

  it('carries the active profile forward instead of resetting to defaults', () => {
    const p = fromLegacyProfiles(legacy)!;
    expect(p.solve?.mode).toBe('local');
    expect(p.reading?.style).toBe('kids');
  });

  it('moves what became kiosk settings into the kiosk section', () => {
    const p = fromLegacyProfiles(legacy)!;
    expect(p.kiosk?.maxFeatures).toBe(6);
    expect(p.kiosk?.idleResetSec).toBe(90);
  });

  it('leaves a already-flat file alone', () => {
    expect(fromLegacyProfiles({ solve: { mode: 'local' } })).toBeNull();
    expect(fromLegacyProfiles(null)).toBeNull();
  });

  it('produces something the schema accepts', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, fromLegacyProfiles(legacy)!);
    expect(AstellumConfig.safeParse(merged).success).toBe(true);
    expect(merged.catalog.sources).toEqual(['offline']);
  });
});
