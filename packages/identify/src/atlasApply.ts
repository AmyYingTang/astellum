import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import {
  Registry,
  normalizeId,
  findRegistryEntry,
  worldToPixel,
  pixelToWorld,
  FEATURE_TAXONOMY,
  type Wcs,
  type RegistryEntry,
  type RegistryAnnotation,
  type FeatureTypeKey,
  type ObjectCategory,
} from '@astellum/schema';

// Atlas Apply — the B-class feature source. For each identified A-object, look it
// up in the approved atlas registry; project the stored ICRS annotations onto the
// user image via its WCS; emit tier-B FactObjects. Pure deterministic WCS
// transfer — no ML, no image matching. This is B-class features' ONLY source;
// the old auto detectors (geometric priors / outreach morphology / CV / VLM) are
// disconnected from the factsheet in assemble.ts.

/** The atlas tool's feature vocabulary → the pipeline's FeatureType taxonomy
 *  (for enum validity + colour + label). Shape is carried separately via
 *  `geometry_kind`, so a type's canonical shape here doesn't constrain drawing. */
const ATLAS_TO_PIPELINE: Record<string, FeatureTypeKey> = {
  pillar: 'pillar',
  bright_rim: 'ionization_front',
  filament: 'snr_filament',
  silhouette: 'silhouette_shape',
  globule: 'cometary_globule',
  dust_lane: 'dust_lane',
  shell: 'bubble_shell',
  spiral_arm: 'spiral_arm',
  tidal_tail: 'tidal_tail',
  region: 'emission_color_region',
  jet: 'hh_jet',
};

function pipelineType(atlasType: string): FeatureTypeKey {
  return ATLAS_TO_PIPELINE[atlasType] ?? 'emission_color_region';
}

const PIPELINE_TO_ATLAS = Object.fromEntries(
  Object.entries(ATLAS_TO_PIPELINE).map(([a, p]) => [p, a]),
) as Record<string, string>;

/**
 * The inverse map, for writing annotations *back* into the atlas vocabulary
 * (a curator's hand-drawn feature saved to their overlay). Anything without a
 * counterpart becomes a plain region callout rather than a guessed type —
 * mislabelling a structure is worse than calling it "a region worth noting".
 */
export function atlasTypeFor(pipeline: FeatureTypeKey | undefined): string {
  return (pipeline && PIPELINE_TO_ATLAS[pipeline]) ?? 'region';
}

/** The shipped, curated baseline registry: `$ATLAS_REGISTRY`, else the atlas
 *  package's committed `packages/atlas/data/registry.json` (relative to cwd —
 *  callers run from the repo root). Read-only from a user's perspective. */
export function defaultRegistryPath(): string {
  return process.env.ATLAS_REGISTRY ?? resolve('packages/atlas/data/registry.json');
}

/** A self-deployer's local overlay registry (their own approved annotations):
 *  `$ATLAS_USER_REGISTRY`, else `~/.astellum/atlas/registry.json`. Merged on
 *  top of the baseline so users extend coverage without touching the shipped
 *  data. */
export function userRegistryPath(): string {
  return process.env.ATLAS_USER_REGISTRY ?? join(homedir(), '.astellum', 'atlas', 'registry.json');
}

/** The layered default: baseline first, then the user overlay. */
export function defaultRegistryPaths(): string[] {
  return [defaultRegistryPath(), userRegistryPath()];
}

/** Read + validate a registry.json. Returns null if the file is absent (a valid
 *  "no atlas" state). */
export async function loadRegistry(path: string): Promise<Registry | null> {
  try {
    return Registry.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/** Merge registries in priority order (later overlays extend earlier baselines).
 *  Entries with the same normalized primary_id are unioned: aliases combined,
 *  annotations concatenated (baseline first). Disjoint ids are just added. */
export function mergeRegistries(regs: Registry[]): Registry {
  const byKey = new Map<string, RegistryEntry>();
  const order: string[] = [];
  for (const reg of regs) {
    for (const entry of reg.objects) {
      const key = normalizeId(entry.primary_id);
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, { ...entry, aliases: [...entry.aliases], annotations: [...entry.annotations] });
        order.push(key);
      } else {
        for (const a of entry.aliases) if (!prev.aliases.includes(a)) prev.aliases.push(a);
        prev.annotations.push(...entry.annotations);
      }
    }
  }
  return { schema_version: 1, objects: order.map((k) => byKey.get(k)!) };
}

/** Load + merge several registry files (missing ones skipped). null if none. */
export async function loadRegistries(paths: string[]): Promise<Registry | null> {
  const regs: Registry[] = [];
  for (const p of paths) {
    const r = await loadRegistry(p);
    if (r) regs.push(r);
  }
  return regs.length ? mergeRegistries(regs) : null;
}

/** The A-object fields apply needs (subset of the assembled factsheet object). */
export interface AtlasHost {
  id: string;
  category: ObjectCategory;
  names: string[];
  designations: string[];
  catalog_ids: Record<string, string>;
}

/** Display name for an annotation: its bilingual label, else the taxonomy name,
 *  with an ordinal appended when >1 unnamed feature of the same type is present
 *  (so "Pillar 1"/"Pillar 2" stay distinguishable — mirrors the tool). */
