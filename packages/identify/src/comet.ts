import { pixelToWorld, FEATURE_TAXONOMY, type Wcs } from '@astellum/schema';
import type { ImageRaster } from './luminance.js';

/**
 * Comet detector — pure image morphology, no catalog and no AI. A comet is a
 * *moving* object, so it's in no catalog region query; instead we read its shape
 * from the pixels. We don't try to name it (all comets look alike and naming
 * needs the observation time + an ephemeris); we find its parts:
 *   - 核 nucleus   — the peak inside the head
 *   - 慧发 coma     — the fuzzy head around the nucleus
 *   - 尘埃尾 dust tail — broad, curved, yellow-white
 *   - 离子尾 ion tail  — straight, narrow, blue
 *
 * Method (all in a coarse grid):
 *   1. head  = the brightest *extended* blob (smoothing suppresses point stars).
 *   2. tails = ray-cast from the head; a tail is a direction with a *sustained*
 *      bright streak far past the coma (a star field has none). Up to two peaks.
 *   3. classify each tail dust/ion by colour (blue ⇒ ion) — the head+tail combo
 *      is also the guard that this is a comet, not a fuzzy galaxy/nebula.
 */

export interface CometTail {
  kind: 'dust' | 'ion' | 'tail';
  tipPixel: [number, number];
  tipWorld: [number, number] | null;
  lengthArcmin: number;
  pa: number;
}

export interface CometResult {
  nucleusPixel: [number, number];
  nucleusWorld: [number, number] | null;
  comaRadiusPx: number;
  comaRadiusArcmin: number;
  confidence: number;
  tails: CometTail[];
}

function rasterBackground(r: ImageRaster): number {
  const vals: number[] = [];
  for (let i = 2; i < r.gw - 2; i += 5) {
    for (let j = 2; j < r.gh - 2; j += 5) vals.push(r.lum(i, j));
  }
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)] ?? 0;
}

/** Mean luminance in a (2k+1)² grid window — suppresses single-cell stars. */
function smooth(r: ImageRaster, gx: number, gy: number, k: number): number {
  let sum = 0;
  let n = 0;
  for (let i = -k; i <= k; i++) {
    for (let j = -k; j <= k; j++) {
      sum += r.lum(gx + i, gy + j);
      n++;
    }
  }
  return sum / n;
}

/** Median luminance in a small disc around a grid cell — robust to stray stars. */
function discMedian(r: ImageRaster, gx: number, gy: number, k: number): number {
  const v: number[] = [];
  for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) v.push(r.lum(gx + i, gy + j));
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)]!;
}

