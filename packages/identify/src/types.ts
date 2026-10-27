// The WCS type + projection live in @astellum/schema (shared with the editor).
import type { Wcs, ObjectCategory } from '@astellum/schema';
export type { Wcs };

export interface SolveInput {
  imagePath: string;
  width: number;
  height: number;
  /**
   * Optional sky position to search near (ICRS degrees, radius in degrees).
   * Onsite the target is chosen before the shutter opens, so its catalogue
   * position is already known — handing it to solve-field turns a blind
   * all-sky search into a local one and cuts the solve from tens of seconds to
   * a few. Ignored by solvers that don't accept a hint (nova).
   */
  hint?: { ra_deg: number; dec_deg: number; radius_deg: number };
}

export interface SolveResult {
  status: 'solved' | 'failed';
  wcs?: Wcs;
  nova_job_id?: string;
  /** Human-readable reason when status is 'failed' (auth / timeout / no-solve / …). */
  error?: string;
  /** Wall-clock time this solve() call took, ms. ~0 on a cache hit. */
  elapsed_ms?: number;
  /** True when served from the on-disk solve cache (instant, no nova). */
  cached?: boolean;
  /** Which solver produced this: 'nova' | 'local astrometry.net'. */
  solver?: string;
}

/** Pluggable plate-solver (nova in production; mock in tests). */
export interface SolveClient {
  solve(input: SolveInput): Promise<SolveResult>;
}

/** A raw catalog match from a region query, before gating/ranking. */
export interface CatalogCandidate {
  main_id: string;
  names: string[];
  otype: string; // SIMBAD otype code, e.g. "HII", "WR*", "GlC"
  ra_deg: number;
  dec_deg: number;
  size_arcmin?: [number, number]; // [major, minor]
  /** Apparent magnitude if known (smaller = brighter); used for ranking. */
  mag?: number;
  catalog_ids: Record<string, string>; // { messier:'M42', ngc:'NGC 1976' }
  source: string; // 'SIMBAD'
  /** Friendly common name (en from SIMBAD `NAME`, zh filled later from Wikidata). */
  common_name?: { zh?: string; en?: string };
  /** Designations folded in by cross-source dedup + their separation (arcmin). */
  cross_match?: { id: string; sep_arcmin: number }[];
  /** Type resolved from Wikidata (P31), overriding a generic catalogue type. */
  wiki_type?: { category?: ObjectCategory; en?: string; zh?: string };
  /** The catalogue says a star cluster sits in this nebula (OpenNGC `Cl+N`).
   *  It stays a nebula, but its size no longer has to make it prominent: a
   *  compact one like NGC 3603 is small on paper and the brightest thing in
   *  the frame. */
  with_cluster?: boolean;
}

export interface RegionQuery {
  ra_deg: number;
  dec_deg: number;
  radius_deg: number;
}

/** Pluggable catalog (SIMBAD TAP in production; mock in tests). */
export interface CatalogClient {
  region(query: RegionQuery): Promise<CatalogCandidate[]>;
}

export interface IdentifyInput {
  imagePath: string;
  width: number;
  height: number;
  /** Relative path stored in factsheet.image.src. Defaults to basename of imagePath. */
  imageSrc?: string;
  /** Precomputed image hash; if omitted, computed from the file (sha256). */
  hash?: string;
  /** Atlas registry.json paths (approved B-class annotations), in priority order
   * — typically [baseline, user overlay]. Merged; B-class features are projected
   * from the result. Absent/all-missing → no B-class. */
  registryPaths?: string[];
  targetName?: string;
  /** Known sky position of the chosen target, passed to the solver as a search
   * hint. Onsite the target is picked up front, so this is available and turns
   * a blind all-sky solve into a local one. */
  solveHint?: { ra_deg: number; dec_deg: number; radius_deg: number };
  band?: 'broadband' | 'narrowband' | 'unknown';
  starless?: boolean;
  /** Max annotated objects to keep (others dropped). Default 8. */
  topN?: number;
  /** Selection thresholds (configurable later; sensible defaults for now). */
  starMagMax?: number; // keep stars brighter than this V mag. Default 4.
  nebulaMinArcmin?: number; // keep nebulae/clouds at least this big. Default 8.
  galaxyMinArcmin?: number; // keep galaxies at least this big (and catalogued). Default 3.
}

export interface IdentifyDeps {
  solve: SolveClient;
  catalog: CatalogClient;
}
