import type { SolveClient } from './types.js';
import { createNovaSolveClient } from './nova.js';
import { createLocalSolveClient } from './localSolve.js';
import { createCachedSolveClient } from './cache.js';

const numEnv = (k: string): number | undefined => {
  const v = process.env[k];
  const n = v != null ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** True when the configured solver is the offline local astrometry.net one. */
export function isLocalSolver(): boolean {
  return (process.env.ASTELLUM_SOLVER ?? '').toLowerCase() === 'local';
}

/** Human name of the configured solver, for log lines. */
export function solverName(): string {
  return isLocalSolver() ? 'local astrometry.net' : 'nova';
}

/**
 * Build the plate-solve client from config, shared by the CLI, studio/editor and
 * the atlas tool. `ASTELLUM_SOLVER=local` selects the offline astrometry.net
 * solver (solve-field) — for field/live use where nova's remote queue is
 * unreliable; otherwise nova (needs an API key). Wrapped in the on-disk cache
 * unless disabled.
 *
 * Local-solver env: ASTROMETRY_CFG (astrometry.cfg path), SOLVE_FIELD / WCSINFO
 * (binary paths), ASTELLUM_FOV_LOW / ASTELLUM_FOV_HIGH (field-width degree
 * bounds — a hint that greatly speeds the solve).
 */
export function createConfiguredSolveClient(
  o: {
    apiKey?: string;
    cache?: boolean;
    mode?: 'nova' | 'local';
    /** Field-width bounds in degrees; falls back to the env vars when unset. */
    fovLowDeg?: number;
    fovHighDeg?: number;
  } = {},
): SolveClient {
  let inner: SolveClient;
  // The control file's profile already has the env overrides applied, so an
  // explicit mode is authoritative; without one, fall back to reading env here
  // (the pre-config behaviour, still used by callers that don't load a profile).
  if (o.mode ? o.mode === 'local' : isLocalSolver()) {
    inner = createLocalSolveClient({
      configPath: process.env.ASTROMETRY_CFG,
      solveField: process.env.SOLVE_FIELD,
      wcsinfo: process.env.WCSINFO,
      // Settings first; the env vars remain the override, as everywhere else.
      scaleLowDeg: o.fovLowDeg ?? numEnv('ASTELLUM_FOV_LOW'),
      scaleHighDeg: o.fovHighDeg ?? numEnv('ASTELLUM_FOV_HIGH'),
    });
  } else {
    if (!o.apiKey) {
      throw new Error(
        'Plate-solving needs a nova API key ($ASTROMETRY_API_KEY), or set ASTELLUM_SOLVER=local for offline solving.',
      );
    }
    inner = createNovaSolveClient({ apiKey: o.apiKey });
  }
  return o.cache === false ? inner : createCachedSolveClient(inner);
}
