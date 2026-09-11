import { ofetch } from 'ofetch';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CatalogClient, CatalogCandidate, RegionQuery } from './types.js';
import { VIZIER_CATALOGS, parseAsuTsv, rowsToCandidates, type CatalogSpec } from './vizier.js';
import { createOpenNgcCatalogClient, OPENNGC_CSV_URL } from './openngc.js';

/**
 * The offline star-table pack — catalogs on disk, cone-searched in process, so
 * a kiosk works with the network unplugged.
 *
 * Unlike plate solving, catalog lookup needs no clever index: every table here
 * is a small static file, and the whole pack is ~4 MB. VizieR's ASU service
 * will hand over a complete table (`-out.max=unlimited`), and the same TSV
 * parser the online cone client uses reads it back, so a prefetched table and a
 * live query yield identical candidates.
 *
 * Measured against the 64 annotated atlas targets (2026-08-01): 60 resolve with
 * an angular size, 2 resolve without one, and 2 fail — and those 2 fail online
 * against SIMBAD too, because they are tight crops of a sub-structure whose
 * catalogue position sits outside the frame. Onsite that case is covered by
 * picking the target up front rather than discovering it.
 */

const log = (m: string): void => console.error(`[offline] ${m}`);

export function defaultOfflineDir(): string {
  return process.env.ASTELLUM_CATALOG_DIR ?? join(homedir(), '.cache', 'astellum', 'catalogs');
}

const ASU_URL = 'https://vizier.cds.unistra.fr/viz-bin/asu-tsv';

const fileFor = (spec: CatalogSpec): string => `${spec.key}.tsv`;

/** Fetch one complete table and write it to the pack directory. */
async function fetchTable(spec: CatalogSpec, dir: string): Promise<number> {
  const text = await ofetch<string, 'text'>(ASU_URL, {
    method: 'GET',
    responseType: 'text',
    query: {
      '-source': spec.source,
      '-out': [spec.idCol, ...spec.out].join(','),
      '-out.add': '_RAJ2000,_DEJ2000',
      '-out.max': 'unlimited',
    },
    timeout: 120_000,
  });
  const rows = parseAsuTsv(text);
  if (!rows.length) throw new Error(`${spec.key}: table came back empty`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileFor(spec)), text, 'utf8');
  return rows.length;
}

export interface PrefetchResult {
  key: string;
  rows?: number;
  bytes?: number;
  error?: string;
}

/**
 * Download the whole pack. Run this once with a network, offsite; afterwards the
 * kiosk needs nothing. OpenNGC is warmed too (it has its own cache), so one
 * command leaves the machine genuinely field-ready.
 */
export async function prefetchOfflineCatalogs(
  dir = defaultOfflineDir(),
): Promise<PrefetchResult[]> {
  const out: PrefetchResult[] = [];
  for (const spec of VIZIER_CATALOGS) {
    try {
      const rows = await fetchTable(spec, dir);
      const { size } = await stat(join(dir, fileFor(spec)));
      log(`${spec.key}: ${rows} rows, ${(size / 1024).toFixed(1)} KB`);
      out.push({ key: spec.key, rows, bytes: size });
    } catch (e) {
      log(`${spec.key}: FAILED — ${(e as Error).message}`);
      out.push({ key: spec.key, error: (e as Error).message });
    }
  }
  // Warm OpenNGC through its own client so the two caches stay in one place.
  try {
    const ngc = createOpenNgcCatalogClient();
    const probe = await ngc.region({ ra_deg: 83.8, dec_deg: -5.4, radius_deg: 0.5 });
    log(`openngc: warm (${probe.length} objects near the Orion Nebula)`);
    out.push({ key: 'openngc', rows: probe.length });
  } catch (e) {
    log(`openngc: FAILED — ${(e as Error).message}`);
    out.push({ key: 'openngc', error: (e as Error).message });
  }
  return out;
}

export interface CatalogStatus {
  key: string;
  present: boolean;
  rows?: number;
  bytes?: number;
}

/** What's on disk — the "am I ready to go offline?" self-check. */
export async function offlineCatalogStatus(dir = defaultOfflineDir()): Promise<CatalogStatus[]> {
  const out: CatalogStatus[] = [];
  for (const spec of VIZIER_CATALOGS) {
    try {
      const path = join(dir, fileFor(spec));
      const { size } = await stat(path);
      const rows = parseAsuTsv(await readFile(path, 'utf8')).length;
      out.push({ key: spec.key, present: rows > 0, rows, bytes: size });
    } catch {
      out.push({ key: spec.key, present: false });
    }
  }
  try {
    const path = join(homedir(), '.cache', 'astellum', 'openngc', 'NGC.csv');
    const { size } = await stat(path);
    out.push({ key: 'openngc', present: true, bytes: size });
  } catch {
    out.push({ key: 'openngc', present: false });
  }
  return out;
}

