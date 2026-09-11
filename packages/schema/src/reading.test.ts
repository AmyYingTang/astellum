import { describe, expect, it } from 'vitest';
import { Reading, COLOR_PALETTE, ColorKey } from './index.js';

const validReading = {
  version: '2.0',
  image: { src: 'image.jpg', width: 4144, height: 2822 },
  object: { name: { zh: 'Sh2-308', en: 'Sh2-308' }, type: { zh: 'WR 气泡', en: 'WR bubble' } },
  narrative: { zh: '一个由沃尔夫-拉叶星吹出的蓝色气泡。', en: 'A blue bubble blown by a Wolf–Rayet star.' },
  features: [
    {
      id: 'f1',
      label: { zh: '中央 WR 星', en: 'Central WR star' },
      color_key: 'hot',
      circle: { cx: 100, cy: 200, r: 50 },
      badge: { num: '1' },
      explanation: { zh: '这是一颗即将爆发的大质量恒星。', en: 'A massive star nearing its end.' },
    },
  ],
  created_at: '2026-05-27T00:00:00.000Z',
  generator: { tool: 'astellum', tool_version: '0.1.0', llm: 'claude-opus-4-x' },
};

describe('Reading schema', () => {
  it('parses a valid reading and applies defaults', () => {
    const parsed = Reading.parse(validReading);
    expect(parsed.display_language).toBe('zh');
    expect(parsed.object.aliases).toEqual([]);
    expect(parsed.extra_facts).toEqual([]);
    expect(parsed.features[0]!.badge.offset_x).toBe(0);
    expect(parsed.features[0]!.badge.bubble_r).toBe(30);
    expect(parsed.features[0]!.fact_ref).toBeNull();
    expect(parsed.features[0]!.needs_human_review).toBe(false);
  });

  it('keeps both languages on bilingual fields', () => {
    const parsed = Reading.parse(validReading);
    expect(parsed.object.type).toEqual({ zh: 'WR 气泡', en: 'WR bubble' });
    expect(parsed.features[0]!.label.en).toBe('Central WR star');
  });

  it('round-trips through JSON without loss', () => {
    const parsed = Reading.parse(validReading);
    const reparsed = Reading.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });

  it('rejects an unknown color_key', () => {
    const bad = structuredClone(validReading);
    bad.features[0]!.color_key = 'rainbow';
    expect(() => Reading.parse(bad)).toThrow();
  });

  it('rejects a monolingual string where bilingual is required', () => {
    const bad = structuredClone(validReading) as unknown as { object: { type: unknown } };
    bad.object.type = 'WR bubble';
    expect(() => Reading.parse(bad)).toThrow();
  });

  it('rejects a stage outside 1-7', () => {
    const bad = structuredClone(validReading) as typeof validReading & {
      object: { stage?: number };
    };
    bad.object.stage = 9;
    expect(() => Reading.parse(bad)).toThrow();
  });

  it('still opens readings written under the old name, as astellum', () => {
    const old = structuredClone(validReading);
    old.generator.tool = 'astrolens';
    expect(Reading.parse(old).generator.tool).toBe('astellum');
  });

  it('rejects an unknown generator tool', () => {
    const bad = structuredClone(validReading);
    bad.generator.tool = 'something-else';
    expect(() => Reading.parse(bad)).toThrow();
  });

  it('rejects a wrong version literal', () => {
    const bad = structuredClone(validReading) as typeof validReading & { version: string };
    bad.version = '1.0';
    expect(() => Reading.parse(bad)).toThrow();
  });
});

describe('color palette', () => {
  it('has an entry for every color key', () => {
    for (const key of ColorKey.options) {
      expect(COLOR_PALETTE[key]).toBeDefined();
      expect(COLOR_PALETTE[key].stroke).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
