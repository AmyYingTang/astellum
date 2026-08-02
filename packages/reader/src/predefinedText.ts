import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  DEFAULT_STYLE,
  PredefinedLibrary,
  featureNoteFor,
  findPredefined,
  mergeLibraries,
  pickStyle,
} from '@astrolens/schema';
import type {
  FactObject,
  FactSheet,
  LocalizedString,
  ReadingFallback,
} from '@astrolens/schema';

/**
 * The no-LLM text source for onsite mode.
 *
 * Onsite there is no network and no `claude` CLI, so every explanation has to be
 * pre-written. Text is looked up per feature through four layers, in the order
 * the active profile's `reading.fallback` lists them:
 *
 *   1. `target`           — this exact target, in the chosen style
 *   2. `annotation_note`  — the curator's note on this annotation
 *   3. `feature_generic`  — the type-level note (11 types, plain language)
 *   4. `facts`            — a template built from grounded facts
 *
 * Never blank and never invented: a target nobody has written up still gets the
 * generic layer, and `sources` tells the UI to label it as a generic note rather
 * than passing it off as a bespoke reading.
 */

export const ALL_FALLBACKS: ReadingFallback[] = [
  'target',
  'annotation_note',
  'feature_generic',
  'facts',
];

/** The shipped, curated library (read-only from a user's perspective). */
export function defaultReadingsPath(): string {
  return process.env.ASTROLENS_READINGS ?? resolve('packages/atlas/data/readings.json');
}

/** A self-deployer's own entries, merged on top of the baseline. */
export function userReadingsPath(): string {
  return (
    process.env.ASTROLENS_USER_READINGS ?? join(homedir(), '.astrolens', 'readings.json')
  );
}

export function defaultReadingsPaths(): string[] {
  return [defaultReadingsPath(), userReadingsPath()];
}

