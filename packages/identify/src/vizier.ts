import { ofetch } from 'ofetch';
import type { CatalogClient, CatalogCandidate, RegionQuery } from './types.js';

/**
 * VizieR catalog client — the named **nebula** catalogs SIMBAD's `basic` table
 * doesn't carry as sized objects (e.g. Sharpless: "Sh 2-308" resolves to its
 * central star, with no extent). We query VizieR's classic ASU service, which
 * computes J2000 (`_RAJ2000`/`_DEJ2000`) for any catalog and does the cone
 * search server-side, so we never precess old epochs ourselves.
 *
 * Each catalog is typed by construction (a Sharpless entry IS an emission
 * nebula), so we attach a synthetic SIMBAD-style otype the gate/select stage
 * already understands. Cross-catalog duplicates (Sh 2-308 ≡ RCW 11) are merged
 * downstream by the composite client.
 *
 * ⚠ NOT exercised against the live service in CI; the TSV parser is unit-tested.
 */

const log = (m: string): void => console.error(`[vizier] ${m}`);

export interface VizierOptions {
  baseUrl?: string;
  /** Max rows fetched per catalog per region. Default 60. */
  maxPerCatalog?: number;
}

type Row = Record<string, string>;

export interface CatalogSpec {
  /** catalog_ids key + log label. */
  key: string;
  /** VizieR table, e.g. "VII/20/catalog". */
  source: string;
  /** Column carrying the catalogue number. */
  idCol: string;
  /** Extra columns to fetch (sizes). */
  out: string[];
  /** Synthetic otype → objectCategory (HII→emission, RNe→reflection, DNe→dark). */
  otype: string;
  /** Build the display id, e.g. 308 → "Sh 2-308". Gets the row too, so a
   *  catalogue with several designations can lead with the best-known one. */
  name: (id: string, r: Row) => string;
  /** Angular size [major, minor] in arcmin, if derivable. */
  size: (r: Row) => [number, number] | undefined;
  /** Per-row object type, when one static otype won't do (the Bright Star
   *  Catalogue holds ordinary stars and Wolf–Rayet stars side by side, and the
   *  difference decides whether a nebula's exciting star gets drawn). */
  otypeFor?: (r: Row) => string;
  /** Apparent magnitude, for ranking and the naked-eye-star gate. */
  mag?: (r: Row) => number | undefined;
  /** Further names the row carries (proper names, alternative designations) —
   *  Green's SNR table lists "Puppis A" / "Vela (XYZ)" in a `Names` column, and
   *  the ESO PN table carries both a name and a PK designation. */
  extraNames?: (r: Row) => string[];
}

