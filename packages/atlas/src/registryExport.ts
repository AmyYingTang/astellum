import type { AtlasFile } from './atlas.js';

/**
 * Turning the atlas into what the runtime reads.
 *
 * Two files, on purpose: the atlas is the working surface, where a shape can
 * be half-drawn and a name half-decided, and the registry is the approved
 * subset the kiosk and the studio project onto a photograph. Approving is the
 * judgement; exporting is the mechanical consequence of it — which is exactly
 * why it is so easy to forget, and why `staleTargets` exists.
 */

export interface ExportedAnnotation {
  id: string;
  feature_type: string;
  geometry: unknown;
  label: unknown;
  label_anchor?: unknown;
  note?: unknown;
}

export interface ExportedObject {
  primary_id: string;
  aliases: string[];
  annotations: ExportedAnnotation[];
}

export interface ExportedRegistry {
  schema_version: 1;
  objects: ExportedObject[];
}

/**
 * The approved-only, read-optimized view: only what apply needs. Annotation ids
 * are carried so a predefined reading can attach text to this exact shape and
 * keep it across re-exports.
 */
export function buildRegistry(atlas: AtlasFile): ExportedRegistry {
  const objects = atlas.objects
    .map((o) => ({
      primary_id: o.primary_id,
      aliases: o.aliases,
      annotations: o.annotations
        .filter((a) => a.status === 'approved')
        .map((a) => ({
          id: a.id,
          feature_type: a.feature_type,
          geometry: a.geometry,
          label: a.label,
          ...(a.label_anchor ? { label_anchor: a.label_anchor } : {}),
          ...(a.note ? { note: a.note } : {}),
        })),
    }))
    .filter((o) => o.annotations.length > 0) as ExportedObject[];
  return { schema_version: 1, objects };
}

/**
 * Which targets the runtime would get wrong if it read the registry right now.
 *
 * Compared by what the export would actually write, not by counts or
 * timestamps: a shape nudged, a name corrected and an annotation approved all
 * matter equally, and a registry written by an older version has no timestamp
 * to trust anyway. A target that has lost its last approved annotation is
 * stale too — the registry still carries it.
 */
export function staleTargets(atlas: AtlasFile, registry: unknown): string[] {
  const want = buildRegistry(atlas);
  const have = ((registry as ExportedRegistry | null)?.objects ?? []) as ExportedObject[];
  const haveById = new Map(have.map((o) => [o.primary_id, JSON.stringify(o)]));
  const out: string[] = [];
  for (const o of want.objects) {
    if (haveById.get(o.primary_id) !== JSON.stringify(o)) out.push(o.primary_id);
    haveById.delete(o.primary_id);
  }
  // Whatever is left in the registry is no longer approved anywhere.
  for (const id of haveById.keys()) out.push(id);
  return out;
}