export function detectComet(raster: ImageRaster, wcs?: Wcs, pixscaleArcsec?: number): CometResult | null {
  const r = raster;
  const bg = rasterBackground(r);
  const k = Math.max(2, Math.round(Math.min(r.gw, r.gh) / 60)); // smoothing radius

  // 1. Head = brightest extended (smoothed) blob.
  let head: [number, number] = [0, 0];
  let headVal = -Infinity;
  for (let gx = k; gx < r.gw - k; gx++) {
    for (let gy = k; gy < r.gh - k; gy++) {
      const s = smooth(r, gx, gy, k);
      if (s > headVal) {
        headVal = s;
        head = [gx, gy];
      }
    }
  }
  const peak = headVal - bg;
  if (!(peak > 12)) return null; // no clearly-bright extended source → no comet

  // 2. Nucleus = brightest single cell within the head.
  let nuc = head;
  let nucVal = -Infinity;
  for (let i = -k; i <= k; i++) {
    for (let j = -k; j <= k; j++) {
      const v = r.lum(head[0] + i, head[1] + j);
      if (v > nucVal) {
        nucVal = v;
        nuc = [head[0] + i, head[1] + j];
      }
    }
  }

  // 3. Coma radius = where the smoothed head falls to half-max (grid cells).
  const halfMax = bg + peak * 0.5;
  let comaR = k;
  for (let rad = k; rad < Math.min(r.gw, r.gh) / 2; rad++) {
    let above = 0;
    const N = 16;
    for (let a = 0; a < N; a++) {
      const gx = head[0] + rad * Math.cos((a / N) * 2 * Math.PI);
      const gy = head[1] + rad * Math.sin((a / N) * 2 * Math.PI);
      if (smooth(r, Math.round(gx), Math.round(gy), 1) > halfMax) above++;
    }
    if (above <= N * 0.25) break; // mostly dropped below half-max → coma edge
    comaR = rad;
  }

  // 4. Tails — ray-cast from the head; find directions with a sustained streak.
  const NA = 72;
  const tailThresh = bg + Math.max(6, peak * 0.06); // tails are faint
  const maxDist = Math.hypot(r.gw, r.gh);
  const extent: number[] = new Array(NA).fill(0);
  for (let a = 0; a < NA; a++) {
    const ang = (a / NA) * 2 * Math.PI;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    let gap = 0;
    let far = 0;
    for (let d = comaR + 2; d < maxDist; d += 1) {
      const gx = Math.round(head[0] + d * dx);
      const gy = Math.round(head[1] + d * dy);
      if (gx < 1 || gy < 1 || gx >= r.gw - 1 || gy >= r.gh - 1) break;
      // small cross-window median so a single star doesn't fake a tail
      if (discMedian(r, gx, gy, 1) > tailThresh) {
        far = d;
        gap = 0;
      } else if (++gap > 5) break; // sustained dark → past the tail
    }
    extent[a] = far;
  }

  // Pick the dominant tail direction, then a possible 2nd peak ≥25° away.
  const order = [...extent.keys()].sort((x, y) => extent[y]! - extent[x]!);
  const primary = order[0]!;
  if (!(extent[primary]! > comaR * 3)) return null; // no real tail → not a comet

  // Comet vs nebula guard. A comet has a COMPACT head + brightness concentrated
  // in ONE narrow tail; a nebula has a large bright body glowing in MANY
  // directions. Reject if the head is too big to be a coma, or the tail isn't a
  // dominant outlier direction (most rays should hit dark sky, not nebulosity).
  if (comaR > 0.12 * Math.min(r.gw, r.gh)) return null;
  const medExtent = [...extent].sort((a, b) => a - b)[Math.floor(extent.length / 2)]!;
  if (!(extent[primary]! > 3 * (medExtent + 1))) return null;
  const brightDirs = extent.filter((e) => e > comaR * 3).length;
  if (brightDirs > NA / 6) return null; // bright in too many directions → nebula, not a tail

  // The head must be a bright CONDENSATION, far brighter than the tail — a comet
  // has a sharp coma; a filament/SNR streak (the Pencil) is ~uniform along its
  // length, so its "head" is no brighter than the rest.
  const ang0 = (primary / NA) * 2 * Math.PI;
  let tsum = 0;
  let tn = 0;
  for (let d = comaR + 2; d <= extent[primary]!; d += 1) {
    const v = discMedian(r, Math.round(head[0] + d * Math.cos(ang0)), Math.round(head[1] + d * Math.sin(ang0)), 1);
    if (Number.isFinite(v)) {
      tsum += v;
      tn++;
    }
  }
  const tailExcess = tn ? tsum / tn - bg : 0;
  if (!(nucVal - bg > 3 * Math.max(tailExcess, 1))) return null; // head isn't a bright coma
  const tailAngles = [primary];
  for (const a of order) {
    const sep = Math.min(Math.abs(a - primary), NA - Math.abs(a - primary));
    if (sep * (360 / NA) >= 25 && extent[a]! > Math.max(comaR * 3, extent[primary]! * 0.4)) {
      tailAngles.push(a);
      break;
    }
  }

  const pxFull = (gx: number, gy: number): [number, number] => r.toFull(gx, gy);
  const nucPx = pxFull(nuc[0], nuc[1]);
  const arcminPerGrid =
    pixscaleArcsec != null ? (pixscaleArcsec * (r.fullW / r.gw)) / 60 : 0; // arcmin per grid cell

  const tails: CometTail[] = tailAngles.map((a) => {
    const ang = (a / NA) * 2 * Math.PI;
    const dist = extent[a]!;
    const tipG: [number, number] = [head[0] + dist * Math.cos(ang), head[1] + dist * Math.sin(ang)];
    const tipPixel = pxFull(tipG[0], tipG[1]);
    // mean colour along the tail (coma edge → tip), for dust/ion classification
    let sr = 0;
    let sb = 0;
    let n = 0;
    for (let d = comaR + 2; d <= dist; d += 1) {
      const [rr, , bb] = r.rgb(Math.round(head[0] + d * Math.cos(ang)), Math.round(head[1] + d * Math.sin(ang)));
      sr += rr;
      sb += bb;
      n++;
    }
    const meanR = n ? sr / n : 0;
    const meanB = n ? sb / n : 0;
    const kind: CometTail['kind'] = meanB > meanR * 1.08 ? 'ion' : meanR > meanB * 1.08 ? 'dust' : 'tail';
    // PA: degrees E of N. Image +y is down/south-ish; orientation handled by WCS
    // for world coords, but PA here is a rough display bearing.
    const pa = Math.round((((Math.atan2(Math.cos(ang), -Math.sin(ang)) * 180) / Math.PI) % 360 + 360) % 360);
    return {
      kind,
      tipPixel,
      tipWorld: wcs ? pixelToWorld(wcs, tipPixel[0], tipPixel[1]) : null,
      lengthArcmin: Math.round(dist * arcminPerGrid * 10) / 10,
      pa,
    };
  });

  // If two tails came out the same kind, keep the bluer as ion / redder as dust.
  if (tails.length === 2 && tails[0]!.kind === tails[1]!.kind) {
    tails[0]!.kind = 'dust';
    tails[1]!.kind = 'tail';
  }

  return {
    nucleusPixel: nucPx,
    nucleusWorld: wcs ? pixelToWorld(wcs, nucPx[0], nucPx[1]) : null,
    comaRadiusPx: comaR * (r.fullW / r.gw),
    comaRadiusArcmin: Math.round(comaR * arcminPerGrid * 10) / 10,
    confidence: Math.min(0.8, 0.5 + Math.min(0.3, (extent[primary]! / (comaR * 6)) * 0.3)),
    tails,
  };
}

