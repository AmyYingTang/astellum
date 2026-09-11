import { FactSheet } from '@astellum/schema';
import type { ObjectCategory, Registry } from '@astellum/schema';
import type { CatalogCandidate, Wcs } from './types.js';
import type { GatedCandidate } from './select.js';
import { objectTypeLabel } from './otype.js';
import type { LuminanceSampler } from './luminance.js';
import type { CometFactObject } from './comet.js';
import type { MorphResult, MorphFeature } from './morph.js';
import { fieldRadiusDeg } from './wcs.js';
import { applyAtlas, type AtlasHost } from './atlasApply.js';

/** Nebula-ish categories we surface a "no baseline annotations yet" hint for
 * when they aren't in the atlas (stars/clusters don't get B-class features). */
const NEBULA_CATEGORIES = new Set<ObjectCategory>([
  'emission_nebula',
  'reflection_nebula',
  'planetary_nebula',
  'supernova_remnant',
  'dark_nebula',
  'galaxy',
]);

/** Identity confidence — *which* catalogue object this is. */
function objConfidence(c: CatalogCandidate): number {
  if (c.catalog_ids.messier) return 0.97;
  if (c.catalog_ids.ngc || c.catalog_ids.ic) return 0.9;
  if (Object.keys(c.catalog_ids).length > 0) return 0.82;
  if (typeof c.mag === 'number') return 0.85; // a catalogued bright star
  return 0.7;
}

/** All catalogue designations to display, e.g. ["NGC 2736", "RCW 37"]. */
function designationsOf(c: CatalogCandidate): string[] {
  const ids = [...new Set(Object.values(c.catalog_ids))];
  if (ids.length) return ids;
  const d = c.main_id.replace(/^\*\s+/, '').replace(/\s+/g, ' ').trim();
  return d ? [d] : [];
}

interface ResolvedType {
  type: { otype: string; zh: string; en: string; source: string };
  category: ObjectCategory;
  type_confidence: number;
  type_needs_review: boolean;
}

/**
 * Resolve the object's *type* + its trustworthiness, separate from identity.
 * Survey catalogs type by emission, not mechanism (an SNR filament reads as
 * "emission nebula"), so a catalogue emission type is low-confidence; Wikidata
 * (P31), when available, is authoritative enough to override it.
 */
function resolveType(c: CatalogCandidate, gateCat: ObjectCategory): ResolvedType {
  if (c.wiki_type) {
    const category = c.wiki_type.category ?? gateCat;
    const base = objectTypeLabel(c.otype, category);
    return {
      type: {
        otype: c.otype,
        zh: c.wiki_type.zh ?? base.zh,
        en: c.wiki_type.en ?? base.en,
        source: 'wiki',
      },
      category,
      type_confidence: 0.7,
      type_needs_review: false,
    };
  }
  const base = objectTypeLabel(c.otype, gateCat);
  const source = c.source.startsWith('VizieR') ? 'vizier' : 'simbad';
  // Emission/HII typed only from a catalogue is the unreliable bucket.
  const weak = gateCat === 'emission_nebula';
  return {
    type: { otype: c.otype, zh: base.zh, en: base.en, source },
    category: gateCat,
    type_confidence: weak ? 0.4 : 0.7,
    type_needs_review: weak,
  };
}

export interface AssembleArgs {
  image: {
    src: string;
    width: number;
    height: number;
    hash: string;
    band: 'broadband' | 'narrowband' | 'unknown';
    starless: boolean;
  };
  wcs: Wcs;
  novaJobId?: string;
  /** Plate-solve wall-clock time (ms) + whether it was a cache hit. */
  solveMs?: number;
  solveCached?: boolean;
  /** Which solver produced the WCS ('nova' | 'local astrometry.net'). */
  solver?: string;
  /** Already gated, prominence-filtered and ranked (see selectObjects). */
  selected: GatedCandidate[];
  queries: string[];
  timestamp: string;
  /** Image luminance, for snapping Class-B markers onto bright structure. */
  sampler?: LuminanceSampler;
  /** Image-detected comet (head + nucleus/coma/tails), no catalog. When present
   * the comet is the primary and the catalog objects become secondaries. */
  cometObjects?: CometFactObject[];
  /** Image-detected morphology (pillars …), outreach-selected. RETIRED from the
   * factsheet output (atlas is now B-class's only source); still accepted so
   * callers don't break — no longer rendered. */
  morphology?: { result: MorphResult; selected: MorphFeature[] };
  /** The approved atlas registry (from @astellum/atlas export). B-class features
   * are projected from it onto the user image. null / absent → no B-class. */
  registry?: Registry | null;
}


