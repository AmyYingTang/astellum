import { describe, expect, it } from 'vitest';
import {
  FEATURE_NOTES,
  PredefinedLibrary,
  featureNote,
  findPredefined,
  mergeLibraries,
  missingElements,
  pickStyle,
  upsertStyles,
  PredefinedReading,
  ROLE_IDS,
} from './index.js';

const entry = {
  schema_version: 1 as const,
  primary_id: 'B 33',
  aliases: ['Horsehead Nebula', 'IC 434'],
  styles: {
    general: {
      narrative: { zh: '猎户座里的一团冷暗云。', en: 'A cold dark cloud in Orion.' },
      scale: { zh: '在银河系里,约 1300 光年。', en: 'Inside the Milky Way, about 1,300 light-years away.' },
      fun_facts: [{ zh: '它正在被慢慢吹散。', en: 'It is slowly being blown away.' }],
      features: [
        {
          annotation_id: 'anno_abc',
          explanation: { zh: '马头的“鬃毛”。', en: "The horse's mane." },
        },
      ],
    },
  },
};

const lib = (): PredefinedLibrary => PredefinedLibrary.parse({ schema_version: 1, entries: [entry] });

describe('predefined readings', () => {
  it('finds an entry by any alias, ignoring spacing and case', () => {
    expect(findPredefined(lib(), ['ic434'])?.primary_id).toBe('B 33');
    expect(findPredefined(lib(), ['B33'])?.primary_id).toBe('B 33');
    expect(findPredefined(lib(), ['M 42'])).toBeUndefined();
  });

  it('overlays a user library on the baseline, per style', () => {
    const overlay = PredefinedLibrary.parse({
      schema_version: 1,
      entries: [
        {
          schema_version: 1,
          primary_id: 'B33',
          aliases: ['Barnard 33'],
          styles: { kids: { narrative: { zh: '像一匹马。', en: 'It looks like a horse.' } } },
        },
      ],
    });
    const merged = mergeLibraries([lib(), overlay]);
    expect(merged.entries).toHaveLength(1); // same target, unioned
    const e = merged.entries[0]!;
    expect(Object.keys(e.styles).sort()).toEqual(['general', 'kids']);
    expect(e.aliases).toContain('Barnard 33');
  });

  it('degrades to an available style rather than failing', () => {
    expect(pickStyle(entry, 'general')?.name).toBe('general');
    expect(pickStyle(entry, 'kids')?.name).toBe('general'); // requested one absent
    expect(pickStyle({ ...entry, styles: {} })).toBeUndefined();
  });

  /*
   * A role is a style key, and this chain is what makes the three roles free:
   * one `general` version answers all of them until somebody wants to write
   * for a role separately.
   */
  it('answers every role from the catch-all until a role is written for', () => {
    for (const role of ROLE_IDS) expect(pickStyle(entry, role)?.name).toBe('general');
    const withRole = {
      ...entry,
      styles: {
        ...entry.styles,
        teacher: { fun_facts: [], features: [], narrative: { zh: '机制:', en: 'Mechanism:' } },
      },
    };
    expect(pickStyle(withRole, 'teacher')?.name).toBe('teacher');
    expect(pickStyle(withRole, 'primary')?.name).toBe('general'); // still unwritten
  });
});

/**
 * Saving one role must not delete the others. Harmless while `general` was the
 * only style; a data-loss bug the moment a curator writes for two roles.
 */
describe('saving one role', () => {
  const base = PredefinedReading.parse({
    schema_version: 1,
    primary_id: 'NGC 3372',
    styles: {
      general: { narrative: { zh: '通用', en: 'General' } },
      teacher: { narrative: { zh: '老师', en: 'Teacher' }, culture: { zh: '神话', en: 'Myth' } },
    },
  });

  it('leaves the roles it was not editing alone', () => {
    const next = PredefinedReading.parse({
      schema_version: 1,
      primary_id: 'NGC 3372',
      styles: { primary: { narrative: { zh: '小学生', en: 'Kids' } } },
    });
    const saved = upsertStyles(base, next);
    expect(Object.keys(saved.styles).sort()).toEqual(['general', 'primary', 'teacher']);
    expect(saved.styles.teacher?.culture?.en).toBe('Myth');
  });

  it('still lets a field be cleared inside the role being edited', () => {
    const next = PredefinedReading.parse({
      schema_version: 1,
      primary_id: 'NGC 3372',
      styles: { teacher: { narrative: { zh: '改过的', en: 'Rewritten' } } },
    });
    const saved = upsertStyles(base, next);
    expect(saved.styles.teacher?.narrative?.en).toBe('Rewritten');
    expect(saved.styles.teacher?.culture).toBeUndefined(); // cleared, not merged back
  });

  it('is an ordinary save when there was nothing there before', () => {
    expect(Object.keys(upsertStyles(undefined, base).styles).sort()).toEqual([
      'general',
      'teacher',
    ]);
  });

  it('reports which of the five elements a style still lacks', () => {
    const missing = missingElements(entry.styles.general as never);
    expect(missing).toContain('culture');
    expect(missing).not.toContain('sense_of_scale');
    expect(missing).not.toContain('important_features');
  });
});

