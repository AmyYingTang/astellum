import { execFile, spawn } from 'node:child_process';
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
  /** How often to print a "still solving" heartbeat, seconds (default 15; 0 = off).
   *  A blind solve is minutes of silence otherwise — see runSolveField. */
  progressSec?: number;
}

/** What we managed to learn from solve-field's own output while it ran. */
interface SolveProgress {
  /** Sources simplexy extracted — the single best predictor of a hopeless solve. */
  sources?: number;
  /** Current depth round, e.g. "11-20": which field objects are being matched. */
  round?: string;
  /** Most recent index file tried. */
  index?: string;
  /** How many index files have been tried in total. */
  tried: number;
  /** Depth rounds seen, in order. */
  rounds: string[];
  /** solve-field gave up on its own --cpulimit rather than exhausting the indexes. */
  cpuLimitHit?: boolean;
}

interface RunOutcome {
  progress: SolveProgress;
  /** Non-null when we killed it ourselves for exceeding the wall-clock budget. */
  timedOut: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Last few output lines, for a failure message that says something. */
  tail: string[];
  /** Set when the binary itself could not be started (bad path, not executable). */
  spawnError?: string;
}

/**
 * Run solve-field with its output *streamed* rather than buffered.
 *
 * This used to be execFile, which meant the entire run — minutes, for a blind
 * all-sky solve — produced exactly one log line at the start and, on failure,
 * only the first line of execFile's own error ("Command failed: solve-field
 * …"). That message never says *why*, so a timeout, a missing index directory
 * and an honest no-match were indistinguishable from the outside.
 *
 * Forwarding every line is no good either: one blind pass over a full index set
 * is ~289 "did not solve" lines, repeated per depth round. So we parse the
 * lines into a running summary and print a heartbeat instead — enough to tell
 * "still working, round 2 of the deep indexes" from "stuck" or "found only 3
 * sources, this will never solve".
 */
