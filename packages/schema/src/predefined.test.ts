import { describe, expect, it } from 'vitest';
import {
  FEATURE_NOTES,
  PredefinedLibrary,
  featureNote,
  findPredefined,
  mergeLibraries,
  missingElements,
  pickStyle,
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

  it('reports which of the five elements a style still lacks', () => {
    const missing = missingElements(entry.styles.general as never);
    expect(missing).toContain('culture');
    expect(missing).not.toContain('sense_of_scale');
    expect(missing).not.toContain('important_features');
  });
});

describe('generic feature notes', () => {
  it('covers exactly the 11 atlas drawing types', () => {
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