const num = (r: Row, k: string): number => {
  const v = r[k];
  if (v == null || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/** A single diameter column → [d, d]. */
const diam = (r: Row, k: string): [number, number] | undefined => {
  const d = num(r, k);
  return d > 0 ? [d, d] : undefined;
};

/** Major/minor axis columns → [maj, min]. */
const axes = (r: Row, majK: string, minK: string): [number, number] | undefined => {
  const a = num(r, majK);
  if (!(a > 0)) return undefined;
  const b = num(r, minK);
  return [a, b > 0 ? b : a];
};

export const VIZIER_CATALOGS: CatalogSpec[] = [
  // Emission (HII) regions.
  {
    key: 'sharpless',
    source: 'VII/20/catalog',
    idCol: 'Sh2',
    out: ['Diam'],
    otype: 'HII',
    name: (id) => `Sh 2-${id}`,
    size: (r) => diam(r, 'Diam'),
  },
  {
    key: 'rcw',
    source: 'VII/216/rcw',
    idCol: 'RCW',
    out: ['MajAxis', 'MinAxis'],
    otype: 'HII',
    name: (id) => `RCW ${id}`,
    size: (r) => axes(r, 'MajAxis', 'MinAxis'),
  },
  // Reflection nebulae.
  {
    key: 'vdb',
    source: 'VII/21/catalog',
    idCol: 'VdB',
    out: ['BRadMax', 'RRadMax'],
    otype: 'RNe',
    name: (id) => `vdB ${id}`,
    size: (r) => {
      const m = Math.max(num(r, 'BRadMax') || 0, num(r, 'RRadMax') || 0); // radius, arcmin
      return m > 0 ? [2 * m, 2 * m] : undefined;
    },
  },
  {
    key: 'cederblad',
    source: 'VII/231/catalog',
    idCol: 'Ced',
    out: ['Dim1', 'Dim2'],
    otype: 'RNe',
    name: (id) => `Ced ${id}`,
    size: (r) => axes(r, 'Dim1', 'Dim2'),
  },
  // Dark nebulae.
  {
    key: 'barnard',
    source: 'VII/220A/barnard',
    idCol: 'Barn',
    out: ['Diam'],
    otype: 'DNe',
    name: (id) => `B ${id}`,
    size: (r) => diam(r, 'Diam'),
  },
  {
    key: 'ldn',
    source: 'VII/7A/ldn',
    idCol: 'LDN',
    out: ['Area'],
    otype: 'DNe',
    name: (id) => `LDN ${id}`,
    size: (r) => {
      const area = num(r, 'Area'); // square degrees
      if (!(area > 0)) return undefined;
      const d = 2 * Math.sqrt(area / Math.PI) * 60; // equivalent-disc diameter, arcmin
      return [d, d];
    },
  },
  // Supernova remnants. The optically famous ones with NGC numbers (the Veil,
  // the Crab, the Pencil) come from OpenNGC — this table is here for the ones
  // that have no NGC designation at all, which is exactly where the coverage
  // check found holes: Vela SNR (Gum 16) and Puppis A.
  {
    key: 'snr',
    source: 'VII/278/snrs',
    idCol: 'SNR',
    out: ['MajDiam', 'MinAxis', 'Names'],
    otype: 'SNR',
    name: (id) => `SNR G${id.replace(/^G/, '')}`,
    size: (r) => {
      const a = num(r, 'MajDiam');
      if (!(a > 0)) return undefined;
      const b = num(r, 'MinDiam');
      return [a, b > 0 ? b : a];
    },
    // Green lists bare proper names ("Puppis A", "Vela (XYZ)"). Emit the plain
    // form *and* a "… SNR" variant, because that's how these are commonly
    // written elsewhere ("Vela SNR") and identity matching is exact-by-name.
    extraNames: (r) => {
      const out: string[] = [];
      for (const raw of (r['Names'] ?? '').split(',')) {
        const n = raw.replace(/\(.*?\)/g, '').trim();
        if (!n) continue;
        out.push(n);
        if (!/\bSNR\b/i.test(n)) out.push(`${n} SNR`);
      }
      return out;
    },
  },
  // Bright stars. The offline pack was all nebulae, which quietly lost every
  // A-class *star* the moment you went offline — including the Wolf–Rayet star
  // that blew the bubble you're looking at (HD 50896 inside Sh 2-308). The
  // selection stage already knows to add a WR star back when it sits inside a
  // selected WR bubble; it just needs a catalogue that supplies one.
  {
    key: 'bsc',
    source: 'V/50/catalog',
    idCol: 'HR',
    out: ['HD', 'Name', 'Vmag', 'SpType'],
    otype: '*',
    // Lead with the HD number when there is one — that is how these are
    // referred to in practice, and how SIMBAD returned them online.
    name: (id, r) => (r['HD']?.trim() ? `HD ${r['HD'].trim()}` : `HR ${id}`),
    size: () => undefined,
    // WN/WC/WO spectra are Wolf–Rayet stars; everything else is an ordinary star.
    otypeFor: (r) => (/^W[NCO]/i.test((r['SpType'] ?? '').trim()) ? 'WR*' : '*'),
    mag: (r) => {
      const v = num(r, 'Vmag');
      return Number.isFinite(v) ? v : undefined;
    },
    extraNames: (r) => {
      const out: string[] = [];
      const hr = r['HR']?.trim();
      const name = r['Name']?.trim();
      if (hr) out.push(`HR ${hr}`);
      if (name) out.push(`* ${name}`, name);
      return out;
    },
  },
  // Planetary nebulae without an NGC/IC number — the Abell PNe, Jones–Emberson 1
  // and friends, which narrowband imagers do shoot. No size column in this
  // table, so these arrive unsized and rely on the target being known.
  {
    key: 'pn',
    source: 'V/84/main',
    idCol: 'Name',
    out: ['PK'],
    otype: 'PN',
    name: (id) => id.trim(),
    size: () => undefined,
    extraNames: (r) => {
      const pk = (r['PK'] ?? '').trim();
      return pk ? [`PK ${pk.replace(/\s+/g, '.')}`] : [];
    },
  },
];

/**
 * Parse a VizieR ASU-TSV body. Layout after dropping `#` comment lines:
 * header (tab-separated column names), a units line, an optional `---` separator,
 * then data rows. Cells carry leading/trailing spaces.
 */
export function parseAsuTsv(text: string): Row[] {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length < 3) return [];
  const header = lines[0]!.split('\t').map((s) => s.trim());
  const out: Row[] = [];
  for (const line of lines.slice(2)) {
    // Skip ASU's dashed separator line(s) between units and data.
    if (/^[\s-]*$/.test(line.replace(/\t/g, ''))) continue;
    const cells = line.split('\t');
    const row: Row = {};
    header.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim();
    });
    out.push(row);
  }
  return out;
}

