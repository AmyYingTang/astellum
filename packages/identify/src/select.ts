import type { ObjectCategory } from '@astellum/schema';
import type { CatalogCandidate, Wcs } from './types.js';
import { worldToPixel } from './wcs.js';
import { isOptical, objectCategory } from './otype.js';
import { sampleMedian, type LuminanceSampler } from './luminance.js';
import { lookupNickname } from './nicknames.js';
import { isWrBubble } from './features.js';

/** A candidate that passed the annotation gate, with its projected pixel + category. */
export interface GatedCandidate {
  candidate: CatalogCandidate;
  pixel: [number, number];
  category: ObjectCategory;
}

export interface SelectOptions {
  starMagMax: number;
  nebulaMinArcmin: number;
  galaxyMinArcmin: number;
  /** Per-category caps so bright stars / clusters aren't crowded out by big nebulae. */
  maxStars: number;
  maxClusters: number;
  maxNebulae: number;
  maxGalaxies: number;
  /** Optional overall hard cap (applied after balancing). */
  topN?: number;
  /** Image luminance — when present, a candidate must also be *visible* (bright
   * structure, or a dark silhouette for dark nebulae) to be kept. */
  sampler?: LuminanceSampler;
  backgroundLum?: number;
  visWindow?: number;
  /** Frame size — enables a composition prior (the subject is framed away from
   * the edges), used to rank/pick the primary. */
  imageW?: number;
  imageH?: number;
}

const DEG = Math.PI / 180;

function angSepDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const d1 = dec1 * DEG;
  const d2 = dec2 * DEG;
  const c =
    Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos((ra1 - ra2) * DEG);
  return Math.acos(Math.min(1, Math.max(-1, c))) / DEG;
}

const isWR = (c: CatalogCandidate): boolean => c.otype === 'WR*' || c.otype === 'WR?';

/** A hand-curated famous object (nickname overlay) — surfaced as a landmark
 * regardless of the magnitude / named / visibility / cap gates. */
const isCurated = (c: CatalogCandidate): boolean =>
  !!lookupNickname([...Object.values(c.catalog_ids), ...c.names, c.main_id]);

/**
 * Composition prior: photographers frame the subject away from the edges. A
 * candidate centred in the frame scores ~1; one whose centre is in the outer
 * ~25% edge band is gently penalised (down to 0.6). Used to bias primary
 * selection toward the actual subject.
 */
function centerFactor(g: GatedCandidate, opts: SelectOptions): number {
  if (!opts.imageW || !opts.imageH) return 1;
  const nx = Math.abs(g.pixel[0] - opts.imageW / 2) / (opts.imageW / 2);
  const ny = Math.abs(g.pixel[1] - opts.imageH / 2) / (opts.imageH / 2);
  const edge = Math.max(nx, ny); // 0 = centre, 1 = frame edge
  const pen = Math.max(0, (edge - 0.5) / 0.5); // 0 until the outer 25% band, →1 at the edge
  return 1 - 0.4 * pen;
}

/** Catalogue significance weighted by composition (centeredness). */
function composedScore(g: GatedCandidate, opts: SelectOptions): number {
  return significance(g.candidate) * centerFactor(g, opts);
}

