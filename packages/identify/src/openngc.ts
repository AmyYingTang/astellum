import { ofetch } from 'ofetch';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CatalogClient, CatalogCandidate, RegionQuery } from './types.js';

/**
 * OpenNGC catalog client — the open community NGC/IC database
 * (github.com/mattiaverga/OpenNGC). It fills two gaps SIMBAD leaves:
 *  - **angular sizes** for NGC/IC nebulae SIMBAD's `basic` table doesn't size
 *    (e.g. NGC 3576 has no `galdim` in SIMBAD, so it never reaches the size gate
 *    and the field falls back to the broader RCW complex);
 *  - **common names** for the ~130 most famous objects (North America, Veil,
 *    Carina, Tarantula …), which then feed the Wikidata zh-name step.
 *
 * It's a single static CSV (~3.8 MB), so we fetch it once, cache it to disk, and
 * cone-filter locally — there's no server-side cone API. The fetch + parse are
 * lazy and memoised; any failure degrades to an empty result (best-effort, like
 * the other catalog clients).
 */

const log = (m: string): void => console.error(`[openngc] ${m}`);

export const OPENNGC_CSV_URL =
  'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv';

export interface OpenNgcOptions {
  /** Override the CSV URL (tests / mirrors). */
  csvUrl?: string;
  /** Disk cache dir for the downloaded CSV. */
  cacheDir?: string;
  /** Inject the CSV text directly (tests) — skips fetch + cache entirely. */
  csvText?: string;
}

/** OpenNGC `Type` code → a SIMBAD-style otype the gate/select stage understands.
 * Codes with no optical DSO meaning (Dup / NonEx / Nova / Other) are omitted, so
 * those rows are skipped. */
const TYPE_OTYPE: Record<string, string> = {
  G: 'G',
  GPair: 'G',
  GTrpl: 'G',
  GGroup: 'G',
  PN: 'PN',
  SNR: 'SNR',
  HII: 'HII',
  EmN: 'EmO', // emission nebula
  Neb: 'GNe', // generic nebula → emission
  RfN: 'RNe', // reflection
  OCl: 'OpC',
  GCl: 'GlC',
  'Cl+N': 'EmO', // cluster + nebulosity → the nebula is the photographic subject
  // (e.g. NGC 6357 = War and Peace Nebula), so type it as emission, not a cluster
  '*': '*',
  '**': '**',
  '*Ass': '*',
};

/** "11:11:31.67" (HMS) → decimal degrees. */
function hmsToDeg(s: string): number {
  const [h, m, sec] = s.trim().split(':').map(Number);
  if (![h, m, sec].every((n) => Number.isFinite(n))) return NaN;
  return (h! + m! / 60 + sec! / 3600) * 15;
}

/** "-61:21:46.8" (DMS) → decimal degrees. */
function dmsToDeg(s: string): number {
  const t = s.trim();
  const sign = t.startsWith('-') ? -1 : 1;
  const [d, m, sec] = t.replace(/^[+-]/, '').split(':').map(Number);
  if (![d, m, sec].every((n) => Number.isFinite(n))) return NaN;
  return sign * (d! + m! / 60 + sec! / 3600);
}

/** "NGC3576" → "NGC 3576", "IC0434" → "IC 434" (with optional component letter). */
function displayName(raw: string): { name: string; key: 'ngc' | 'ic' } | null {
  const m = /^(NGC|IC)(\d+)([A-Za-z]*)$/.exec(raw.trim());
  if (!m) return null;
  const suffix = m[3] ? m[3].toUpperCase() : '';
  return { name: `${m[1]} ${parseInt(m[2]!, 10)}${suffix}`, key: m[1] === 'IC' ? 'ic' : 'ngc' };
}

