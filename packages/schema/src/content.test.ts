import { describe, expect, it, beforeEach } from 'vitest';
import {
  FEATURE_NOTES,
  ContentOverlay,
  featureNoteFor,
  featureNoteKeys,
  setContentOverlay,
  BUILT_IN_STYLE_PRESETS,
  StylePreset,
  ROLE_IDS,
  DEFAULT_ROLE,
  rolePresets,
  focusPresets,
  stylePresets,
  defaultRoleId,
  isRoleId,
  roleOfReading,
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

/**
 * The roles are the one axis that crosses the offline/online line: offline a
 * role is a style key in the predefined library, online it is the sentence the
 * model is given about its reader. Both surfaces ask it, so it is asserted
 * here rather than in either of them.
 */
describe('reading roles', () => {
  it('ships exactly the three roles, in the order they are offered', () => {
    expect(rolePresets().map((r) => r.id)).toEqual([...ROLE_IDS]);
  });

  it('starts in the general adult visitor, who is most of a room', () => {
    expect(DEFAULT_ROLE).toBe('adult');
    expect(defaultRoleId()).toBe('adult');
  });

  it('keeps tone out of the roles — playful is a focus, not an audience', () => {
    expect(focusPresets().map((f) => f.id)).toContain('humor');
    expect(rolePresets().map((r) => r.id)).not.toContain('humor');
  });

  it('resolves the overlay over the built-ins once, for every surface', () => {
    expect(stylePresets()).toEqual(BUILT_IN_STYLE_PRESETS);
    const mine: StylePreset = {
      id: 'adult',
      group: 'audience',
      labelZh: '改过的',
      labelEn: 'Mine',
      textZh: '写给成年人',
      textEn: 'For adults',
    };
    setContentOverlay({ stylePresets: [mine] });
    expect(stylePresets()).toEqual([mine]);
    expect(rolePresets()).toEqual([mine]);
  });

  it('opens in the first role an overlay does offer, when it dropped the default', () => {
    setContentOverlay({
      stylePresets: [
        {
          id: 'teacher',
          group: 'audience',
          labelZh: '老师',
          labelEn: 'Teacher',
          textZh: '写给老师',
          textEn: 'For teachers',
        },
      ],
    });
    expect(defaultRoleId()).toBe('teacher');
  });

  /*
   * A role travels in query strings and request bodies, and arrives at
   * `pickStyle` as a style key. An unknown one would not fail there — it would
   * degrade to the catch-all text under a role name nobody chose — so it is
   * refused at the door instead.
   */
  it('refuses a role nothing offers, and keeps accepting the built-in ids', () => {
    expect(isRoleId('adult')).toBe(true);
    expect(isRoleId('kids')).toBe(false); // the old audience preset
    expect(isRoleId('general')).toBe(false); // the catch-all is not a role
    expect(isRoleId(undefined)).toBe(false);
    setContentOverlay({
      stylePresets: [
        {
          id: 'mine',
          group: 'audience',
          labelZh: '我的',
          labelEn: 'Mine',
          textZh: '写给我',
          textEn: 'For me',
        },
      ],
    });
    expect(isRoleId('mine')).toBe(true);
    // Still true: a frame written before the overlay narrowed the list has to
    // keep resolving.
    expect(isRoleId('adult')).toBe(true);
  });
});

describe('roleOfReading', () => {
  const roles = BUILT_IN_STYLE_PRESETS.filter((p) => p.group === 'audience');
  const teacher = roles.find((p) => p.id === 'teacher')!;

  it('takes the recorded role', () => {
    expect(roleOfReading({ role: 'primary', tone: teacher.textEn }, roles)).toBe('primary');
  });

  // Readings from before the field: the role's text leads the tone, with any
  // focus presets and free text after it.
  it('recognises the role an older reading was written for, in either language', () => {
    expect(roleOfReading({ tone: `${teacher.textEn}\nMore history, please.` }, roles)).toBe('teacher');
    expect(roleOfReading({ tone: teacher.textZh }, roles)).toBe('teacher');
  });

  it('does not guess from wording it does not recognise', () => {
    expect(roleOfReading({ tone: 'Target audience is secondary school science teachers.' }, roles)).toBeUndefined();
    expect(roleOfReading({}, roles)).toBeUndefined();
    expect(roleOfReading({ role: 'nobody' }, roles)).toBeUndefined();
  });
});