function nameFor(
  anno: RegistryAnnotation,
  ord: number | null,
  ftKey: FeatureTypeKey,
): { zh: string; en: string } {
  const zh = anno.label.zh.trim();
  const en = anno.label.en.trim();
  if (zh || en) return { zh: zh || en, en: en || zh };
  const tax = FEATURE_TAXONOMY[ftKey];
  const suffix = ord != null ? ` ${ord}` : '';
  return { zh: `${tax.zh}${suffix}`, en: `${tax.en}${suffix}` };
}

function projectAnnotation(
  anno: RegistryAnnotation,
  wcs: Wcs,
): { px: [number, number][]; anyInFrame: boolean } | null {
  const px: [number, number][] = [];
  let anyInFrame = false;
  for (const [ra, dec] of anno.geometry.vertices) {
    const p = worldToPixel(wcs, ra, dec);
    if (!p) continue; // behind the tangent plane
    px.push([Math.round(p[0]), Math.round(p[1])]);
    if (p[0] >= 0 && p[0] <= wcs.width && p[1] >= 0 && p[1] <= wcs.height) anyInFrame = true;
  }
  if (px.length === 0 || !anyInFrame) return null; // wholly off-frame → drop
  return { px, anyInFrame };
}

/**
 * Project a matched entry's approved annotations onto the user image.
 * `hostId` is the FactObject id of the A-object this entry matched (parent link).
 */
function entryToFeatures(entry: RegistryEntry, host: AtlasHost, wcs: Wcs): Array<Record<string, unknown>> {
  // Ordinals for unnamed features, per atlas feature_type within this entry.
  const unnamedByType = new Map<string, number>();
  for (const a of entry.annotations) {
    if (!a.label.zh.trim() && !a.label.en.trim())
      unnamedByType.set(a.feature_type, (unnamedByType.get(a.feature_type) ?? 0) + 1);
  }
  const seen = new Map<string, number>();

  const out: Array<Record<string, unknown>> = [];
  entry.annotations.forEach((anno, k) => {
    const proj = projectAnnotation(anno, wcs);
    if (!proj) return;
    const { px } = proj;
    const ftKey = pipelineType(anno.feature_type);

    let ord: number | null = null;
    if (!anno.label.zh.trim() && !anno.label.en.trim() && (unnamedByType.get(anno.feature_type) ?? 0) > 1) {
      ord = (seen.get(anno.feature_type) ?? 0) + 1;
      seen.set(anno.feature_type, ord);
    }
    const name = nameFor(anno, ord, ftKey);

    const cx = Math.round(px.reduce((s, p) => s + p[0], 0) / px.length);
    const cy = Math.round(px.reduce((s, p) => s + p[1], 0) / px.length);
    const [craDeg, cdecDeg] = pixelToWorld(wcs, cx, cy);

    // A curator-placed label anchor (sky) projects onto this image so the name
    // sits where they put it, not at the auto top-edge position.
    let labelPixel: [number, number] | undefined;
    if (anno.label_anchor) {
      const lp = worldToPixel(wcs, anno.label_anchor[0], anno.label_anchor[1]);
      if (lp) labelPixel = [Math.round(lp[0]), Math.round(lp[1])];
    }

    out.push({
      id: `atlas_${host.id}_${k + 1}`,
      role: 'context',
      tier: 'B',
      parent_object_id: host.id,
      feature_type: ftKey,
      feature_class: 'A+', // human-drawn + reviewer-approved
      names: [`${name.zh} / ${name.en}`],
      designations: [],
      category: host.category,
      type: { otype: '', zh: name.zh, en: name.en, source: 'atlas' },
      coord: { ra_deg: craDeg, dec_deg: cdecDeg, pixel: [cx, cy] as [number, number] },
      geometry_kind: anno.geometry.type,
      ...(anno.geometry.type === 'point' ? {} : { polygon: px }),
      ...(labelPixel ? { label_pixel: labelPixel } : {}),
      // Carried for the predefined-reading lookup (target text → this note →
      // the type-level generic note → a facts template).
      ...(anno.id ? { atlas_annotation_id: anno.id } : {}),
      ...(anno.note ? { atlas_note: anno.note } : {}),
      catalog_ids: {},
      confidence: 1,
      type_confidence: 1,
      localization: { method: 'world_to_pixel' as const, confidence: 0.9 },
      detection_source: 'atlas' as const,
      needs_human_review: false,
    });
  });
  return out;
}

export interface AtlasApplyResult {
  features: Array<Record<string, unknown>>;
  /** Hosts (nebula-type) that had no atlas match — for the "no baseline yet" hint. */
  unmatched: AtlasHost[];
}

/** Match each host against the registry and project its approved annotations. */
export function applyAtlas(hosts: AtlasHost[], wcs: Wcs, registry: Registry): AtlasApplyResult {
  const features: Array<Record<string, unknown>> = [];
  const unmatched: AtlasHost[] = [];
  for (const host of hosts) {
    const ids = [...host.names, ...host.designations, ...Object.values(host.catalog_ids)];
    const entry = findRegistryEntry(registry, ids);
    if (!entry) {
      unmatched.push(host);
      continue;
    }
    features.push(...entryToFeatures(entry, host, wcs));
  }
  return { features, unmatched };
}
