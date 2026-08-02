import { z } from 'zod';

/**
 * The control file — one place that says how this machine is set up, instead of
 * the switches being scattered across environment variables with no way to see
 * them together.
 *
 * It is flat and global on purpose. An earlier version had two named profiles,
 * studio and kiosk, each holding a full copy of every knob — which turned out to
 * be modelling the wrong thing. What differs between those two is not
 * configuration, it is *what the two programs do*: a kiosk shows pre-written
 * readings because that is what a kiosk is, and tightens its selection because
 * an audience wants few confident labels. None of that is a preference someone
 * should have to set, or could sensibly set differently.
 *
 * What genuinely is a preference is machine-level and applies everywhere: which
 * solver, which catalogues, which tool writes the text. Those are here, one
 * value each.
 *
 * This module is PURE (zod + defaults) because @astrolens/schema is bundled into
 * the browser clients. Disk loading + env overlay live in `configLoad.ts`,
 * behind the `@astrolens/schema/node` subpath.
 */

export const SolveMode = z.enum(['nova', 'local']);
export type SolveMode = z.infer<typeof SolveMode>;

/**
 * Catalog sources.
 *  - `offline`  — the bundled static star-table pack (no network, ever)
 *  - `snapshot` — replayed answers from a prewarmed online query cache
 * The rest are live services.
 */
export const CatalogSource = z.enum(['simbad', 'vizier', 'openngc', 'offline', 'snapshot']);
export type CatalogSource = z.infer<typeof CatalogSource>;

/** Which tool writes the explanatory text. */
export const ReadingMode = z.enum(['ai', 'predefined']);
export type ReadingMode = z.infer<typeof ReadingMode>;

/** Where a predefined explanation may come from, in lookup order. Never blank,
 *  never invented: the last resort is a template built from grounded facts. */
export const ReadingFallback = z.enum(['target', 'annotation_note', 'feature_generic', 'facts']);
export type ReadingFallback = z.infer<typeof ReadingFallback>;

export const RegistryLayer = z.enum(['baseline', 'user']);
export type RegistryLayer = z.infer<typeof RegistryLayer>;

export const SolveConfig = z.object({
  mode: SolveMode.default('nova'),
  /** Content-addressed on-disk solve cache (createCachedSolveClient). */
  cache: z.boolean().default(true),
  /** Feed a known target's RA/Dec to solve-field as a search hint — it cuts a
   *  solve from tens of seconds to a few. Ignored by nova. */
  hintFromTarget: z.boolean().default(true),
  /**
   * Field-width bounds in degrees, passed to the local solver as a scale hint.
   *
   * Set by the rig — focal length and sensor — so it is a machine-level
   * preference like the rest of this, and it speeds a blind solve up a lot.
   * Leave both unset to search every scale; set them too tightly and a frame
   * outside the range will not solve at all, which is why they are a pair and
   * only take effect together.
   */
  fovLowDeg: z.number().positive().optional(),
  fovHighDeg: z.number().positive().optional(),
  /** Give up rather than leave an audience staring at a spinner. */
  timeoutMs: z.number().int().positive().optional(),
});
export type SolveConfig = z.infer<typeof SolveConfig>;

export const CatalogConfig = z.object({
  sources: z.array(CatalogSource).default(['simbad', 'vizier', 'openngc']),
  /** Keep an on-disk snapshot of online catalogue answers, so a field machine
   *  can serve the exact results SIMBAD/VizieR gave — the faint companions and
   *  Chinese names the static pack doesn't carry. */
  snapshot: z.boolean().default(true),
  /** Answer only from the snapshot; never reach the network. */
  snapshotOnly: z.boolean().default(false),
});
export type CatalogConfig = z.infer<typeof CatalogConfig>;

export const AtlasConfig = z.object({
  registries: z.array(RegistryLayer).default(['baseline', 'user']),
});
export type AtlasConfig = z.infer<typeof AtlasConfig>;

export const ReadingConfig = z.object({
  /**
   * Which tool writes the text in the studio: `ai` leaves the annotations blank
   * for the LLM pass, `predefined` fills them from the curated library. A
   * deployment with no `claude` CLI sets this once and the studio stops offering
   * something it cannot do.
   *
   * The kiosk does not consult this — it always reads from the library, because
   * it has to work with the network unplugged.
   */
  mode: ReadingMode.default('ai'),
  /** Only names the runner; secrets stay in .env, never in this file. */
  provider: z.string().default('claude-cli'),
  model: z.string().nullable().default(null),
  /** Which predefined style to render by default. */
  style: z.string().default('general'),
  /** Keep the studio's free-text style box. */
  customPrompt: z.boolean().default(true),
  fallback: z
    .array(ReadingFallback)
    .default(['target', 'annotation_note', 'feature_generic', 'facts']),
});
export type ReadingConfig = z.infer<typeof ReadingConfig>;