/** True when every table is on disk — safe to unplug. */
export function isOfflineReady(status: CatalogStatus[]): boolean {
  return status.every((s) => s.present);
}

export interface OfflineCatalogOptions {
  /** Pack directory. Default `~/.cache/astellum/catalogs`. */
  dir?: string;
  /** Include OpenNGC (NGC/IC/M). Default true — it carries most targets. */
  openngc?: boolean;
}

const DEG = Math.PI / 180;
function angSepDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const c =
    Math.sin(dec1 * DEG) * Math.sin(dec2 * DEG) +
    Math.cos(dec1 * DEG) * Math.cos(dec2 * DEG) * Math.cos((ra1 - ra2) * DEG);
  return Math.acos(Math.min(1, Math.max(-1, c))) / DEG;
}

/**
 * A CatalogClient backed entirely by the on-disk pack. Tables are parsed once,
 * lazily, then every region query is an in-memory filter — no network, and fast
 * enough that it never shows up next to the plate solve.
 *
 * A missing table is skipped with a log line rather than failing the query: a
 * partial pack still identifies most targets, and staying silent about it would
 * make an under-covered kiosk look like a working one.
 */
export function createOfflineCatalogClient(opts: OfflineCatalogOptions = {}): CatalogClient {
  const dir = opts.dir ?? defaultOfflineDir();
  const ngc = opts.openngc === false ? null : createOpenNgcCatalogClient();
  let cache: Promise<{ loaded: string[]; missing: string[]; all: CatalogCandidate[] }> | undefined;

  function load(): Promise<{ loaded: string[]; missing: string[]; all: CatalogCandidate[] }> {
    if (!cache) {
      cache = (async () => {
        const all: CatalogCandidate[] = [];
        const loaded: string[] = [];
        const missing: string[] = [];
        for (const spec of VIZIER_CATALOGS) {
          try {
            const rows = parseAsuTsv(await readFile(join(dir, fileFor(spec)), 'utf8'));
            const cands = rowsToCandidates(spec, rows);
            all.push(...cands);
            loaded.push(`${spec.key}:${cands.length}`);
          } catch {
            missing.push(spec.key);
          }
        }
        if (missing.length) {
          log(
            `missing tables: ${missing.join(', ')} — coverage is reduced. ` +
              `Run \`astellum prefetch\` while you still have a network.`,
          );
        }
        log(`loaded ${all.length} objects from ${loaded.length} tables (${loaded.join(' ')})`);
        return { loaded, missing, all };
      })().catch((e: unknown) => {
        log(`load failed: ${(e as Error)?.message ?? e}`);
        cache = undefined; // allow a retry
        return { loaded: [], missing: [], all: [] as CatalogCandidate[] };
      });
    }
    return cache;
  }

  async function region(q: RegionQuery): Promise<CatalogCandidate[]> {
    const { all } = await load();
    const near = all.filter((c) => {
      // Match the online gate's spirit: a big object whose centre is outside the
      // frame still counts when its extent reaches in.
      const reach = q.radius_deg + (c.size_arcmin ? c.size_arcmin[0] / 2 / 60 : 0);
      return angSepDeg(q.ra_deg, q.dec_deg, c.ra_deg, c.dec_deg) <= reach;
    });
    const fromNgc = ngc ? await ngc.region(q) : [];
    log(`region r=${q.radius_deg.toFixed(3)}° → ${near.length} tabled + ${fromNgc.length} NGC/IC`);
    return [...fromNgc, ...near];
  }

  return { region };
}

export { OPENNGC_CSV_URL };

/**
 * astrometry.net index files, by scale band.
 *
 * These are the only genuinely large thing an offline install needs — the star
 * tables and the atlas together are under 5 MB, while the indexes run from a
 * couple of hundred megabytes to tens of gigabytes. The size is decided entirely
 * by the *smallest* field you must solve: a band covers roughly a quarter of its
 * own scale in field width, and each finer band is about twice the size of the
 * one above it.
 *
 * So this is deliberately a question rather than a download button: tell it the
 * narrowest field you shoot, and it fetches that band and everything wider.
 */
export interface IndexBand {
  scale: number;
  /** Field widths this band solves, in arcminutes. */
  minArcmin: number;
  maxArcmin: number;
  /** Split into 12 or 48 healpix files below this scale; one file above. */
  parts: number;
  /** Approximate download size, MB. */
  approxMb: number;
}

