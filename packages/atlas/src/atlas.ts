import { z } from 'zod';
import { Wcs } from '@astellum/schema';

// The atlas storage contract (TOOL_HANDOFF §6) — the hard interface between the
// annotation tool (writes) and Atlas Apply (reads). Geometry vertices are ICRS
// [RA_deg, Dec_deg]; all angles in DEGREES. Nebulae don't move → no epoch/PM.

export const Bilingual = z.object({ zh: z.string(), en: z.string() });
export type Bilingual = z.infer<typeof Bilingual>;

export const GeometryType = z.enum(['polygon', 'polyline', 'point']);
export type GeometryType = z.infer<typeof GeometryType>;

export const AnnoStatus = z.enum(['draft', 'in_review', 'approved']);
export type AnnoStatus = z.infer<typeof AnnoStatus>;

/** A single [RA_deg, Dec_deg] vertex, ICRS. */
export const Vertex = z.tuple([z.number(), z.number()]);
export type Vertex = z.infer<typeof Vertex>;

export const Geometry = z.object({
  type: GeometryType,
  // polygon: closed ring · polyline: open path · point: a single vertex
  vertices: z.array(Vertex).min(1),
  // point only: optional angular radius
  radius_arcmin: z.number().optional(),
});
export type Geometry = z.infer<typeof Geometry>;

export const Annotation = z.object({
  id: z.string(),
  feature_type: z.string(),
  geometry: Geometry,
  label: Bilingual,
  /** Optional ICRS [RA_deg, Dec_deg] where the name label sits. Stored in sky
   *  coords like everything else, so a curator-placed label reprojects onto any
   *  image. Absent → the consumer auto-anchors it (top vertex). */
  label_anchor: Vertex.optional(),
  note: Bilingual.optional(),
  status: AnnoStatus.default('draft'),
  author: z.string().optional(),
  reviewed_by: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Annotation = z.infer<typeof Annotation>;

/** Reference-image bookkeeping — tool-side editing/redisplay only; the consumer
 *  (apply) never needs it (it reads only sky coords). */
export const Reference = z.object({
  image_ref: z.string(), // AtlasStore key, no backend scheme (local/R2/S3 by config)
  wcs: Wcs,
  width_px: z.number(),
  height_px: z.number(),
  /** Attribution for a reference image we didn't shoot ourselves. Most usable
   *  sources (ESO, NOIRLab, ESA/Hubble) are CC BY 4.0, which *requires* credit;
   *  recording it at import time is the only way it survives. Optional because
   *  an image the annotator shot themselves needs none. */
  credit: z.string().optional(),
  /** SPDX-ish id, e.g. 'CC-BY-4.0' or 'public-domain'. */
  license: z.string().optional(),
  /** Landing page the image came from (not the direct file URL). */
  source_url: z.string().optional(),
});
export type Reference = z.infer<typeof Reference>;

export const AtlasEntry = z.object({
  primary_id: z.string(),
  aliases: z.array(z.string()).default([]),
  reference: Reference.optional(),
  annotations: z.array(Annotation).default([]),
  /** Optimistic-concurrency counter, bumped by the server on every save. A
   *  client must send back the rev it loaded; a mismatch means someone else
   *  saved meanwhile, so the write is rejected instead of silently clobbering
   *  their work (two people share one hosted instance). */
  rev: z.number().default(0),
});
export type AtlasEntry = z.infer<typeof AtlasEntry>;

/** The whole committable atlas data file. */
export const AtlasFile = z.object({
  schema_version: z.literal(1),
  objects: z.array(AtlasEntry).default([]),
});
export type AtlasFile = z.infer<typeof AtlasFile>;

export const EMPTY_ATLAS: AtlasFile = { schema_version: 1, objects: [] };

/** Normalise an identity for matching: strip spaces, upcase, collapse the
 *  common catalog-prefix spacing so `NGC3372` == `NGC 3372` (TOOL §5). */
export function normalizeId(id: string): string {
  return id.replace(/\s+/g, '').toUpperCase();
}

/** Find an entry whose primary_id or any alias matches `id` (normalised). */
export function findEntry(atlas: AtlasFile, id: string): AtlasEntry | undefined {
  const key = normalizeId(id);
  return atlas.objects.find(
    (o) => normalizeId(o.primary_id) === key || o.aliases.some((a) => normalizeId(a) === key),
  );
}
