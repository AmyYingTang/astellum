import { describe, expect, it } from 'vitest';
import { Registry } from '@astellum/schema';
import { buildDraftPrompt, draftPredefinedStyle, draftToEntry, draftWordCount } from './draft.js';

const registry = Registry.parse({
  schema_version: 1,
  objects: [
    {
      primary_id: 'NGC 3372',
      aliases: ['Carina Nebula'],
      annotations: [
        {
          id: 'anno_rim',
          feature_type: 'bright_rim',
          geometry: { type: 'polyline', vertices: [[160, -60], [161, -60.1]] },
          label: { zh: '电离锋面', en: 'Ionization front' },
          note: { zh: '正对海山二那一侧。', en: 'The side facing Eta Carinae.' },
        },
        {
          id: 'anno_lane',
          feature_type: 'dust_lane',
          geometry: { type: 'polyline', vertices: [[160.5, -59.9], [160.8, -59.8]] },
          label: { zh: '', en: '' },
        },
      ],
    },
  ],
});
const entry = registry.objects[0]!;

const goodJson = JSON.stringify({
  narrative: { zh: '南天最大的一片恒星育婴房。', en: 'The largest stellar nursery in the southern sky.' },
  scale: { zh: '在银河系内,约 7500 光年。', en: 'Inside the Milky Way, about 7,500 light-years away.' },
  culture: { zh: '「船底」是阿尔戈号的龙骨。', en: 'Carina is the keel of the Argo.' },
  fun_facts: [{ zh: '海山二曾短暂成为全天第二亮星。', en: 'Eta Carinae was briefly the second-brightest star.' }],
  features: [
    { annotation_id: 'anno_rim', explanation: { zh: '被紫外线点亮的边界。', en: 'An edge lit by ultraviolet light.' } },
    { annotation_id: 'anno_lane', explanation: { zh: '挡光的尘埃带。', en: 'A dust lane blocking the light.' } },
  ],
});

describe('drafting a predefined reading', () => {
  it('puts every annotation id in the prompt, with its label and curator note', () => {
    const p = buildDraftPrompt(entry, 'general');
    expect(p).toContain('annotation_id=anno_rim');
    expect(p).toContain('annotation_id=anno_lane');
    expect(p).toContain('正对海山二那一侧。'); // the curator's note is context
    expect(p).toContain('8–12 年级'); // the agreed reading level
  });

  it('asks for all five elements, scale explicitly', () => {
    const p = buildDraftPrompt(entry, 'general');
    for (const k of ['property_and_position', 'sense_of_scale', 'important_features', 'culture', 'fun_facts']) {
      expect(p).toContain(k);
    }
    expect(p).toContain('银河系内');
  });

  it('parses a well-formed draft', async () => {
    const s = await draftPredefinedStyle(entry, { runner: async () => goodJson });
    expect(s.narrative.zh).toContain('育婴房');
    expect(s.features).toHaveLength(2);
    expect(draftWordCount(s)).toBeGreaterThan(0);
  });

  it('tolerates the model wrapping its JSON in prose', async () => {
    const s = await draftPredefinedStyle(entry, {
      runner: async () => 'Here you go:\n```json\n' + goodJson + '\n```\nHope that helps!',
    });
    expect(s.features).toHaveLength(2);
  });

  it('drops features the model invented an id for', async () => {
    const withExtra = JSON.parse(goodJson);
    withExtra.features.push({
      annotation_id: 'anno_does_not_exist',
      explanation: { zh: '编的。', en: 'Invented.' },
    });
    const s = await draftPredefinedStyle(entry, { runner: async () => JSON.stringify(withExtra) });
    expect(s.features.map((f) => f.annotation_id)).toEqual(['anno_rim', 'anno_lane']);
  });

  it('fails loudly on a shape mismatch rather than half-writing', async () => {
    await expect(
      draftPredefinedStyle(entry, { runner: async () => '{"narrative":"not localized"}' }),
    ).rejects.toThrow(/did not match the schema/);
  });

  it('marks the result as an unreviewed draft', async () => {
    const s = await draftPredefinedStyle(entry, { runner: async () => goodJson });
    const e = draftToEntry(entry, 'general', s, '2026-08-01T00:00:00.000Z');
    expect(e.source).toBe('ai_draft');
    expect(e.primary_id).toBe('NGC 3372');
    expect(e.aliases).toContain('Carina Nebula');
    expect(Object.keys(e.styles)).toEqual(['general']);
  });
});