/**
 * Build a validated FactSheet (solved path). Each selected catalogue entry — a
 * cluster, bright star, nebula/cloud or galaxy — becomes an object the reader
 * will annotate as one circle. Sub-features (pillars/fronts/…) are out of scope
 * for the wide-field MVP, so objects carry no features yet.
 */
export function assembleFactSheet(args: AssembleArgs): FactSheet {
  const { wcs } = args;
  const warnings: string[] = [];
  if (args.selected.length === 0) {
    warnings.push('No prominent catalogued object with an optical counterpart in the field.');
  }

  const hasComet = (args.cometObjects?.length ?? 0) > 0;
  const objects = args.selected.map((g, i) => {
    const c = g.candidate;
    const rt = resolveType(c, g.category);
    const common =
      c.common_name && (c.common_name.en || c.common_name.zh) ? c.common_name : undefined;
    return {
      id: `obj${i + 1}`,
      role: !hasComet && i === 0 ? ('primary' as const) : ('secondary' as const),
      names: c.names.length ? c.names : [c.main_id],
      ...(common ? { common_name: common } : {}),
      designations: designationsOf(c),
      category: rt.category, // may be corrected by Wikidata (e.g. SNR vs HII)
      type: rt.type,
      coord: { ra_deg: c.ra_deg, dec_deg: c.dec_deg, pixel: g.pixel },
      ...(c.size_arcmin ? { size_arcmin: c.size_arcmin } : {}),
      catalog_ids: c.catalog_ids,
      confidence: objConfidence(c),
      type_confidence: rt.type_confidence,
      type_needs_review: rt.type_needs_review,
      ...(c.cross_match?.length ? { cross_match: c.cross_match } : {}),
      // tier 'A' (catalog-grounded), parent_object_id null, needs_human_review
      // false all come from schema defaults.
    };
  });

  // Class-B features come ONLY from the human feature atlas now. The old auto
  // detectors — geometric priors (features.ts deriveBClassFeatures), outreach
  // morphology (morph.ts → morphToObjects), CV (cv.ts) and the VLM pass — are
  // retired from the user-visible factsheet (their code stays in the repo,
  // unwired). Match each A-object against the approved registry, project its
  // ICRS annotations onto this image's WCS, clip to frame.
  const hosts: AtlasHost[] = objects.map((o) => ({
    id: o.id,
    category: o.category,
    names: o.names,
    designations: o.designations,
    catalog_ids: o.catalog_ids,
  }));
  const atlas = args.registry
    ? applyAtlas(hosts, wcs, args.registry)
    : { features: [], unmatched: hosts };
  // Nebula-type objects with no baseline annotations → a soft "not covered yet"
  // hint (the editor can offer a link to annotate it). Not an error.
  for (const h of atlas.unmatched) {
    if (NEBULA_CATEGORIES.has(h.category)) {
      warnings.push(`No baseline annotations for ${h.names[0] ?? h.id} yet.`);
    }
  }

  return FactSheet.parse({
    version: '1.0',
    image: args.image,
    solve: {
      status: 'solved',
      ra_deg: wcs.ra0_deg,
      dec_deg: wcs.dec0_deg,
      radius_deg: fieldRadiusDeg(wcs),
      pixscale_arcsec: wcs.scale_deg * 3600,
      orientation_deg: wcs.orientation_deg,
      nova_job_id: args.novaJobId,
      ...(args.solveMs != null ? { solve_ms: args.solveMs } : {}),
      ...(args.solveCached != null ? { solve_cached: args.solveCached } : {}),
      ...(args.solver ? { solver: args.solver } : {}),
      wcs,
      frame: 'display',
    },
    objects: [...(args.cometObjects ?? []), ...objects, ...atlas.features],
    warnings,
    provenance: {
      queries: args.queries,
      solver: 'nova.astrometry.net',
      timestamp: args.timestamp,
    },
  });
}
