import { describe, expect, it, beforeEach } from 'vitest';
import {
  FEATURE_NOTES,
  ContentOverlay,
  featureNoteFor,
  featureNoteKeys,
  setContentOverlay,
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
