import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CatalogClient, CatalogCandidate, RegionQuery } from './types.js';

/**
 * An on-disk snapshot of online catalogue answers, so a field machine can serve
 * the *exact* results SIMBAD and VizieR gave — not an offline approximation.
 *
 * The offline pack already identifies every one of the 64 annotated targets, so
 * this is not what makes the kiosk work. What it adds is the long tail the
 * static tables don't carry: SIMBAD's fainter companions, proper names, and the
 * Chinese names that come from Wikidata. Warm it offsite for tonight's list and
 * those survive the drive to a dark site.
 *
 * A cached query answers a later one when it covers it: same centre, radius at
 * least as large. That means one generous prewarm per target serves every crop
 * and framing of it afterwards.
 */

const log = (m: string): void => console.error(`[catcache] ${m}`);

/** Bump when the stored shape changes so stale entries are ignored, not replayed. */
const CACHE_VERSION = 1;

export function defaultCatalogCacheDir(): string {
  return process.env.ASTELLUM_CATALOG_CACHE ?? join(homedir(), '.cache', 'astellum', 'region');
}

interface CacheFile {
  v: number;
  ra_deg: number;
  dec_deg: number;
  radius_deg: number;
  saved_at: string;
  candidates: CatalogCandidate[];
}

/** Coordinates are rounded so near-identical framings share one entry. */
function keyFor(q: RegionQuery): string {
  const r = (n: number): string => n.toFixed(3);
  return createHash('sha256')
    .update(`${r(q.ra_deg)}|${r(q.dec_deg)}|${r(q.radius_deg)}`)
    .digest('hex')
    .slice(0, 16);
}

const DEG = Math.PI / 180;
function angSepDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const c =
    Math.sin(dec1 * DEG) * Math.sin(dec2 * DEG) +
    Math.cos(dec1 * DEG) * Math.cos(dec2 * DEG) * Math.cos((ra1 - ra2) * DEG);
  return Math.acos(Math.min(1, Math.max(-1, c))) / DEG;
}

async function readAll(dir: string): Promise<CacheFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: CacheFile[] = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    try {
      const f = JSON.parse(await readFile(join(dir, n), 'utf8')) as CacheFile;
      if (f?.v === CACHE_VERSION && Array.isArray(f.candidates)) out.push(f);
    } catch {
      // unreadable entry — ignore rather than fail the query
    }
  }
  return out;
}

/**
 * Find a stored answer that covers this query: its disc must contain the
 * requested one. Filtering a superset locally is exact, because the candidates
 * carry their own coordinates.
 */
function covering(files: CacheFile[], q: RegionQuery): CacheFile | undefined {
  return files
    .filter((f) => angSepDeg(f.ra_deg, f.dec_deg, q.ra_deg, q.dec_deg) + q.radius_deg <= f.radius_deg + 1e-9)
    .sort((a, b) => a.radius_deg - b.radius_deg)[0]; // tightest cover = least filtering
}

export interface CatalogCacheOptions {
  dir?: string;
  /** Serve from the snapshot only; never call the inner client. Field mode. */
  offline?: boolean;
}

/**
 * Wrap a catalogue client with the snapshot. Writes are best-effort; a failure
 * to cache never fails a query.
 */
export function createCachedCatalogClient(
  inner: CatalogClient,
  opts: CatalogCacheOptions = {},
): CatalogClient {
  const dir = opts.dir ?? defaultCatalogCacheDir();
  let index: Promise<CacheFile[]> | undefined;
  const load = (): Promise<CacheFile[]> => (index ??= readAll(dir));

  return {
    async region(q: RegionQuery): Promise<CatalogCandidate[]> {
      const files = await load();
      const hit = covering(files, q);
      if (hit) {
        const out = hit.candidates.filter((c) => {
          const reach = q.radius_deg + (c.size_arcmin ? c.size_arcmin[0] / 2 / 60 : 0);
          return angSepDeg(q.ra_deg, q.dec_deg, c.ra_deg, c.dec_deg) <= reach;
        });
        log(`hit r=${hit.radius_deg.toFixed(2)}° covering r=${q.radius_deg.toFixed(3)}° → ${out.length}`);
        return out;
      }
      if (opts.offline) {
        log(
          `miss @ (${q.ra_deg.toFixed(2)}, ${q.dec_deg.toFixed(2)}) r=${q.radius_deg.toFixed(3)}° ` +
            `— snapshot has nothing covering this field, and offline mode won't reach the network.`,
        );
        return [];
      }

      const candidates = await inner.region(q);
      try {
        await mkdir(dir, { recursive: true });
        const file: CacheFile = {
          v: CACHE_VERSION,
          ra_deg: q.ra_deg,
          dec_deg: q.dec_deg,
          radius_deg: q.radius_deg,
          saved_at: new Date().toISOString(),
          candidates,
        };
        await writeFile(join(dir, `${keyFor(q)}.json`), JSON.stringify(file), 'utf8');
        index = Promise.resolve([...files, file]);
        log(`stored ${candidates.length} candidates @ r=${q.radius_deg.toFixed(3)}°`);
      } catch {
        // best-effort
      }
      return candidates;
    },
  };
}

