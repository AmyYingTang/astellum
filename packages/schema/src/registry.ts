import { z } from 'zod';

// The atlas registry: the read-optimized, approved-only artifact the annotation
// tool (@astrolens/atlas) exports and the identification pipeline (@astrolens/
// identify) consumes at apply time. It lives in @astrolens/schema so both sides
// share one contract without a package dependency cycle (atlas → identify).
//
// Geometry vertices are ICRS [RA_deg, Dec_deg], degrees. This is a SUBSET of the
// full atlas storage schema (no reference image, no status/author/timestamps —
// only approved annotations are exported, stripped to what apply needs).

export const RegistryGeometry = z.object({
  type: z.enum(['polygon', 'polyline', 'point']),
  vertices: z.array(z.tuple([z.number(), z.number()])).min(1),
  radius_arcmin: z.number().optional(),
});
export type RegistryGeometry = z.infer<typeof RegistryGeometry>;

export const RegistryAnnotation = z.object({
  feature_type: z.string(),
  geometry: RegistryGeometry,
  label: z.object({ zh: z.string(), en: z.string() }),
  /** Optional ICRS [RA_deg, Dec_deg] for the name label; apply reprojects it so
   *  the curator's placement carries onto the user image. Absent → auto-anchor. */
  label_anchor: z.tuple([z.number(), z.number()]).optional(),
  note: z.object({ zh: z.string(), en: z.string() }).optional(),
});
export type RegistryAnnotation = z.infer<typeof RegistryAnnotation>;

export const RegistryEntry = z.object({
  primary_id: z.string(),
  aliases: z.array(z.string()).default([]),
  annotations: z.array(RegistryAnnotation).default([]),
});
export type RegistryEntry = z.infer<typeof RegistryEntry>;

export const Registry = z.object({
  schema_version: z.literal(1),
  objects: z.array(RegistryEntry).default([]),
});
export type Registry = z.infer<typeof Registry>;

/** Normalise an identity for matching: strip whitespace, upper-case, so
 *  `NGC3372` == `NGC 3372`. Shared by the atlas tool (dedup) and apply (lookup). */
export function normalizeId(id: string): string {
  return id.replace(/\s+/g, '').toUpperCase();
}

/** Find the registry entry whose primary_id or any alias matches any of the
 *  given identity strings (designations / names / catalog ids), normalised. */
export function findRegistryEntry(registry: Registry, ids: readonly string[]): RegistryEntry | undefined {
  const keys = new Set(ids.map(normalizeId));
  return registry.objects.find(
    (o) => keys.has(normalizeId(o.primary_id)) || o.aliases.some((a) => keys.has(normalizeId(a))),
  );
}