async function runSolveField(
  bin: string,
  args: string[],
  o: { wallLimitMs: number; progressSec: number; log: (m: string) => void },
): Promise<RunOutcome> {
  const progress: SolveProgress = { tried: 0, rounds: [] };
  const tail: string[] = [];
  const t0 = Date.now();

  return await new Promise<RunOutcome>((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false;
    let settled = false;
    let spawnError: string | undefined;

    const secs = (): string => ((Date.now() - t0) / 1000).toFixed(0);

    const onLine = (line: string): void => {
      const s = line.trimEnd();
      if (!s) return;
      tail.push(s);
      if (tail.length > 12) tail.shift();

      const src = /simplexy: found (\d+) sources/.exec(s);
      if (src) {
        progress.sources = Number(src[1]);
        o.log(`extracted ${progress.sources} sources`);
        return;
      }
      // "Field 1 did not solve (index index-4207-11.fits, field objects 1-10)."
      const att = /did not solve \(index (\S+?),\s*field objects (\d+-\d+)\)/.exec(s);
      if (att) {
        progress.tried += 1;
        progress.index = att[1];
        const round = att[2]!;
        if (progress.round !== round) {
          if (progress.round != null) {
            // A new depth round means the previous one walked *every* index
            // without a match. That is the expensive fact a blind solve hides.
            o.log(
              `depth ${progress.round} found nothing after ${progress.tried - 1} indexes ` +
                `(${secs()}s) — retrying deeper with field objects ${round}`,
            );
          }
          progress.round = round;
          progress.rounds.push(round);
        }
        return;
      }
      // solve-field's own budget, not ours — a different fix (raise cpulimit)
      // from having genuinely run out of indexes.
      if (/CPU time limit reached/.test(s)) {
        progress.cpuLimitHit = true;
        return;
      }
      // Worth surfacing verbatim: setup problems and the winning solution.
      if (/^(Field center|Field size|Field rotation angle|Field parity):/.test(s)) {
        o.log(s);
        return;
      }
      if (/Warning:|ERROR|failed to open/.test(s)) o.log(s);
    };

    // Line-buffer both streams; solve-field writes progress to stdout and
    // warnings to stderr, and we care about both.
    for (const stream of [child.stdout, child.stderr]) {
      let buf = '';
      stream?.setEncoding('utf8');
      stream?.on('data', (chunk: string) => {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          onLine(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
        // Keep a runaway single line from growing without bound.
        if (buf.length > 64 * 1024) buf = buf.slice(-1024);
      });
    }

    const beat =
      o.progressSec > 0
        ? setInterval(() => {
            const where = progress.index
              ? `${progress.index}, depth ${progress.round}`
              : 'starting up';
            o.log(`…still solving (${secs()}s, ${progress.tried} indexes tried, at ${where})`);
          }, o.progressSec * 1000)
        : null;
    beat?.unref?.();

    // --cpulimit is CPU seconds; loading a large index set is I/O-bound, so
    // wall-clock can run well past it. This is the backstop that actually fires.
    const killer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref?.();
    }, o.wallLimitMs);
    killer.unref?.();

    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      if (beat) clearInterval(beat);
      clearTimeout(killer);
      resolve({ progress, timedOut, code, signal, tail, spawnError });
    };

    child.on('error', (e) => {
      spawnError = e.message;
      finish(null, null);
    });
    child.on('close', (code, signal) => finish(code, signal));
  });
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
    const dir = await mkdtemp(join(tmpdir(), 'astellum-solve-'));
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

      const scaleHint = opts.scaleLowDeg != null && opts.scaleHighDeg != null;
      log(
        `solve-field ${input.width}×${input.height} (downsample ${downsample}, cpulimit ${cpuLimit}s` +
          `${scaleHint ? `, field ${opts.scaleLowDeg}–${opts.scaleHighDeg}°` : ''}` +
          `${input.hint ? `, near ${input.hint.ra_deg.toFixed(2)},${input.hint.dec_deg.toFixed(2)} r=${input.hint.radius_deg}°` : ''})…`,
      );
      if (!scaleHint && !input.hint) {
        // The kiosk case: a stranger's image, no target, no idea of the scale.
        // This is supported on purpose — just say what it costs, so minutes of
        // quiet aren't mistaken for a hang.
        log('no field-width or position hint — blind all-sky solve, expect minutes');
      }
      const run = await runSolveField(solveField, args, {
        wallLimitMs: (cpuLimit + 30) * 1000,
        progressSec: opts.progressSec ?? 15,
        log,
      });

      if (!(await exists(`${base}.solved`))) {
        // Say which of the three very different failures this was, because the
        // fix differs: raise the budget, fix the image/extraction, or accept
        // that the field genuinely isn't in the indexes.
        const p = run.progress;
        const walked =
          p.tried > 0
            ? `walked ${p.tried} index files over ${p.rounds.length} depth round(s)`
            : 'never got as far as matching an index';
        let why: string;
        if (run.spawnError) {
          why = `could not run ${solveField}: ${run.spawnError}`;
        } else if (run.timedOut) {
          why = `local solve-field hit its ${cpuLimit + 30}s wall-clock budget — ${walked}`;
        } else if (p.cpuLimitHit) {
          why = `local solve-field gave up at its ${cpuLimit}s cpulimit — ${walked}`;
        } else if (p.sources != null && p.sources < 10) {
          why = `local solve-field extracted only ${p.sources} sources — too few to match`;
        } else if (p.tried > 0) {
          why = `local solve-field found no solution — ${walked}`;
        } else {
          why = `local solve-field failed before matching (exit ${run.code ?? run.signal})`;
        }
        log(`✗ ${why}`);
        // The tail is where the real cause hides when it's a setup problem.
        for (const l of run.tail.slice(-4)) log(`  | ${l}`);
        return { status: 'failed', error: why, elapsed_ms: Date.now() - t0 };
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