/**
 * Turn parsed ASU-TSV rows into catalog candidates. Shared by the online cone
 * client and the offline pack, so a prefetched full table and a live cone query
 * produce byte-identical candidates.
 */
export function rowsToCandidates(spec: CatalogSpec, rows: Row[]): CatalogCandidate[] {
  const out: CatalogCandidate[] = [];
  for (const r of rows) {
    const id = r[spec.idCol];
    if (!id) continue;
    const ra = num(r, '_RAJ2000');
    const dec = num(r, '_DEJ2000');
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
    const name = spec.name(id, r);
    if (!name) continue;
    const extra = spec.extraNames?.(r) ?? [];
    const mag = spec.mag?.(r);
    out.push({
      main_id: name,
      names: [name, ...extra.filter((n) => n !== name)],
      otype: spec.otypeFor?.(r) ?? spec.otype,
      ra_deg: ra,
      dec_deg: dec,
      size_arcmin: spec.size(r),
      ...(mag != null && Number.isFinite(mag) ? { mag } : {}),
      catalog_ids: { [spec.key]: name },
      source: `VizieR:${spec.source}`,
    });
  }
  return out;
}

export function createVizierCatalogClient(opts: VizierOptions = {}): CatalogClient {
  const base = opts.baseUrl ?? 'https://vizier.cds.unistra.fr/viz-bin/asu-tsv';
  const maxPerCatalog = opts.maxPerCatalog ?? 60;

  async function regionFor(spec: CatalogSpec, q: RegionQuery): Promise<CatalogCandidate[]> {
    const text = await ofetch<string, 'text'>(base, {
      method: 'GET',
      responseType: 'text',
      query: {
        '-source': spec.source,
        '-out': [spec.idCol, ...spec.out].join(','),
        '-out.add': '_RAJ2000,_DEJ2000',
        '-c': `${q.ra_deg} ${q.dec_deg}`,
        '-c.rd': String(q.radius_deg),
        '-out.max': String(maxPerCatalog),
      },
      timeout: 30_000,
    });
    return rowsToCandidates(spec, parseAsuTsv(text));
  }

  async function region(q: RegionQuery): Promise<CatalogCandidate[]> {
    const lists = await Promise.all(
      VIZIER_CATALOGS.map((s) =>
        regionFor(s, q).catch((e: unknown) => {
          log(`${s.key} failed: ${(e as Error)?.message ?? e}`);
          return [] as CatalogCandidate[];
        }),
      ),
    );
    const all = lists.flat();
    log(
      `region r=${q.radius_deg.toFixed(3)}° → ${all.length} catalog nebulae (` +
        VIZIER_CATALOGS.map((s, i) => `${s.key}:${lists[i]!.length}`).join(' ') +
        ')',
    );
    return all;
  }

  return { region };
}
