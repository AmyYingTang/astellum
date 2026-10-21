import { describe, expect, it, beforeEach } from 'vitest';
import {
  FEATURE_NOTES,
  ContentOverlay,
  featureNoteFor,
  featureNoteKeys,
  setContentOverlay,
  BUILT_IN_STYLE_PRESETS,
  StylePreset,
} from './index.js';

beforeEach(() => setContentOverlay({}));

describe('curator content overlay', () => {
  it('falls back to the built-in wording when nothing is overridden', () => {
    expect(featureNoteFor('pillar')).toEqual(FEATURE_NOTES.pillar);
  });

  it('overrides one note without disturbing the others', () => {
    setContentOverlay({
      featureNotes: { bubble_shell: { zh: '改过的。', en: 'Overridden.' } },
    });
    expect(featureNoteFor('bubble_shell')!.zh).toBe('改过的。');
    expect(featureNoteFor('pillar')).toEqual(FEATURE_NOTES.pillar);
  });

  it('lets a deployment add a note for a type that had none', () => {
    expect(featureNoteFor('bok_globule')).toBeUndefined();
    setContentOverlay({ featureNotes: { bok_globule: { zh: '新增。', en: 'Added.' } } });
    expect(featureNoteFor('bok_globule')!.en).toBe('Added.');
    expect(featureNoteKeys()).toContain('bok_globule');
  });

  it('accepts a partial file — every section is optional', () => {
    expect(ContentOverlay.safeParse({}).success).toBe(true);
    expect(ContentOverlay.safeParse({ nicknames: { 'NGC 7000': { en: 'North America' } } }).success).toBe(
      true,
    );
  });

  it('rejects a note that is missing one language, rather than half-applying it', () => {
    expect(ContentOverlay.safeParse({ featureNotes: { pillar: { zh: '只有中文' } } }).success).toBe(
      false,
    );
  });
});

/**
 * Both the studio and the kiosk ask the audience question now, so the answer
 * list is here rather than in either client.
 */
describe('built-in style presets', () => {
  it('covers both groups the two surfaces group them by', () => {
    const groups = new Set(BUILT_IN_STYLE_PRESETS.map((p) => p.group));
    expect([...groups].sort()).toEqual(['audience', 'focus']);
  });

  it('is bilingual throughout — label and instruction alike', () => {
    for (const p of BUILT_IN_STYLE_PRESETS) {
      expect(StylePreset.parse(p)).toEqual(p);
      for (const s of [p.labelZh, p.labelEn, p.textZh, p.textEn]) expect(s.trim()).not.toBe('');
    }
  });

  it('has no duplicate ids, which a preset is picked by', () => {
    const ids = BUILT_IN_STYLE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
