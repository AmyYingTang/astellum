import { FEATURE_TAXONOMY, pixelToWorld, type Wcs } from '@astellum/schema';
import type { LuminanceSampler } from './luminance.js';
import {
  rimBrightest,
  visibleRadiusPx,
  type DerivableObject,
  type DerivedFeature,
} from './features.js';

/**
 * Class-B CV detectors — image-content features that have *no* catalog anchor, so
 * the geometric priors (features.ts) can't place them. These read the pixels.
 *
 * Phase 1 ships only the reliable one: a **bright rim** (`ionization_front`) of an
 * emission nebula — the brightest sustained edge of its footprint, found by
 * searching the outer annulus with the luminance sampler. Pillars / dust lanes
 * are deferred to the AI pass (Phase 2); CV is too noisy for them.
 *
 * Every detection is `detection_source: 'cv'` + `needs_human_review` — the editor
 * groups them under "图像检测 (CV)" and the human confirms / repositions.
 */

export interface CvOpts {
  wcs?: Wcs;
  sampler?: LuminanceSampler;
  /** Median background luminance, so a "bright" rim must actually exceed it. */
  backgroundLum?: number;
}

export function detectCvFeatures(objects: DerivableObject[], opts: CvOpts = {}): DerivedFeature[] {
  const { wcs, sampler, backgroundLum } = opts;
  if (!wcs || !sampler) return [];
  const nebulae = objects.filter(
    (o) => o.category === 'emission_nebula' && o.coord.pixel && o.size_arcmin,
  );
  const out: DerivedFeature[] = [];
  let n = 0;
  // Steer clear of existing markers (catalog objects + features placed so far),
  // so a detected rim doesn't pile onto an A badge or the geometric shell.
  const avoid = objects
    .map((o) => o.coord.pixel)
    .filter((p): p is [number, number] => p != null);

  const pixscale = wcs.scale_deg * 3600; // arcsec/px
  const win = Math.max(8, Math.round(Math.min(wcs.width, wcs.height) / 35));
  const tax = FEATURE_TAXONOMY.ionization_front;

  for (const neb of nebulae) {
    const center = neb.coord.pixel!;
    const catR = (neb.size_arcmin![0] * 60) / pixscale / 2; // catalog radius, px
    // Confine the rim search to the *visible* glow, not the (possibly inflated,
    // merged) catalog extent — otherwise the brightest point in a 170′ annulus
    // lands on unrelated nebulosity far from this nebula.
    const R =
      backgroundLum != null && Number.isFinite(backgroundLum)
        ? visibleRadiusPx(center, catR, sampler, backgroundLum, wcs.width, wcs.height, win)
        : catR;
    if (!(R > win)) continue; // no coherent glow at the catalog centre → skip
    const hit = rimBrightest(center, R, sampler, wcs.width, wcs.height, win, avoid);
    if (!hit) continue;
    // A genuine bright rim is clearly above background; otherwise it's just the
    // brightest noise on the edge — skip rather than emit a spurious feature.
    if (backgroundLum != null && Number.isFinite(backgroundLum) && !(hit.lum > backgroundLum * 1.25)) {
      continue;
    }
    const world = pixelToWorld(wcs, hit.pixel[0], hit.pixel[1]);
    avoid.push(hit.pixel); // don't stack a second rim on the same spot
    // Cap at 0.7: a CV inference is a hint to confirm, never catalog-certain.
    const contrast = backgroundLum ? Math.min(0.7, hit.lum / (backgroundLum * 2)) : 0.5;
    out.push({
      id: `bcv${++n}`,
      role: 'context',
      tier: 'B',
      parent_object_id: neb.id,
      feature_type: 'ionization_front',
      feature_class: 'B-visual',
      names: [`${tax.zh} / ${tax.en}`],
      category: neb.category,
      type: { otype: '', zh: tax.zh, en: tax.en },
      coord: {
        ra_deg: world ? world[0] : neb.coord.ra_deg,
        dec_deg: world ? world[1] : neb.coord.dec_deg,
        pixel: hit.pixel,
      },
      catalog_ids: {},
      confidence: Math.max(0.3, Math.round(contrast * 100) / 100),
      localization: { method: 'world_to_pixel', confidence: 0.5 },
      detection_source: 'cv',
      needs_human_review: true,
    });
  }
  return out;
}
