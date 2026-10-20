import { describe, expect, it } from 'vitest';
import { ATLAS_TO_PIPELINE, LEGACY_ATLAS_TO_PIPELINE, atlasTypeFor } from '@astellum/identify';
import { FeatureType } from '@astellum/schema';
import { FEATURE_TYPES } from './featureTypes.js';

/**
 * The drawing vocabulary here and the pipeline taxonomy in @astellum/schema are
 * joined by a hand-written map over in identify, and the join fails quietly:
 * `pipelineType` falls back to `emission_color_region`, so a drawing type
 * nobody mapped turns every annotation of that kind into an "OIII/Hα region" in
 * coral — a wrong claim about the sky, with no error anywhere. Hence this test
 * rather than a comment asking the next person to remember.
 */
describe('atlas \u2194 pipeline vocabulary', () => {
  it('maps every drawing type the atlas offers', () => {
    const unmapped = FEATURE_TYPES.filter(
      (ft) => !(ft.key in ATLAS_TO_PIPELINE) && !(ft.key in LEGACY_ATLAS_TO_PIPELINE),
    ).map((ft) => ft.key);
    expect(unmapped).toEqual([]);
  });

  it('maps them to types the taxonomy actually has', () => {
    for (const [atlas, pipeline] of [
      ...Object.entries(ATLAS_TO_PIPELINE),
      ...Object.entries(LEGACY_ATLAS_TO_PIPELINE),
    ]) {
      expect(FeatureType.safeParse(pipeline).success, `${atlas} \u2192 ${pipeline}`).toBe(true);
    }
  });

  // The reverse map is derived by inverting ATLAS_TO_PIPELINE, so two keys
  // landing on one pipeline type would silently drop one of them. Retired keys
  // live in their own map precisely to keep this true.
  it('keeps the forward map one-to-one so the inverse is lossless', () => {
    const targets = Object.values(ATLAS_TO_PIPELINE);
    expect(new Set(targets).size).toBe(targets.length);
    for (const [atlas, pipeline] of Object.entries(ATLAS_TO_PIPELINE)) {
      expect(atlasTypeFor(pipeline)).toBe(atlas);
    }
  });

  it('never hands the atlas back a retired key', () => {
    const retired = new Set(Object.keys(LEGACY_ATLAS_TO_PIPELINE));
    for (const pipeline of Object.values(LEGACY_ATLAS_TO_PIPELINE)) {
      expect(retired.has(atlasTypeFor(pipeline))).toBe(false);
    }
  });

  it('still resolves annotations drawn with a retired key', () => {
    // Nothing validates feature_type on read, so these survive in overlays.
    expect(LEGACY_ATLAS_TO_PIPELINE['globule']).toBe('cometary_globule');
    expect(LEGACY_ATLAS_TO_PIPELINE['jet']).toBe('hh_jet');
  });

  it('offers only current types for drawing', () => {
    const drawable = FEATURE_TYPES.filter((ft) => !ft.legacy).map((ft) => ft.key);
    expect(drawable).not.toContain('globule');
    expect(drawable).not.toContain('jet');
    expect(drawable).toContain('elephant_trunk');
    expect(drawable).toContain('bipolar_lobe');
  });

  it('gives every drawable type both languages', () => {
    for (const ft of FEATURE_TYPES) {
      expect(ft.zh.length, ft.key).toBeGreaterThan(0);
      expect(ft.en.length, ft.key).toBeGreaterThan(0);
    }
  });
});
