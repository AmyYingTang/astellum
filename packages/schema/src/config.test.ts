import { describe, expect, it } from 'vitest';
import {
  AstrolensConfig,
  BUILTIN_PROFILES,
  mergeProfile,
  profileNames,
  resolveProfile,
} from './index.js';

describe('control file', () => {
  it('ships a studio profile that is the AI/online poster workflow', () => {
    const p = BUILTIN_PROFILES.studio!;
    expect(p.solve.mode).toBe('nova');
    expect(p.reading.mode).toBe('ai');
    expect(p.reading.customPrompt).toBe(true); // control is the studio's whole point
    expect(p.flow.ui).toBe('studio');
  });

  it('ships a kiosk profile that is offline, predefined and precision-first', () => {
    const p = BUILTIN_PROFILES.kiosk!;
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
    const merged = mergeProfile(BUILTIN_PROFILES.kiosk!, { solve: { timeoutMs: 30_000 } });
    expect(merged.solve.timeoutMs).toBe(30_000);
    expect(merged.solve.mode).toBe('local'); // not restated, not lost
    expect(merged.reading.mode).toBe('predefined');
  });

  it('resolves the active profile from the file, applying its deltas', () => {
    const cfg = AstrolensConfig.parse({
      activeProfile: 'kiosk',
      profiles: { kiosk: { reading: { style: 'kids' }, select: { maxFeatures: 6 } } },
    });
    const p = resolveProfile(cfg);
    expect(p.reading.style).toBe('kids');
    expect(p.select.maxFeatures).toBe(6);
    expect(p.select.dropContext).toBe(true); // from the builtin baseline
  });

  it('accepts a user-invented profile name, based on studio', () => {
    const cfg = AstrolensConfig.parse({
      activeProfile: 'museum',
      profiles: { museum: { flow: { ui: 'kiosk' } } },
    });
    const p = resolveProfile(cfg);
    expect(p.flow.ui).toBe('kiosk');
    expect(p.reading.mode).toBe('ai'); // studio baseline
    expect(profileNames(cfg)).toContain('museum');
  });

  it('defaults to studio with no config file at all', () => {
    const cfg = AstrolensConfig.parse({});
    expect(cfg.activeProfile).toBe('studio');
    expect(resolveProfile(cfg).reading.mode).toBe('ai');
  });
});

describe('profile names', () => {
  it('still resolves a config written when the profiles were offsite/onsite', () => {
    const cfg = AstrolensConfig.parse({
      activeProfile: 'onsite',
      profiles: { onsite: { select: { maxFeatures: 4 } } },
    });
    const p = resolveProfile(cfg);
    expect(p.reading.mode).toBe('predefined'); // the kiosk baseline
    expect(p.select.maxFeatures).toBe(4); // and its deltas
  });

  it('handles a half-migrated file: new name active, old name holding the deltas', () => {
    const cfg = AstrolensConfig.parse({
      activeProfile: 'kiosk',
      profiles: { onsite: { select: { maxFeatures: 7 } } },
    });
    expect(resolveProfile(cfg).select.maxFeatures).toBe(7);
  });

  it('does not offer the old names as choices', () => {
    const cfg = AstrolensConfig.parse({ profiles: { onsite: {} } });
    expect(profileNames(cfg).sort()).toEqual(['kiosk', 'studio']);
  });
});