/** Read + validate one library file. null when absent (a valid "none yet" state). */
export async function loadReadingLibrary(path: string): Promise<PredefinedLibrary | null> {
  try {
    return PredefinedLibrary.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/** Load + merge several library files (missing ones skipped). null if none. */
export async function loadReadingLibraries(paths: string[]): Promise<PredefinedLibrary | null> {
  const libs: PredefinedLibrary[] = [];
  for (const p of paths) {
    const l = await loadReadingLibrary(p);
    if (l) libs.push(l);
  }
  return libs.length ? mergeLibraries(libs) : null;
}

const has = (s?: LocalizedString): boolean => !!s && (!!s.zh.trim() || !!s.en.trim());

const PC_TO_LY = 3.26156;
const UNIT_TO_LY: Record<string, number> = {
  pc: PC_TO_LY,
  kpc: PC_TO_LY * 1000,
  Mpc: PC_TO_LY * 1_000_000,
  ly: 1,
};

function distanceLy(obj: FactObject): number | undefined {
  const d = obj.distance;
  if (!d) return undefined;
  const k = UNIT_TO_LY[d.unit];
  return k ? Math.round(d.value * k) : undefined;
}

const fmt = (n: number): string => n.toLocaleString('en-US');

/** "Emission nebula" → "emission nebula", but "Wolf–Rayet star" is left alone.
 *  A type label is sentence-cased, so its first word carries no other capital
 *  unless it is a proper name — which must not be flattened. */
function lowerFirst(s: string): string {
  const first = s.split(/\s+/)[0] ?? '';
  if (/[A-Z]/.test(first.slice(1))) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** "a" or "an", by sound-as-spelled — enough for the type labels we emit. */
const article = (s: string): string => (/^[aeiou]/i.test(s) ? 'an' : 'a');

/**
 * Last-resort text, built only from things the fact sheet actually knows. It
 * states less rather than guessing — an honest "we know its type and how far
 * away it is" beats invented prose.
 */
function factsTemplate(obj: FactObject): LocalizedString {
  const name = obj.common_name?.zh || obj.common_name?.en || obj.names[0] || obj.id;
  const ly = distanceLy(obj);
  const size = obj.size_arcmin?.[0];

  const zh = [
    `${name}是一个${obj.type.zh}。`,
    ly ? `距离我们大约 ${fmt(ly)} 光年。` : '',
    size ? `在天空中张开约 ${size.toFixed(0)} 角分。` : '',
  ]
    .filter(Boolean)
    .join('');
  const typeEn = lowerFirst(obj.type.en);
  const en = [
    `${obj.common_name?.en || obj.names[0] || obj.id} is ${article(typeEn)} ${typeEn}.`,
    ly ? ` It lies about ${fmt(ly)} light-years away.` : '',
    size ? ` It spans roughly ${size.toFixed(0)} arcminutes on the sky.` : '',
  ]
    .filter(Boolean)
    .join('');
  return { zh, en };
}

export interface PredefinedText {
  explanation: LocalizedString;
  physics?: LocalizedString;
  interesting?: LocalizedString;
}

export interface PredefinedResult {
  narrative: LocalizedString;
  /** FactObject id → text, ready to hand to the Reading builder. */
  byId: Map<string, PredefinedText>;
  /** Element 2/4/5 of a target-level entry, surfaced as extra facts. */
  extraFacts: LocalizedString[];
  /** FactObject id → which layer supplied its text. Drives the "generic note"
   *  label in the UI and the operator's coverage panel. */
  sources: Map<string, ReadingFallback>;
  /** The target entry that matched, if any (null → nothing written for it). */
  matchedTarget: string | null;
  /** Which style was actually rendered (may differ from the one requested). */
  style: string | null;
}

export interface PredefinedOptions {
  /** Style to render; falls back within the entry when absent (pickStyle). */
  style?: string;
  /** Which layers are enabled, in order. Defaults to all four. */
  fallback?: ReadingFallback[];
}

/**
 * Resolve text for every object in a fact sheet from the predefined library.
 * Pure (no I/O) so it can be unit-tested and reused by the kiosk path.
 */
export function resolvePredefinedText(
  factsheet: FactSheet,
  library: PredefinedLibrary | null,
  opts: PredefinedOptions = {},
): PredefinedResult {
  const order = opts.fallback?.length ? opts.fallback : ALL_FALLBACKS;
  const enabled = new Set(order);

  const aObjects = factsheet.objects.filter((o) => o.tier !== 'B');
  const primary = aObjects[0];

  const ids = primary
    ? [...primary.names, ...primary.designations, ...Object.values(primary.catalog_ids)]
    : [];
  const entry = library && enabled.has('target') ? findPredefined(library, ids) : undefined;
  const picked = entry ? pickStyle(entry, opts.style ?? DEFAULT_STYLE) : undefined;

  const byAnnotation = new Map(
    (picked?.style.features ?? []).map((f) => [f.annotation_id, f] as const),
  );

  const byId = new Map<string, PredefinedText>();
  const sources = new Map<string, ReadingFallback>();

  for (const obj of factsheet.objects) {
    for (const layer of order) {
      if (layer === 'target') {
        const t = obj.atlas_annotation_id ? byAnnotation.get(obj.atlas_annotation_id) : undefined;
        if (t && has(t.explanation)) {
          byId.set(obj.id, {
            explanation: t.explanation,
            physics: t.physics,
            interesting: t.interesting,
          });
          sources.set(obj.id, 'target');
          break;
        }
        continue;
      }
      if (layer === 'annotation_note') {
        if (has(obj.atlas_note)) {
          byId.set(obj.id, { explanation: obj.atlas_note! });
          sources.set(obj.id, 'annotation_note');
          break;
        }
        continue;
      }
      if (layer === 'feature_generic') {
        const note = obj.feature_type ? featureNoteFor(obj.feature_type) : undefined;
        if (note) {
          byId.set(obj.id, { explanation: note });
          sources.set(obj.id, 'feature_generic');
          break;
        }
        continue;
      }
      // 'facts' — always available, so this terminates the loop.
      byId.set(obj.id, { explanation: factsTemplate(obj) });
      sources.set(obj.id, 'facts');
      break;
    }
  }

  // narrative is optional on a style, so an overlay can correct one part of a
  // shipped reading; a target with none anywhere still gets the facts template.
  const narrative =
    picked && has(picked.style.narrative)
      ? picked.style.narrative!
      : primary
        ? factsTemplate(primary)
        : { zh: '', en: '' };

  const extraFacts: LocalizedString[] = [];
  if (picked) {
    if (has(picked.style.scale)) extraFacts.push(picked.style.scale!);
    if (has(picked.style.culture)) extraFacts.push(picked.style.culture!);
    for (const f of picked.style.fun_facts) if (has(f)) extraFacts.push(f);
  }

  return {
    narrative,
    byId,
    extraFacts,
    sources,
    matchedTarget: entry?.primary_id ?? null,
    style: picked?.name ?? null,
  };
}

/** Counts per layer — the operator panel's "what did we actually show" summary. */
export function coverageSummary(result: PredefinedResult): Record<ReadingFallback, number> {
  const out: Record<ReadingFallback, number> = {
    target: 0,
    annotation_note: 0,
    feature_generic: 0,
    facts: 0,
  };
  for (const layer of result.sources.values()) out[layer] += 1;
  return out;
}
