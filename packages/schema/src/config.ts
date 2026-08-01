import { z } from 'zod';

/**
 * The single control file — one place that says *how this machine runs the
 * pipeline*, instead of the switches being scattered across environment
 * variables (ASTROLENS_SOLVER, ASTROMETRY_*, ATLAS_*) with no way at all to
 * express which way this machine is set up.
 *
 * Two shipped profiles, named for the room rather than the network:
 *  - **studio** — where a frame is made. Every stage adjustable, AI reading with
 *    a free-text prompt, posters out the end. It is not "online mode": plate
 *    solving here is just as happily local.
 *  - **kiosk** — where a frame is shown. Local solve, offline catalogs,
 *    *predefined* readings (no LLM), tighter selection, the fullscreen UI.
 *
 * This module is PURE (zod + merge helpers only) because @astrolens/schema is
 * bundled into the browser clients. Disk loading + env overlay live in
 * `configLoad.ts`, reachable only via the `@astrolens/schema/node` subpath.
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

export const ReadingMode = z.enum(['ai', 'predefined']);
export type ReadingMode = z.infer<typeof ReadingMode>;

/** Where a predefined explanation may come from, in lookup order. Never blank,
 *  never invented: the last resort is a template built from grounded facts. */
export const ReadingFallback = z.enum(['target', 'annotation_note', 'feature_generic', 'facts']);
export type ReadingFallback = z.infer<typeof ReadingFallback>;

export const RegistryLayer = z.enum(['baseline', 'user']);
export type RegistryLayer = z.infer<typeof RegistryLayer>;

export const FlowUi = z.enum(['studio', 'kiosk']);
export type FlowUi = z.infer<typeof FlowUi>;

export const OutputFormat = z.enum(['annotated', 'embed', 'poster', 'kiosk']);
export type OutputFormat = z.infer<typeof OutputFormat>;

export const SolveConfig = z.object({
  mode: SolveMode.default('nova'),
  /** Content-addressed on-disk solve cache (createCachedSolveClient). */
  cache: z.boolean().default(true),
  /** Feed the chosen target's known RA/Dec to solve-field as a position hint —
   *  at a kiosk the target is picked up front, and the hint cuts the solve from
   *  tens of seconds to a few. Ignored by nova. */
  hintFromTarget: z.boolean().default(false),
  /** Give up rather than leave an audience staring at a spinner. */
  timeoutMs: z.number().int().positive().optional(),
});
export type SolveConfig = z.infer<typeof SolveConfig>;

export const CatalogConfig = z.object({
  sources: z.array(CatalogSource).default(['simbad', 'vizier', 'openngc']),
  /** Keep an on-disk snapshot of online catalogue answers. Warmed in the studio,
   *  it lets a field machine serve the exact results SIMBAD/VizieR gave — the
   *  faint companions and Chinese names the static offline pack doesn't carry. */
  snapshot: z.boolean().default(true),
  /** Answer only from the snapshot; never reach the network. Set on the kiosk
   *  profile so a stale-looking field fails visibly instead of hanging. */
  snapshotOnly: z.boolean().default(false),
});
export type CatalogConfig = z.infer<typeof CatalogConfig>;

export const AtlasConfig = z.object({
  registries: z.array(RegistryLayer).default(['baseline', 'user']),
});
export type AtlasConfig = z.infer<typeof AtlasConfig>;

export const ReadingConfig = z.object({
  mode: ReadingMode.default('ai'),
  /** Only names the runner; secrets stay in .env, never in this file. */
  provider: z.string().default('claude-cli'),
  model: z.string().nullable().default(null),
  /** Which predefined style to render. The data model holds many; the first
   *  release only ships `general` (school year 8–12 reading level). */
  style: z.string().default('general'),
  /** Keep the studio's free-text style box — control is the studio's whole point. */
  customPrompt: z.boolean().default(true),
  /** Let the kiosk switch style live — a schools session vs a public session. */
  switchableInKiosk: z.boolean().default(false),
  fallback: z
    .array(ReadingFallback)
    .default(['target', 'annotation_note', 'feature_generic', 'facts']),
});
export type ReadingConfig = z.infer<typeof ReadingConfig>;

export const SelectConfig = z.object({
  /** Drop `role: 'context'` objects — at a kiosk precision beats recall. */
  dropContext: z.boolean().default(false),
  /** Only draw B-class features backed by an approved atlas annotation. */
  requireAtlasForB: z.boolean().default(false),
  /** Hard cap on drawn features, so a kiosk frame stays readable. */
  maxFeatures: z.number().int().positive().optional(),
  /** Overrides for the existing SelectOptions gates (arcmin). */
  nebulaMinArcmin: z.number().positive().optional(),
  galaxyMinArcmin: z.number().positive().optional(),
});
export type SelectConfig = z.infer<typeof SelectConfig>;

