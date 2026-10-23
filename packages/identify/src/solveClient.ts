import type { SolveClient } from './types.js';
import { createNovaSolveClient } from './nova.js';
import { createLocalSolveClient } from './localSolve.js';
import { createCachedSolveClient } from './cache.js';
import { loadConfig } from '@astellum/schema/node';

const numEnv = (k: string): number | undefined => {
  const v = process.env[k];
  const n = v != null ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/**
 * True when the configured solver is the offline local astrometry.net one.
 *
 * Reads the control file, not just `ASTELLUM_SOLVER`. The env var predates the
 * config file and used to be the only way to say this, so these two functions
 * only ever looked at it — which meant a machine set to `local` in Settings was
 * told it was on nova, and the atlas refused to solve without a nova API key it
 * did not need. `applyEnvOverrides` folds `ASTELLUM_SOLVER` into
 * `solve.mode`, so reading config honours the env var as well: one answer, and
 * it is the one `createConfiguredSolveClient` acts on.
 *
 * Pass `mode` where the caller already has a config in hand — a per-request
 * handler should not re-read the file to print a name.
 */
export function isLocalSolver(mode?: 'nova' | 'local'): boolean {
  return (mode ?? loadConfig().solve.mode) === 'local';
}

/** Human name of the configured solver, for log lines. */
export function solverName(mode?: 'nova' | 'local'): string {
  return isLocalSolver(mode) ? 'local astrometry.net' : 'nova';
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
  // explicit mode is authoritative; without one, `isLocalSolver` reads the
  // same control file and arrives at the same answer.
  if (isLocalSolver(o.mode)) {
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
