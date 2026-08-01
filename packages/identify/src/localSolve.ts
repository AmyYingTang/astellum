import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SolveClient, SolveInput, SolveResult, Wcs } from './types.js';

const exec = promisify(execFile);
const log = (m: string): void => console.error(`[local] ${m}`);

/**
 * Local astrometry.net plate-solver (solve-field + wcsinfo). Same robust blind
 * solver as nova, but offline — no queue, no network. For live/field use where
 * nova's remote queue is unreliable and the images are captured on the spot.
 *
 * Requires `brew install astrometry-net` + index files covering the field scale.
 * Configure via env or opts; a missing solve-field simply errors (caller can
 * fall back to nova).
 */
export interface LocalSolveOptions {
  /** Path to the solve-field binary (default 'solve-field' on PATH). */
  solveField?: string;
  /** Path to the wcsinfo binary (default 'wcsinfo' on PATH). */
  wcsinfo?: string;
  /** astrometry.cfg listing index dirs (passed as --config). */
  configPath?: string;
  /** Optional FOV *width* bounds (degrees) → --scale-low/high. A hint massively
   *  speeds the solve; omit for a fully blind solve. */
  scaleLowDeg?: number;
  scaleHighDeg?: number;
  /** Downsample factor for star extraction (default 2 — faster, still robust). */
  downsample?: number;
  /** Hard time budget per solve, seconds (default 90). */
  cpuLimitSec?: number;
}

interface WcsInfo {
  ra_center: number; // deg
  dec_center: number; // deg
  pixscale: number; // arcsec/pixel
  orientation: number; // deg, up-vector E of N
  parity: number; // +1 or -1
  imagew: number;
  imageh: number;
}

/** Parse `wcsinfo`'s `key value` lines into the fields we need. */
function parseWcsinfo(stdout: string): WcsInfo | null {
  const m: Record<string, number> = {};
  for (const line of stdout.split('\n')) {
    const sp = line.indexOf(' ');
    if (sp <= 0) continue;
    const k = line.slice(0, sp).trim();
    const v = Number(line.slice(sp + 1).trim());
    if (!Number.isNaN(v)) m[k] = v;
  }
  const need = ['ra_center', 'dec_center', 'pixscale', 'orientation', 'parity', 'imagew', 'imageh'];
  if (need.some((k) => m[k] == null)) return null;
  return {
    ra_center: m.ra_center,
    dec_center: m.dec_center,
    pixscale: m.pixscale,
    orientation: m.orientation,
    parity: m.parity,
    imagew: m.imagew,
    imageh: m.imageh,
  };
}

/** Build our simplified TAN Wcs from a wcsinfo result. The parity/orientation
 *  conventions are calibrated against nova (see the notes on the fields below);
 *  both handedness cases are verified, so this is safe for mirrored fields too. */
function toWcs(w: WcsInfo, input: SolveInput): Wcs {
  return {
    ra0_deg: w.ra_center,
    dec0_deg: w.dec_center,
    crpix_x: input.width / 2,
    crpix_y: input.height / 2,
    scale_deg: w.pixscale / 3600,
    // wcsinfo "orientation" = up (image +Y) E of N; our worldToPixel flips Y
    // (internal +Y is down), so our orientation is 180° − it. Calibrated against
    // nova on real fields (center 0.1px, edges ~19px = linear-TAN inter-solver
    // scatter, not error).
    orientation_deg: 180 - w.orientation,
    // wcsinfo parity: +1 normal, -1 flipped → our convention flips the sign
    // (same as nova's cal.parity mapping). Both handedness cases are verified:
    // solving a deliberately mirrored copy of a known field lands every point on
    // its mirrored pixel (centre 1px, edges ~20px — the same inter-solver scatter
    // as the unmirrored case, versus the ~1000s of px a wrong branch would give).
    parity: w.parity < 0 ? 1 : -1,
    width: input.width,
    height: input.height,
  };
}

export function createLocalSolveClient(opts: LocalSolveOptions = {}): SolveClient {
  const solveField = opts.solveField ?? 'solve-field';
  const wcsinfoBin = opts.wcsinfo ?? 'wcsinfo';
  // solve-field walks its index files widest-scale-first and stops at the first
  // match, so cpulimit is only ever spent on *failures* — a fast solve returns
  // just as fast under a high cap. 90s was cutting off solves that were about to
  // succeed several indexes later.
  const cpuLimit = opts.cpuLimitSec ?? 240;

  async function exists(p: string): Promise<boolean> {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  }

  async function solve(input: SolveInput): Promise<SolveResult> {
    const t0 = Date.now();
    // Nebulosity is the enemy of source detection: at downsample 2 a large
    // emission-nebula frame yields thousands of spurious "stars" from the
    // mottling, burying the real star pattern the matcher needs. Shrinking
    // harder smooths the gas away and leaves the stars. Small frames can't
    // afford it, so scale with the image.
    const downsample = opts.downsample ?? (Math.max(input.width, input.height) >= 3000 ? 4 : 2);
    const dir = await mkdtemp(join(tmpdir(), 'astrolens-solve-'));
    const base = join(dir, 'solve');
    try {
      const args = [
        '--overwrite',
        '--no-plots',
        '--no-verify',
        '--downsample',
        String(downsample),
        '--cpulimit',
        String(cpuLimit),
        '-D',
        dir,
        '-o',
        'solve',
      ];
      if (opts.configPath) args.push('--config', opts.configPath);
      if (opts.scaleLowDeg != null && opts.scaleHighDeg != null) {
        args.push('--scale-units', 'degwidth', '--scale-low', String(opts.scaleLowDeg), '--scale-high', String(opts.scaleHighDeg));
      }
      // A known target position turns the all-sky search into a local one.
      if (input.hint) {
        args.push(
          '--ra', String(input.hint.ra_deg),
          '--dec', String(input.hint.dec_deg),
          '--radius', String(input.hint.radius_deg),
        );
      }
      args.push(input.imagePath);

      log(
        `solve-field ${input.width}×${input.height} (downsample ${downsample}, cpulimit ${cpuLimit}s` +
          `${input.hint ? `, near ${input.hint.ra_deg.toFixed(2)},${input.hint.dec_deg.toFixed(2)} r=${input.hint.radius_deg}°` : ''})…`,
      );
      await exec(solveField, args, { timeout: (cpuLimit + 30) * 1000, maxBuffer: 16 * 1024 * 1024 }).catch((e) => {
        // solve-field exits non-zero when it can't solve; treat as no-solution below.
        log(`solve-field: ${(e as Error).message.split('\n')[0]}`);
      });

      if (!(await exists(`${base}.solved`))) {
        return { status: 'failed', error: 'local solve-field found no solution', elapsed_ms: Date.now() - t0 };
      }
      const { stdout } = await exec(wcsinfoBin, [`${base}.wcs`], { maxBuffer: 4 * 1024 * 1024 });
      const info = parseWcsinfo(stdout);
      if (!info) return { status: 'failed', error: 'could not parse wcsinfo output', elapsed_ms: Date.now() - t0 };

      const wcs = toWcs(info, input);
      log(`✔ solved in ${((Date.now() - t0) / 1000).toFixed(1)}s: ra=${wcs.ra0_deg.toFixed(4)} dec=${wcs.dec0_deg.toFixed(4)} pixscale=${info.pixscale.toFixed(2)}″/px`);
      return { status: 'solved', wcs, elapsed_ms: Date.now() - t0, solver: 'local astrometry.net' };
    } catch (e) {
      return { status: 'failed', error: (e as Error).message, elapsed_ms: Date.now() - t0 };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return { solve };
}