/** Catalogs whose membership counts as a "recognizable" DSO designation. */
const NAMED_CATALOGS = [
  'messier',
  'ngc',
  'ic',
  'sharpless',
  'rcw',
  'vdb',
  'cederblad',
  'barnard',
  'ldn',
];
/** Survey / anonymous designations that are NOT a human-recognizable name. */
const SURVEY_NAME =
  /^(\[|2MASX|LEDA|PGCC|PGC\b|TGU|GSC|UCAC|Gaia |TYC |SAO |IRAS|WISE|2MASS|UGC|MCG|HVC|MGr|HDC|GRG)/i;

/** A DSO is "recognizable" if it has a known catalog id, a non-survey name, or a
 * curated nickname (a famous object whose only catalog ids are survey ones — e.g.
 * the Dark Doodad, TGU H1868 — would otherwise be dropped as survey noise). */
export function hasRecognizableName(c: CatalogCandidate): boolean {
  if (NAMED_CATALOGS.some((k) => c.catalog_ids[k])) return true;
  if (isCurated(c)) return true;
  return [c.main_id, ...c.names].some((n) => n.trim() !== '' && !SURVEY_NAME.test(n.trim()));
}

type Kind = 'star' | 'cluster' | 'nebula' | 'galaxy';

function kindOf(cat: ObjectCategory): Kind {
  if (cat === 'star') return 'star';
  if (cat === 'globular_cluster' || cat === 'open_cluster') return 'cluster';
  if (cat === 'galaxy') return 'galaxy';
  return 'nebula';
}

/** Catalogue significance, higher = more prominent. Messier ≫ NGC/IC ≫ other; + size + brightness. */
export function significance(c: CatalogCandidate): number {
  let score = 0;
  if (c.catalog_ids.messier) score += 1000;
  else if (c.catalog_ids.ngc || c.catalog_ids.ic) score += 500;
  else if (NAMED_CATALOGS.some((k) => c.catalog_ids[k])) score += 300; // Sharpless/RCW/vdB/…
  else if (Object.keys(c.catalog_ids).length > 0) score += 100;
  // Angular size, capped: a giant background cloud (e.g. B 258 at 433′, larger
  // than the field) shouldn't out-rank the framed subject on size alone.
  if (c.size_arcmin) score += Math.min(c.size_arcmin[0], 300);
  // Fame: a common name ⇒ a famous object ⇒ it's almost certainly the subject —
  // so the named nebula (War and Peace) becomes primary over an unnamed cloud.
  if (c.common_name?.en || c.common_name?.zh) score += 500;
  // Brightness: a naked-eye-bright star (Antares V≈1 → ~330) ranks with a notable
  // DSO so it survives the focused set; a moderate star (V≈3 → ~210) stays below a
  // named nebula so the nebula remains the subject.
  if (typeof c.mag === 'number') score += Math.max(0, 6.5 - c.mag) * 60;
  return score;
}

/**
 * Annotation gate: keep candidates with a visible optical counterpart we can
 * classify into a category, that project inside the frame. Non-optical
 * (radio/X-ray/IR) and unknown otypes are dropped.
 */
export function gateCandidates(candidates: CatalogCandidate[], wcs: Wcs): GatedCandidate[] {
  const margin = 0.05 * Math.max(wcs.width, wcs.height);
  const out: GatedCandidate[] = [];
  for (const c of candidates) {
    if (!isOptical(c.otype)) continue;
    const category = objectCategory(c.otype);
    if (!category) continue; // unknown otype — don't annotate
    const p = worldToPixel(wcs, c.ra_deg, c.dec_deg);
    if (!p) continue;
    if (p[0] < -margin || p[0] > wcs.width + margin) continue;
    if (p[1] < -margin || p[1] > wcs.height + margin) continue;

    // Drop extended objects that fall mostly outside the frame (e.g. a big dark
    // cloud whose centre is near an edge). Exempt a large object centred on the
    // frame — that's a legitimate main subject bigger than the field of view.
    if (c.size_arcmin) {
      const rPx = c.size_arcmin[0] / 2 / (wcs.scale_deg * 60); // arcmin → px radius
      if (rPx > 1) {
        const ix = Math.max(0, Math.min(p[0] + rPx, wcs.width) - Math.max(p[0] - rPx, 0));
        const iy = Math.max(0, Math.min(p[1] + rPx, wcs.height) - Math.max(p[1] - rPx, 0));
        const coverage = (ix * iy) / (4 * rPx * rPx);
        const coversCenter =
          Math.abs(p[0] - wcs.width / 2) <= rPx && Math.abs(p[1] - wcs.height / 2) <= rPx;
        if (coverage < 0.5 && !coversCenter) continue;
      }
    }
    out.push({ candidate: c, pixel: p, category });
  }
  return out;
}

/** Prominence filter — "the main bodies + main structures", not every faint catalogued thing. */
function isProminent(g: GatedCandidate, opts: SelectOptions): boolean {
  const c = g.candidate;
  const major = c.size_arcmin?.[0] ?? 0;
  const hasPrestige = !!(c.catalog_ids.messier || c.catalog_ids.ngc || c.catalog_ids.ic);
  switch (g.category) {
    case 'star':
      // Bright (naked-eye-ish) stars only. A WR star is NOT auto-kept here — a
      // field can hold many faint WR stars that aren't the subject; the exciting
      // star of the *selected* main nebula is added back separately (see below).
      return typeof c.mag === 'number' && c.mag < opts.starMagMax;
    case 'globular_cluster':
    case 'open_cluster':
      return hasPrestige; // named clusters only (M / NGC / IC)
    case 'galaxy':
      return hasPrestige && major >= opts.galaxyMinArcmin; // drop faint survey galaxies
    default:
      // nebulae / clouds — must be a recognizable named object AND large enough.
      // Drops survey-only clumps (e.g. PGCC Planck cold clumps) that aren't the
      // image's subject.
      return hasRecognizableName(c) && major >= opts.nebulaMinArcmin;
  }
}

/**
 * Visibility gate: with an image sampler, a candidate must actually be visible
 * in THIS frame — bright structure for emission/reflection/cluster/galaxy, or a
 * dark silhouette for dark nebulae. Stars are gated by magnitude already.
 */
function isVisible(g: GatedCandidate, opts: SelectOptions): boolean {
  const s = opts.sampler;
  const bg = opts.backgroundLum;
  if (!s || bg == null || !Number.isFinite(bg)) return true; // no image → don't gate
  if (g.category === 'star') return true;
  // A curated famous object (nickname overlay) is trusted to be the subject — its
  // single-centroid luminance can mislead for a thin/extended cloud (the Dark
  // Doodad's centre isn't its darkest point), so don't gate it on that.
  if (isCurated(g.candidate)) return true;
  const v = sampleMedian(s, g.pixel[0], g.pixel[1], opts.visWindow ?? 40);
  if (!Number.isFinite(v)) return true;
  if (g.category === 'dark_nebula') return v < bg * 0.92; // darker than background
  return v > bg * 1.12; // brighter than background
}

/**
 * Select the prominent objects with per-category caps (so the bright stars and
 * clusters survive alongside the big nebulae), then order by significance so the
 * most prominent (e.g. a Messier object) becomes primary.
 */
export function selectObjects(gated: GatedCandidate[], opts: SelectOptions): GatedCandidate[] {
  const caps: Record<Kind, number> = {
    star: opts.maxStars,
    cluster: opts.maxClusters,
    nebula: opts.maxNebulae,
    galaxy: opts.maxGalaxies,
  };
  const groups: Record<Kind, GatedCandidate[]> = { star: [], cluster: [], nebula: [], galaxy: [] };
  for (const g of gated) {
    if (isProminent(g, opts) && isVisible(g, opts)) groups[kindOf(g.category)].push(g);
  }

  const kept: GatedCandidate[] = [];
  for (const kind of ['star', 'cluster', 'nebula', 'galaxy'] as Kind[]) {
    const list = groups[kind].sort((a, b) =>
      kind === 'star'
        ? (a.candidate.mag ?? 99) - (b.candidate.mag ?? 99) // brightest stars first
        : composedScore(b, opts) - composedScore(a, opts),
    );
    kept.push(...list.slice(0, caps[kind]));
  }

  // Always keep the best-composed gated object — the subject is shown even if it
  // somehow failed the named/visible filters.
  const top = [...gated].sort((a, b) => composedScore(b, opts) - composedScore(a, opts))[0];
  if (top && !kept.includes(top)) kept.push(top);

  kept.sort((a, b) => composedScore(b, opts) - composedScore(a, opts));
  const result = opts.topN ? kept.slice(0, opts.topN) : kept;

  // Curated landmarks (nickname overlay) are always surfaced — η Carinae (faint +
  // variable), the Dark Doodad … — exempt from the per-type caps + topN.
  for (const g of gated) {
    if (isCurated(g.candidate) && !result.includes(g)) result.push(g);
  }

  // Surface the WR star only when it's morphologically the point — i.e. the
  // nebula IS a known WR wind-bubble (the Dolphin / SH2-308 around a WR star).
  // In a generic HII region the embedded WR is just one faint hot star among
  // many, not visually meaningful, so we don't badge it (it's still used as the
  // illumination-prior anchor for pillars — see identify.ts — just not shown).
  const nebulae = result.filter(
    (g) =>
      g.category === 'emission_nebula' && g.candidate.size_arcmin && isWrBubble(g.candidate.names),
  );
  for (const neb of nebulae) {
    const r = neb.candidate.size_arcmin![0] / 2 / 60; // deg
    const inside = gated
      .filter(
        (g) =>
          isWR(g.candidate) &&
          !result.includes(g) &&
          angSepDeg(
            neb.candidate.ra_deg,
            neb.candidate.dec_deg,
            g.candidate.ra_deg,
            g.candidate.dec_deg,
          ) < r,
      )
      .sort(
        (a, b) =>
          angSepDeg(neb.candidate.ra_deg, neb.candidate.dec_deg, a.candidate.ra_deg, a.candidate.dec_deg) -
          angSepDeg(neb.candidate.ra_deg, neb.candidate.dec_deg, b.candidate.ra_deg, b.candidate.dec_deg),
      );
    if (inside[0]) result.push(inside[0]);
  }
  return result;
}
