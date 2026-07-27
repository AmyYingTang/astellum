import { z } from 'zod';
import { LocalizedString } from './i18n.js';
import { FeatureType, FeatureClass, ObjectCategory } from './taxonomy.js';
import { Wcs } from './wcs.js';

/** Plate-solve outcome; drives downstream trust. */
export const SolveStatus = z.enum(['solved', 'user_provided', 'failed']);
export type SolveStatus = z.infer<typeof SolveStatus>;

/**
 * How a feature is placed on the image. A-class objects use `coord.pixel`
 * directly; B-class (anchored / morphological) features record their method —
 * either a precise pixel, an anchor + direction, or none (human places it).
 */
export const FactLocalization = z.object({
  method: z.enum(['world_to_pixel', 'anchor', 'none']),
  anchor_ref: z.string().optional(), // B-anchor: id of the object/star it's positioned from
  direction: z.string().optional(), // B-anchor: e.g. 'NW rim, toward the exciting star'
  confidence: z.number().min(0).max(1),
});
export type FactLocalization = z.infer<typeof FactLocalization>;

/**
 * One entry in the fact sheet. A flat list — no nesting. The `tier` field marks
 * provenance:
 *  - **A** = catalog-grounded object (deterministic: plate-solve + catalog
 *    query). The wide-field MVP only emits these. `parent_object_id` is null.
 *  - **B** = morphological feature inferred from the image (ionization front,
 *    shell, pillar …) — uncertain, from CV/geometry/human, not a catalog.
 *    "Plan-B variant": B-class entries live here at top level (not nested),
 *    linked to their host A-object via `parent_object_id`, typed by
 *    `feature_type` (taxonomy), and flagged `needs_human_review`.
 */
export const FactObject = z.object({
  id: z.string(),
  role: z.enum(['primary', 'secondary', 'context']),
  tier: z.enum(['A', 'B']).default('A'),
  parent_object_id: z.string().nullable().default(null), // B-class → host object id; A-class → null
  feature_type: FeatureType.optional(), // B-class: controlled vocabulary (taxonomy.ts)
  feature_class: FeatureClass.optional(), // B-class instance tier: A+ / B-anchor / B-visual
  names: z.array(z.string()),
  /** Human-friendly common name (en from SIMBAD `NAME`, zh from Wikidata). The
   * display layer leads with this; absent for anonymous/survey-only targets. */
  common_name: LocalizedString.partial().optional(),
  /** All catalogue designations to show (NGC 2736, RCW 37, Sh 2-308 …). */
  designations: z.array(z.string()).default([]),
  category: ObjectCategory, // which feature set applies
  // SIMBAD otype + bilingual name. `source` = where the *type* came from
  // (catalog | wiki | survey), separate from identity provenance.
  type: LocalizedString.extend({ otype: z.string(), source: z.string().default('catalog') }),
  coord: z.object({
    ra_deg: z.number(),
    dec_deg: z.number(),
    pixel: z.tuple([z.number(), z.number()]).nullable(),
  }),
  size_arcmin: z.tuple([z.number(), z.number()]).optional(), // [major, minor]
  distance: z.object({ value: z.number(), unit: z.string(), source: z.string() }).optional(),
  catalog_ids: z.record(z.string(), z.string()).default({}), // { messier:'M42', ngc:'NGC 1976' }
  /** Identity confidence — *which catalogue object this is*. */
  confidence: z.number().min(0).max(1),
  /** Type/mechanism confidence — often lower than identity (survey catalogs type
   * by emission, not by mechanism; an SNR filament reads as "emission nebula"). */
  type_confidence: z.number().min(0).max(1).optional(),
  /** The type came from a weak/generic source (e.g. an Hα survey) — hedge it. */
  type_needs_review: z.boolean().default(false),
  /** Cross-matched designations folded in by dedup, with their separation from
   * the kept position — lets the UI show "NGC 2736 ↔ RCW 37 · Δ 2.1′". */
  cross_match: z
    .array(z.object({ id: z.string(), sep_arcmin: z.number() }))
    .default([]),
  localization: FactLocalization.optional(), // B-class: how it's placed; A-class uses coord.pixel
  /** Tip of a directional feature drawn as an arrow from `coord` (e.g. a comet
   * tail: nucleus → tail end). World + display pixel, like `coord`. */
  arrow_to: z
    .object({
      ra_deg: z.number(),
      dec_deg: z.number(),
      pixel: z.tuple([z.number(), z.number()]).nullable(),
    })
    .optional(),
  /** Class-B morphology suggestion outline (e.g. a pillar) — a closed contour in
   * display pixels. Drawn as a soft polygon, never a hard box; the semantic name
   * stays unset (geometry only — naming is the type-anchor stage's job). */
  polygon: z.array(z.tuple([z.number(), z.number()])).optional(),
  /** For atlas-sourced features: how to draw the `polygon` (closed area / open
   * line / single point). When set it overrides the feature_type→shape heuristic
   * in the reader; unset for all other producers (shape inferred as before). */
  geometry_kind: z.enum(['polygon', 'polyline', 'point']).optional(),
  /** Optional display-pixel position for the name label, projected from a
   * curator-placed sky anchor (atlas features only). When set, the reader
   * anchors the badge here instead of auto-placing it at the shape's top edge. */
  label_pixel: z.tuple([z.number(), z.number()]).optional(),
  /** Where this entry came from: a catalog match (A-class), a geometric prior
   * anchored on an A object, an image CV detector, an AI/VLM pass, or the human
   * feature atlas (approved baseline annotations). Drives provenance grouping. */
  detection_source: z.enum(['catalog', 'geometric', 'cv', 'ai', 'atlas']).default('catalog'),
  needs_human_review: z.boolean().default(false), // B-class uncertain ones → true
});
export type FactObject = z.infer<typeof FactObject>;