/**
 * Where a registry target sits on the sky, derived from its own annotation
 * vertices. The atlas already stores every annotation in ICRS, so a target's
 * centre and extent come straight out of the curated data — no catalogue lookup
 * needed to decide what to prewarm.
 */
export function targetFootprint(
  entry: { primary_id: string; annotations: { geometry: { vertices: [number, number][] } }[] },
): { ra_deg: number; dec_deg: number; radius_deg: number } | null {
  const pts = entry.annotations.flatMap((a) => a.geometry.vertices);
  if (!pts.length) return null;
  // Mean direction via unit vectors, so a target straddling RA 0h behaves.
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [ra, dec] of pts) {
    x += Math.cos(dec * DEG) * Math.cos(ra * DEG);
    y += Math.cos(dec * DEG) * Math.sin(ra * DEG);
    z += Math.sin(dec * DEG);
  }
  const n = pts.length;
  x /= n;
  y /= n;
  z /= n;
  const norm = Math.hypot(x, y, z) || 1;
  const dec0 = Math.asin(z / norm) / DEG;
  const ra0 = ((Math.atan2(y, x) / DEG) + 360) % 360;
  const spread = Math.max(...pts.map(([ra, dec]) => angSepDeg(ra0, dec0, ra, dec)));
  return { ra_deg: ra0, dec_deg: dec0, radius_deg: spread };
}

export interface PrewarmOptions {
  /**
   * Extra degrees beyond the annotated extent.
   *
   * This has to be generous, and the reason is easy to get wrong: annotations
   * mark *structures inside* a target, so their extent is much smaller than the
   * frame someone actually shoots. Measured on the Carina reference image, the
   * annotated spread was 0.85° while the image field was 1.58° — a snug margin
   * stores a disc that covers nothing real, and the snapshot silently never
   * hits. Wide discs cost one bigger query, once.
   */
  marginDeg?: number;
  /** Floor on the queried radius — a tightly annotated target still needs a
   *  useful field around it. */
  minRadiusDeg?: number;
}

export interface PrewarmEntry {
  target: string;
  radius_deg?: number;
  candidates?: number;
  skipped?: string;
  error?: string;
}

/**
 * Warm the snapshot for every annotated target, generously enough that any
 * later framing of the same object is covered. Run this offsite, online.
 */
export async function prewarmTargets(
  entries: { primary_id: string; annotations: { geometry: { vertices: [number, number][] } }[] }[],
  client: CatalogClient,
  opts: PrewarmOptions = {},
): Promise<PrewarmEntry[]> {
  const margin = opts.marginDeg ?? 1.5;
  const floor = opts.minRadiusDeg ?? 2;
  const out: PrewarmEntry[] = [];
  for (const entry of entries) {
    const fp = targetFootprint(entry);
    if (!fp) {
      out.push({ target: entry.primary_id, skipped: 'no annotations to locate it by' });
      continue;
    }
    const radius = Math.max(fp.radius_deg + margin, floor);
    try {
      const c = await client.region({ ra_deg: fp.ra_deg, dec_deg: fp.dec_deg, radius_deg: radius });
      out.push({ target: entry.primary_id, radius_deg: radius, candidates: c.length });
    } catch (e) {
      out.push({ target: entry.primary_id, radius_deg: radius, error: (e as Error).message });
    }
  }
  return out;
}

export interface SnapshotStatus {
  entries: number;
  bytes: number;
  dir: string;
}

export async function catalogCacheStatus(dir = defaultCatalogCacheDir()): Promise<SnapshotStatus> {
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json'));
  } catch {
    return { entries: 0, bytes: 0, dir };
  }
  let bytes = 0;
  for (const n of names) {
    try {
      bytes += (await stat(join(dir, n))).size;
    } catch {
      // ignore
    }
  }
  return { entries: names.length, bytes, dir };
}