/** A comet fact object / feature, in the FactObject literal shape (pre-parse). */
export interface CometFactObject {
  id: string;
  role: 'primary' | 'context';
  tier: 'A' | 'B';
  parent_object_id: string | null;
  feature_type?: string;
  feature_class?: 'B-visual';
  names: string[];
  common_name?: { zh?: string; en?: string };
  designations: string[];
  category: 'comet';
  type: { otype: string; zh: string; en: string; source: string };
  coord: { ra_deg: number; dec_deg: number; pixel: [number, number] | null };
  arrow_to?: { ra_deg: number; dec_deg: number; pixel: [number, number] | null };
  size_arcmin?: [number, number];
  catalog_ids: Record<string, string>;
  confidence: number;
  detection_source: 'cv';
  needs_human_review: boolean;
}

const TAIL_FT: Record<CometTail['kind'], 'comet_dust_tail' | 'comet_ion_tail' | 'comet_tail'> = {
  dust: 'comet_dust_tail',
  ion: 'comet_ion_tail',
  tail: 'comet_tail',
};

/**
 * Turn a detection into the comet head object (primary) + its parts (nucleus +
 * tails) as Class-B features. The head's circle is the coma; tails are arrows
 * (nucleus → tip); the nucleus is a small marker.
 */
export function cometToObjects(res: CometResult): CometFactObject[] {
  const w = res.nucleusWorld;
  const ra = w ? w[0] : 0;
  const dec = w ? w[1] : 0;
  const comaD = Math.max(res.comaRadiusArcmin * 2, 0.5);
  const out: CometFactObject[] = [
    {
      id: 'comet1',
      role: 'primary',
      tier: 'A',
      parent_object_id: null,
      names: ['Comet'],
      common_name: { zh: '彗星', en: 'Comet' },
      designations: [],
      category: 'comet',
      type: { otype: '', zh: '彗星', en: 'Comet', source: 'image' },
      coord: { ra_deg: ra, dec_deg: dec, pixel: res.nucleusPixel },
      size_arcmin: [comaD, comaD],
      catalog_ids: {},
      confidence: res.confidence,
      detection_source: 'cv',
      needs_human_review: false,
    },
    {
      id: 'comet_coma',
      role: 'context',
      tier: 'B',
      parent_object_id: 'comet1',
      feature_type: 'comet_coma',
      feature_class: 'B-visual',
      names: [`${FEATURE_TAXONOMY.comet_coma.zh} / ${FEATURE_TAXONOMY.comet_coma.en}`],
      designations: [],
      category: 'comet',
      type: { otype: '', zh: FEATURE_TAXONOMY.comet_coma.zh, en: FEATURE_TAXONOMY.comet_coma.en, source: 'image' },
      coord: { ra_deg: ra, dec_deg: dec, pixel: res.nucleusPixel },
      size_arcmin: [comaD, comaD],
      catalog_ids: {},
      confidence: res.confidence,
      detection_source: 'cv',
      needs_human_review: true,
    },
    {
      id: 'comet_nuc',
      role: 'context',
      tier: 'B',
      parent_object_id: 'comet1',
      feature_type: 'comet_nucleus',
      feature_class: 'B-visual',
      names: [`${FEATURE_TAXONOMY.comet_nucleus.zh} / ${FEATURE_TAXONOMY.comet_nucleus.en}`],
      designations: [],
      category: 'comet',
      type: { otype: '', zh: FEATURE_TAXONOMY.comet_nucleus.zh, en: FEATURE_TAXONOMY.comet_nucleus.en, source: 'image' },
      coord: { ra_deg: ra, dec_deg: dec, pixel: res.nucleusPixel },
      catalog_ids: {},
      confidence: res.confidence,
      detection_source: 'cv',
      needs_human_review: true,
    },
  ];
  res.tails.forEach((t, i) => {
    const ft = TAIL_FT[t.kind];
    const tax = FEATURE_TAXONOMY[ft];
    out.push({
      id: `comet_tail${i + 1}`,
      role: 'context',
      tier: 'B',
      parent_object_id: 'comet1',
      feature_type: ft,
      feature_class: 'B-visual',
      names: [`${tax.zh} / ${tax.en}`],
      designations: [],
      category: 'comet',
      type: { otype: '', zh: tax.zh, en: tax.en, source: 'image' },
      coord: { ra_deg: ra, dec_deg: dec, pixel: res.nucleusPixel },
      arrow_to: { ra_deg: t.tipWorld ? t.tipWorld[0] : ra, dec_deg: t.tipWorld ? t.tipWorld[1] : dec, pixel: t.tipPixel },
      catalog_ids: {},
      confidence: res.confidence,
      detection_source: 'cv',
      needs_human_review: true,
    });
  });
  return out;
}