/**
 * The grounded fact sheet — the single interface from the identification stage
 * (Stage 1) to the LLM reader (Stage 2). Facts only; no interpretation.
 */
export const FactSheet = z.object({
  version: z.literal('1.0'),
  image: z.object({
    src: z.string(),
    width: z.number(),
    height: z.number(),
    hash: z.string(), // cache key
    band: z.enum(['broadband', 'narrowband', 'unknown']).default('unknown'),
    starless: z.boolean().default(false),
  }),
  solve: z.object({
    status: SolveStatus,
    ra_deg: z.number().optional(),
    dec_deg: z.number().optional(),
    radius_deg: z.number().optional(),
    pixscale_arcsec: z.number().optional(),
    orientation_deg: z.number().optional(),
    nova_job_id: z.string().optional(),
    /** Wall-clock plate-solve time, ms (nova, or ~0 when served from cache). */
    solve_ms: z.number().optional(),
    /** True when the solve was served from the on-disk cache (instant). */
    solve_cached: z.boolean().optional(),
    /** Which solver produced this WCS: 'nova' | 'local astrometry.net'. On a
     * cache hit this is the solver that originally solved the image. */
    solver: z.string().optional(),
    /** Full WCS used to project sky → pixel (for re-projection / debug grid). */
    wcs: Wcs.optional(),
    frame: z.enum(['display', 'co-registered', 'none']), // which pixel grid the WCS applies to
    co_registration: z
      .object({
        method: z.string(),
        rms_px: z.number().optional(),
        confidence: z.number().optional(),
      })
      .optional(),
  }),
  objects: z.array(FactObject),
  warnings: z.array(z.string()).default([]),
  provenance: z.object({
    queries: z.array(z.string()),
    solver: z.string(), // 'nova.astrometry.net'
    timestamp: z.string().datetime(),
  }),
});
export type FactSheet = z.infer<typeof FactSheet>;

export const FACTSHEET_VERSION = '1.0' as const;
