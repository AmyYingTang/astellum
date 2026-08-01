import { describe, expect, it } from 'vitest';
import {
  AstrolensConfig,
  BUILTIN_PROFILES,
  mergeProfile,
  profileNames,
  resolveProfile,
} from './index.js';

describe('control file', () => {
  it('ships an offsite profile that is the AI/online poster workflow', () => {
    const p = BUILTIN_PROFILES.offsite!;
    expect(p.solve.mode).toBe('nova');
    expect(p.reading.mode).toBe('ai');
    expect(p.reading.customPrompt).toBe(true); // offsite's whole point is control
    expect(p.flow.ui).toBe('studio');
  });

  it('ships an onsite profile that is offline, predefined and precision-first', () => {
    const p = BUILTIN_PROFILES.onsite!;
    expect(p.solve.mode).toBe('local');
    expect(p.solve.hintFromTarget).toBe(true);
    // The static pack identifies the target; the snapshot replays what the
    // online services said about the same field, with no network either way.
    expect(p.catalog.sources).toEqual(['offline', 'snapshot']);
    expect(p.catalog.snapshotOnly).toBe(true);
    expect(p.reading.mode).toBe('predefined');
    expect(p.reading.switchableInKiosk).toBe(true);
    expect(p.select.dropContext).toBe(true);
    expect(p.select.requireAtlasForB).toBe(true);
    expect(p.flow.ui).toBe('kiosk');
  });

  it('merges a partial profile section-wise, keeping untouched knobs', () => {
    const merged = mergeProfile(BUILTIN_PROFILES.onsite!, { solve: { timeoutMs: 30_000 } });
    expect(merged.solve.timeoutMs).toBe(30_000);
    expect(merged.solve.mode).toBe('local'); // not restated, not lost
    expect(merged.reading.mode).toBe('predefined');
  });

  it('resolves the active profile from the file, applying its deltas', () => {
    const cfg = AstrolensConfig.parse({
      activeProfile: 'onsite',
      profiles: { onsite: { reading: { style: 'kids' }, select: { maxFeatures: 6 } } },
    });
    const p = resolveProfile(cfg);
    expect(p.reading.style).toBe('kids');
    expect(p.select.maxFeatures).toBe(6);
    expect(p.select.dropContext).toBe(true); // from the builtin baseline
  });

  it('accepts a user-invented profile name, based on offsite', () => {
    const cfg = AstrolensConfig.parse({
      activeProfile: 'museum',
      profiles: { museum: { flow: { ui: 'kiosk' } } },
    });
    const p = resolveProfile(cfg);
    expect(p.flow.ui).toBe('kiosk');
    expect(p.reading.mode).toBe('ai'); // offsite baseline
    expect(profileNames(cfg)).toContain('museum');
  });

  it('defaults to offsite with no config file at all', () => {
    const cfg = AstrolensConfig.parse({});
    expect(cfg.activeProfile).toBe('offsite');
    expect(resolveProfile(cfg).reading.mode).toBe('ai');
  });
});