/** The 4200 (Tycho-2) series — the general-purpose set for deep-sky work. */
export const INDEX_BANDS: IndexBand[] = [
  { scale: 4219, minArcmin: 1400, maxArcmin: 2000, parts: 1, approxMb: 0.1 },
  { scale: 4218, minArcmin: 1000, maxArcmin: 1400, parts: 1, approxMb: 0.2 },
  { scale: 4217, minArcmin: 680, maxArcmin: 1000, parts: 1, approxMb: 0.2 },
  { scale: 4216, minArcmin: 480, maxArcmin: 680, parts: 1, approxMb: 0.3 },
  { scale: 4215, minArcmin: 340, maxArcmin: 480, parts: 1, approxMb: 0.6 },
  { scale: 4214, minArcmin: 240, maxArcmin: 340, parts: 1, approxMb: 1 },
  { scale: 4213, minArcmin: 170, maxArcmin: 240, parts: 1, approxMb: 2 },
  { scale: 4212, minArcmin: 120, maxArcmin: 170, parts: 1, approxMb: 4 },
  { scale: 4211, minArcmin: 85, maxArcmin: 120, parts: 1, approxMb: 8 },
  { scale: 4210, minArcmin: 60, maxArcmin: 85, parts: 1, approxMb: 20 },
  { scale: 4209, minArcmin: 42, maxArcmin: 60, parts: 1, approxMb: 39 },
  { scale: 4208, minArcmin: 30, maxArcmin: 42, parts: 1, approxMb: 78 },
  { scale: 4207, minArcmin: 22, maxArcmin: 30, parts: 12, approxMb: 158 },
  { scale: 4206, minArcmin: 16, maxArcmin: 22, parts: 12, approxMb: 313 },
  { scale: 4205, minArcmin: 11, maxArcmin: 16, parts: 12, approxMb: 629 },
  { scale: 4204, minArcmin: 8, maxArcmin: 11, parts: 48, approxMb: 1238 },
  { scale: 4203, minArcmin: 5.6, maxArcmin: 8, parts: 48, approxMb: 2506 },
];

/** Measured on real solves: the band that matches is about a third of the
 *  field's width, so a frame this wide needs bands down to width/4. */
export function bandsForField(minFieldArcmin: number): IndexBand[] {
  const floor = minFieldArcmin / 4;
  return INDEX_BANDS.filter((b) => b.maxArcmin >= floor);
}

/**
 * The distinct choices worth offering, generated from the band table so the
 * label and the size can never drift apart. Each entry is "the narrowest field
 * this set can solve" and the cumulative download for it; two different numbers
 * that pull the same bands would be two ways of saying the same thing.
 */
export function indexChoices(): { minFieldArcmin: number; mb: number; bands: number[] }[] {
  const out: { minFieldArcmin: number; mb: number; bands: number[] }[] = [];
  let mb = 0;
  const bands: number[] = [];
  for (const b of INDEX_BANDS) {
    mb += b.approxMb;
    bands.push(b.scale);
    // A band whose widest scale is X can be the finest one needed by a field of
    // about 4X — the same relation bandsForField uses.
    out.push({ minFieldArcmin: Math.round(b.maxArcmin * 4), mb, bands: [...bands] });
  }
  // Only the useful end of the range: below ~20′ the download runs to gigabytes
  // for fields most deep-sky rigs never shoot.
  return out.filter((o) => o.minFieldArcmin <= 2000 && o.minFieldArcmin >= 20);
}

/**
 * Is this file already fully downloaded?
 *
 * "It exists and is non-empty" is not the same question. A download killed
 * halfway leaves a file that passes that test forever, so a resume skips it and
 * the solver fails on it every run — which is how `index-4204-23.fits` sat at
 * 12 MB against its siblings' 26 MB without anything noticing. Ask the server
 * how big it should be and compare.
 *
 * A server that won't say (no content-length) leaves us no better test than
 * before, so a non-empty file is accepted rather than re-fetched every time.
 */
export async function isComplete(path: string, url: string): Promise<boolean> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return false;
  }
  if (size === 0) return false;
  try {
    const head = await fetch(url, { method: 'HEAD' });
    const expected = Number(head.headers.get('content-length'));
    if (!Number.isFinite(expected) || expected <= 0) return true;
    return size === expected;
  } catch {
    return true; // offline mid-check: don't discard what is already here
  }
}

export function indexUrls(bands: IndexBand[]): { url: string; file: string; mb: number }[] {
  const out: { url: string; file: string; mb: number }[] = [];
  for (const b of bands) {
    if (b.parts === 1) {
      out.push({
        url: `http://data.astrometry.net/4200/index-${b.scale}.fits`,
        file: `index-${b.scale}.fits`,
        mb: b.approxMb,
      });
    } else {
      for (let i = 0; i < b.parts; i++) {
        const h = String(i).padStart(2, '0');
        out.push({
          url: `http://data.astrometry.net/4200/index-${b.scale}-${h}.fits`,
          file: `index-${b.scale}-${h}.fits`,
          mb: b.approxMb / b.parts,
        });
      }
    }
  }
  return out;
}