const numOr = (v: string | undefined): number | undefined => {
  if (v == null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Parse an OpenNGC `NGC.csv` body (semicolon-separated, header on line 0) into
 * catalog candidates. Exported for unit testing.
 */
export function parseOpenNgc(text: string): CatalogCandidate[] {
  const lines = text.split('\n').filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0]!.split(';').map((s) => s.trim());
  const ci = (name: string): number => header.indexOf(name);
  const iName = ci('Name');
  const iType = ci('Type');
  const iRa = ci('RA');
  const iDec = ci('Dec');
  const iMaj = ci('MajAx');
  const iMin = ci('MinAx');
  const iV = ci('V-Mag');
  const iB = ci('B-Mag');
  const iM = ci('M');
  const iCommon = ci('Common names');
  if (iName < 0 || iType < 0 || iRa < 0 || iDec < 0) return [];

  const out: CatalogCandidate[] = [];
  for (const line of lines.slice(1)) {
    const f = line.split(';');
    const otype = TYPE_OTYPE[(f[iType] ?? '').trim()];
    if (!otype) continue; // Dup / NonEx / Nova / Other — skip
    const named = displayName(f[iName] ?? '');
    if (!named) continue;
    const ra = hmsToDeg(f[iRa] ?? '');
    const dec = dmsToDeg(f[iDec] ?? '');
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;

    const catalog_ids: Record<string, string> = { [named.key]: named.name };
    const mNum = (f[iM] ?? '').trim();
    if (mNum) catalog_ids.messier = `M ${parseInt(mNum, 10)}`;

    const maj = numOr(f[iMaj]);
    const min = numOr(f[iMin]);
    const size_arcmin: [number, number] | undefined =
      maj && maj > 0 ? [maj, min && min > 0 ? min : maj] : undefined;
    const mag = numOr(f[iV]) ?? numOr(f[iB]);

    const commonEn = (f[iCommon] ?? '')
      .split(',')[0]
      ?.trim()
      .replace(/^the\s+/i, ''); // "the War and Peace Nebula" → "War and Peace Nebula"

    const display = catalog_ids.messier ?? named.name;
    out.push({
      main_id: display,
      names: [display, named.name],
      otype,
      ra_deg: ra,
      dec_deg: dec,
      ...(size_arcmin ? { size_arcmin } : {}),
      ...(mag != null ? { mag } : {}),
      catalog_ids,
      source: 'OpenNGC',
      ...(commonEn ? { common_name: { en: commonEn } } : {}),
    });
  }
  return out;
}

const DEG = Math.PI / 180;
function angSepDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const c =
    Math.sin(dec1 * DEG) * Math.sin(dec2 * DEG) +
    Math.cos(dec1 * DEG) * Math.cos(dec2 * DEG) * Math.cos((ra1 - ra2) * DEG);
  return Math.acos(Math.min(1, Math.max(-1, c))) / DEG;
}

function defaultOpenNgcCacheDir(): string {
  return join(homedir(), '.cache', 'astellum', 'openngc');
}

export function createOpenNgcCatalogClient(opts: OpenNgcOptions = {}): CatalogClient {
  const url = opts.csvUrl ?? OPENNGC_CSV_URL;
  const cacheDir = opts.cacheDir ?? defaultOpenNgcCacheDir();
  let cache: Promise<CatalogCandidate[]> | undefined;

  async function loadText(): Promise<string> {
    if (opts.csvText != null) return opts.csvText;
    const file = join(cacheDir, 'NGC.csv');
    try {
      return await readFile(file, 'utf8');
    } catch {
      // miss → fetch + cache
    }
    const text = await ofetch<string, 'text'>(url, {
      method: 'GET',
      responseType: 'text',
      timeout: 60_000,
    });
    try {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(file, text);
      log(`downloaded + cached ${(text.length / 1024).toFixed(0)} KB`);
    } catch {
      // non-fatal: caching is best-effort
    }
    return text;
  }

  function load(): Promise<CatalogCandidate[]> {
    if (!cache) {
      cache = loadText()
        .then(parseOpenNgc)
        .catch((e: unknown) => {
          log(`load failed: ${(e as Error)?.message ?? e}`);
          cache = undefined; // allow a later retry
          return [] as CatalogCandidate[];
        });
    }
    return cache;
  }

  async function region(q: RegionQuery): Promise<CatalogCandidate[]> {
    const all = await load();
    const out = all.filter(
      (c) => angSepDeg(q.ra_deg, q.dec_deg, c.ra_deg, c.dec_deg) <= q.radius_deg,
    );
    log(`region r=${q.radius_deg.toFixed(3)}° → ${out.length} NGC/IC objects (of ${all.length})`);
    return out;
  }

  return { region };
}