describe('generic feature notes', () => {
  // The four types the 2026-10 split added (elephant_trunk, bok_globule,
  // ansae_flier, bipolar_lobe) deliberately have no note yet — they fall
  // through to the fact template and are marked ※ onsite. Add them here when
  // the words exist; this list is what stops one going missing by accident.
  it('covers the drawing types that have a note written', () => {
    expect(Object.keys(FEATURE_NOTES).sort()).toEqual(
      [
        'bubble_shell',
        'cometary_globule',
        'dust_lane',
        'emission_color_region',
        'hh_jet',
        'ionization_front',
        'pillar',
        'silhouette_shape',
        'shock_front',
        'snr_filament',
        'spiral_arm',
        'tidal_tail',
      ].sort(),
    );
  });

  it('is bilingual and non-empty throughout', () => {
    for (const [key, note] of Object.entries(FEATURE_NOTES)) {
      expect(note!.zh.length, `${key} zh`).toBeGreaterThan(20);
      expect(note!.en.length, `${key} en`).toBeGreaterThan(20);
    }
  });

  it('stays out of jargon the onsite audience would not follow', () => {
    const all = Object.values(FEATURE_NOTES)
      .map((n) => `${n!.zh} ${n!.en}`)
      .join(' ');
    for (const jargon of ['horizontal branch', 'HB', 'FLIER', 'ansae', 'otype', 'Frangi']) {
      expect(all).not.toContain(jargon);
    }
  });

  it('looks up by pipeline feature type', () => {
    expect(featureNote('pillar')).toBeDefined();
    expect(featureNote('stellar_population')).toBeUndefined(); // A-class, not drawn onsite
  });
});

describe('overlaying a shipped reading', () => {
  const shipped = PredefinedLibrary.parse({
    schema_version: 1,
    entries: [
      {
        schema_version: 1,
        primary_id: 'M 42',
        styles: {
          general: {
            narrative: { zh: '原始导读。', en: 'Shipped narrative.' },
            scale: { zh: '原始尺度。', en: 'Shipped scale.' },
            culture: { zh: '原始文化。', en: 'Shipped culture.' },
            fun_facts: [{ zh: '原始冷知识。', en: 'Shipped fact.' }],
            features: [
              { annotation_id: 'anno_a', explanation: { zh: '原始 A。', en: 'Shipped A.' } },
              { annotation_id: 'anno_b', explanation: { zh: '原始 B。', en: 'Shipped B.' } },
            ],
          },
        },
      },
    ],
  });

  it('keeps everything the deployment did not rewrite', () => {
    // The realistic edit: fix one sentence, leave the rest alone.
    const mine = PredefinedLibrary.parse({
      schema_version: 1,
      entries: [
        {
          schema_version: 1,
          primary_id: 'M 42',
          styles: { general: { narrative: { zh: '我改过的导读。', en: 'My narrative.' } } },
        },
      ],
    });
    const s = mergeLibraries([shipped, mine]).entries[0]!.styles.general!;
    expect(s.narrative!.zh).toBe('我改过的导读。');
    expect(s.scale!.zh).toBe('原始尺度。'); // not restated, not lost
    expect(s.culture!.zh).toBe('原始文化。');
    expect(s.fun_facts).toHaveLength(1);
    expect(s.features).toHaveLength(2);
  });

  it('replaces one annotation’s text and leaves its siblings', () => {
    const mine = PredefinedLibrary.parse({
      schema_version: 1,
      entries: [
        {
          schema_version: 1,
          primary_id: 'M 42',
          styles: {
            general: {
              features: [{ annotation_id: 'anno_b', explanation: { zh: '我改过的 B。', en: 'My B.' } }],
            },
          },
        },
      ],
    });
    const s = mergeLibraries([shipped, mine]).entries[0]!.styles.general!;
    expect(s.features.find((f) => f.annotation_id === 'anno_a')!.explanation.zh).toBe('原始 A。');
    expect(s.features.find((f) => f.annotation_id === 'anno_b')!.explanation.zh).toBe('我改过的 B。');
  });

  it('lets a deployment add text for an annotation the baseline never covered', () => {
    const mine = PredefinedLibrary.parse({
      schema_version: 1,
      entries: [
        {
          schema_version: 1,
          primary_id: 'M 42',
          styles: {
            general: {
              features: [{ annotation_id: 'anno_new', explanation: { zh: '新的。', en: 'New.' } }],
            },
          },
        },
      ],
    });
    const s = mergeLibraries([shipped, mine]).entries[0]!.styles.general!;
    expect(s.features).toHaveLength(3);
  });

  it('adds a whole target the baseline does not have', () => {
    const mine = PredefinedLibrary.parse({
      schema_version: 1,
      entries: [
        {
          schema_version: 1,
          primary_id: 'My Target',
          styles: { general: { narrative: { zh: '自己加的。', en: 'Mine.' } } },
        },
      ],
    });
    const merged = mergeLibraries([shipped, mine]);
    expect(merged.entries.map((e) => e.primary_id)).toEqual(['M 42', 'My Target']);
  });
});