export const FlowConfig = z.object({
  ui: FlowUi.default('studio'),
  outputs: z.array(OutputFormat).default(['annotated', 'embed', 'poster']),
  /** Kiosk: return to the idle screen after this long untouched. */
  idleResetSec: z.number().int().positive().optional(),
});
export type FlowConfig = z.infer<typeof FlowConfig>;

export const Profile = z.object({
  solve: SolveConfig.default({}),
  catalog: CatalogConfig.default({}),
  atlas: AtlasConfig.default({}),
  reading: ReadingConfig.default({}),
  select: SelectConfig.default({}),
  flow: FlowConfig.default({}),
});
export type Profile = z.infer<typeof Profile>;

/** A profile as written in the file: every section optional, merged over the
 *  built-in baseline. Users override one knob without restating the rest. */
export const PartialProfile = z.object({
  solve: SolveConfig.partial().optional(),
  catalog: CatalogConfig.partial().optional(),
  atlas: AtlasConfig.partial().optional(),
  reading: ReadingConfig.partial().optional(),
  select: SelectConfig.partial().optional(),
  flow: FlowConfig.partial().optional(),
});
export type PartialProfile = z.infer<typeof PartialProfile>;

export const AstrolensConfig = z.object({
  version: z.literal(1).default(1),
  activeProfile: z.string().default('studio'),
  profiles: z.record(z.string(), PartialProfile).default({}),
});
export type AstrolensConfig = z.infer<typeof AstrolensConfig>;

export const CONFIG_VERSION = 1 as const;

/** Earlier names, kept working. A config file written when these were called
 *  `offsite`/`onsite` still resolves. */
const PROFILE_ALIASES: Record<string, string> = { offsite: 'studio', onsite: 'kiosk' };
const PROFILE_ALIASES_BACK: Record<string, string> = { studio: 'offsite', kiosk: 'onsite' };

/** The two shipped profiles. A config file only records deltas from these. */
export const BUILTIN_PROFILES: Record<string, Profile> = {
  studio: Profile.parse({
    solve: { mode: 'nova', cache: true },
    catalog: { sources: ['simbad', 'vizier', 'openngc'] },
    atlas: { registries: ['baseline', 'user'] },
    reading: { mode: 'ai', provider: 'claude-cli', customPrompt: true },
    select: { dropContext: false },
    flow: { ui: 'studio', outputs: ['annotated', 'embed', 'poster'] },
  }),
  kiosk: Profile.parse({
    solve: { mode: 'local', cache: true, hintFromTarget: true, timeoutMs: 60_000 },
    catalog: { sources: ['offline', 'snapshot'], snapshot: true, snapshotOnly: true },
    atlas: { registries: ['baseline', 'user'] },
    reading: {
      mode: 'predefined',
      style: 'general',
      switchableInKiosk: true,
      fallback: ['target', 'annotation_note', 'feature_generic', 'facts'],
    },
    select: { dropContext: true, requireAtlasForB: true, maxFeatures: 12 },
    flow: { ui: 'kiosk', outputs: ['kiosk'], idleResetSec: 120 },
  }),
};

export const DEFAULT_CONFIG: AstrolensConfig = {
  version: CONFIG_VERSION,
  activeProfile: 'studio',
  profiles: {},
};

const SECTIONS = ['solve', 'catalog', 'atlas', 'reading', 'select', 'flow'] as const;

/** Shallow-merge per section (the shape is exactly two levels deep, so this is
 *  the whole merge — no generic deep-merge machinery needed). */
export function mergeProfile(base: Profile, over: PartialProfile | undefined): Profile {
  if (!over) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const s of SECTIONS) {
    const patch = over[s];
    if (patch) out[s] = { ...base[s], ...patch };
  }
  return Profile.parse(out);
}

/**
 * Resolve the effective profile: the built-in baseline for that name (falling
 * back to `offsite` for a user-invented name), with the file's deltas merged on
 * top. Unknown profile names are usable — they just start from the offsite base.
 */
export function resolveProfile(config: AstrolensConfig, name?: string): Profile {
  const raw = name ?? config.activeProfile;
  const key = BUILTIN_PROFILES[raw] ? raw : (PROFILE_ALIASES[raw] ?? raw);
  const base = BUILTIN_PROFILES[key] ?? BUILTIN_PROFILES.studio!;
  // Deltas may be filed under either spelling: a half-migrated file can name the
  // profile the new way while its overrides still sit under the old key.
  const patch =
    config.profiles[key] ??
    config.profiles[raw] ??
    config.profiles[PROFILE_ALIASES_BACK[key] ?? ''];
  return mergeProfile(base, patch);
}

/** Every profile name the UI should offer: built-ins plus any user-defined. */
export function profileNames(config: AstrolensConfig): string[] {
  const custom = Object.keys(config.profiles).filter((p) => !PROFILE_ALIASES[p]);
  return [...new Set([...Object.keys(BUILTIN_PROFILES), ...custom])];
}
