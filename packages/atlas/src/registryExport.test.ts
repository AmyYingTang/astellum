import { describe, expect, it } from 'vitest';
import { buildRegistry, staleTargets } from './registryExport.js';
import type { AtlasFile } from './atlas.js';

const anno = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  feature_type: 'pillar',
  geometry: { kind: 'polygon', vertices: [[1, 2]] },
  label: { zh: '柱', en: 'Pillar' },
  status: 'approved',
  author: 'amy',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  ...over,
});

const atlas = (annotations: Record<string, unknown>[]): AtlasFile =>
  ({
    schema_version: 1,
    objects: [{ primary_id: 'NGC 3372', aliases: ['Carina'], annotations }],
  }) as unknown as AtlasFile;

describe('what gets exported', () => {
  it('takes the approved and leaves the rest in the workshop', () => {
    const reg = buildRegistry(atlas([anno('a'), anno('b', { status: 'draft' }), anno('c', { status: 'in_review' })]));
    expect(reg.objects[0]?.annotations.map((a) => a.id)).toEqual(['a']);
  });

  it('drops a target with nothing approved rather than exporting an empty one', () => {
    expect(buildRegistry(atlas([anno('a', { status: 'draft' })])).objects).toEqual([]);
  });

  it('carries the annotation id, which predefined text is keyed by', () => {
    expect(buildRegistry(atlas([anno('a')])).objects[0]?.annotations[0]?.id).toBe('a');
  });
});

/*
 * The step a curator forgets. Approving is the judgement; exporting is the
 * mechanical consequence, and until it happens the kiosk shows last week's
 * shapes without saying so.
 */
describe('how far behind the exported registry is', () => {
  const a = atlas([anno('a')]);

  it('says nothing when the two agree', () => {
    expect(staleTargets(a, buildRegistry(a))).toEqual([]);
  });

  it('notices one more annotation approved since the export', () => {
    const before = buildRegistry(a);
    expect(staleTargets(atlas([anno('a'), anno('b')]), before)).toEqual(['NGC 3372']);
  });

  it('notices a shape nudged or a name corrected, not just a count', () => {
    const before = buildRegistry(a);
    const moved = atlas([anno('a', { geometry: { kind: 'polygon', vertices: [[9, 9]] } })]);
    const renamed = atlas([anno('a', { label: { zh: '柱状', en: 'Pillar 1' } })]);
    expect(staleTargets(moved, before)).toEqual(['NGC 3372']);
    expect(staleTargets(renamed, before)).toEqual(['NGC 3372']);
  });

  it('ignores edits that do not reach the runtime', () => {
    const before = buildRegistry(a);
    const reviewed = atlas([anno('a', { reviewed_by: 'amy', updated_at: '2026-10-20T00:00:00.000Z' })]);
    expect(staleTargets(reviewed, before)).toEqual([]);
  });

  it('notices a target that lost its last approval — the registry still has it', () => {
    const before = buildRegistry(a);
    expect(staleTargets(atlas([anno('a', { status: 'draft' })]), before)).toEqual(['NGC 3372']);
  });

  it('treats never having exported as everything being behind', () => {
    expect(staleTargets(a, null)).toEqual(['NGC 3372']);
  });
});