/**
 * Kiosk display preferences.
 *
 * Not "the kiosk profile" — the kiosk's defining behaviour (pre-written text,
 * offline-first) is not negotiable and is not here. These are the few genuine
 * choices about how a frame is presented to a room.
 */
export const KioskConfig = z.object({
  /** Drop incidental context objects — an audience wants few, confident labels. */
  dropContext: z.boolean().default(true),
  /** Only draw B-class features backed by an approved atlas annotation. */
  requireAtlasForB: z.boolean().default(true),
  /** Hard cap on drawn features, so a frame stays readable across a room. */
  maxFeatures: z.number().int().positive().default(12),
  /** Return to the introduction after this long untouched. 0 disables. */
  idleResetSec: z.number().int().nonnegative().default(120),
  /** Offer the reading-style switch on screen (schools session vs public). */
  switchableStyle: z.boolean().default(true),
});
export type KioskConfig = z.infer<typeof KioskConfig>;

export const AstrolensConfig = z.object({
  version: z.literal(1).default(1),
  solve: SolveConfig.default({}),
  catalog: CatalogConfig.default({}),
  atlas: AtlasConfig.default({}),
  reading: ReadingConfig.default({}),
  kiosk: KioskConfig.default({}),
});
export type AstrolensConfig = z.infer<typeof AstrolensConfig>;

export const CONFIG_VERSION = 1 as const;

export const DEFAULT_CONFIG: AstrolensConfig = AstrolensConfig.parse({});

const SECTIONS = ['solve', 'catalog', 'atlas', 'reading', 'kiosk'] as const;

/** A config file as written: every section optional, merged over the defaults. */
export const PartialConfig = z.object({
  version: z.literal(1).optional(),
  solve: SolveConfig.partial().optional(),
  catalog: CatalogConfig.partial().optional(),
  atlas: AtlasConfig.partial().optional(),
  reading: ReadingConfig.partial().optional(),
  kiosk: KioskConfig.partial().optional(),
});
export type PartialConfig = z.infer<typeof PartialConfig>;

/** Shallow-merge per section — the shape is two levels deep, so this is all of it. */
export function mergeConfig(base: AstrolensConfig, over: PartialConfig | undefined): AstrolensConfig {
  if (!over) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const s of SECTIONS) {
    const patch = over[s];
    if (patch) out[s] = { ...base[s], ...patch };
  }
  return AstrolensConfig.parse(out);
}

/**
 * Read a file that may predate the flattening.
 *
 * The profile version stored `{ activeProfile, profiles: { … } }`. Rather than
 * reset such a file to defaults — which would silently undo somebody's setup —
 * take the profile that was active and treat its values as the global ones.
 */
export function fromLegacyProfiles(raw: unknown): PartialConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { activeProfile?: unknown; profiles?: Record<string, unknown> };
  if (!o.profiles || typeof o.profiles !== 'object') return null;
  const name = typeof o.activeProfile === 'string' ? o.activeProfile : 'studio';
  const chosen = (o.profiles[name] ?? Object.values(o.profiles)[0]) as
    | Record<string, unknown>
    | undefined;
  if (!chosen) return null;
  // `select` and `flow` became `kiosk`; carry over the parts that still exist.
  const legacySelect = (chosen.select ?? {}) as Record<string, unknown>;
  const legacyFlow = (chosen.flow ?? {}) as Record<string, unknown>;
  const kiosk = {
    ...(typeof legacySelect.dropContext === 'boolean' ? { dropContext: legacySelect.dropContext } : {}),
    ...(typeof legacySelect.requireAtlasForB === 'boolean'
      ? { requireAtlasForB: legacySelect.requireAtlasForB }
      : {}),
    ...(typeof legacySelect.maxFeatures === 'number' ? { maxFeatures: legacySelect.maxFeatures } : {}),
    ...(typeof legacyFlow.idleResetSec === 'number' ? { idleResetSec: legacyFlow.idleResetSec } : {}),
  };
  const parsed = PartialConfig.safeParse({
    solve: chosen.solve,
    catalog: chosen.catalog,
    atlas: chosen.atlas,
    reading: chosen.reading,
    ...(Object.keys(kiosk).length ? { kiosk } : {}),
  });
  return parsed.success ? parsed.data : null;
}
