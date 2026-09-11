import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SolveClient } from './types.js';

const log = (m: string): void => console.error(`[cache] ${m}`);

/** Bump when the stored solve's meaning changes (e.g. WCS parity/orientation
 *  convention) so old cached solves are ignored instead of replaying stale WCS. */
const CACHE_VERSION = 2;

/** Default solve-cache dir: ~/.cache/astellum/solve (content-addressed, repo-independent). */
export function defaultSolveCacheDir(): string {
  return join(homedir(), '.cache', 'astellum', 'solve');
}

async function sha256File(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Wrap a SolveClient with a content-addressed disk cache: a given image (by
 * sha256) is plate-solved once, then reused. nova is the slow step (30s–min),
 * so this makes re-runs of the same image instant. Only successful solves are
 * cached (failures stay retryable).
 */
export function createCachedSolveClient(inner: SolveClient, dir = defaultSolveCacheDir()): SolveClient {
  return {
    async solve(input) {
      const t0 = Date.now();
      let hash: string;
      try {
        hash = await sha256File(input.imagePath);
      } catch {
        return inner.solve(input); // can't hash → just solve
      }
      const file = join(dir, `${hash}.json`);

      try {
        const cached = JSON.parse(await readFile(file, 'utf8'));
        if (cached && cached.v === CACHE_VERSION && cached.result) {
          const ms = Date.now() - t0;
          log(`solve hit ${hash.slice(0, 12)} — instant (${ms}ms), skipping nova`);
          return { ...cached.result, cached: true, elapsed_ms: ms };
        }
        // stale schema → re-solve below
      } catch {
        // miss
      }

      const res = await inner.solve(input);
      if (res.status === 'solved') {
        try {
          await mkdir(dir, { recursive: true });
          await writeFile(file, JSON.stringify({ v: CACHE_VERSION, result: res }, null, 2));
          log(`solve stored ${hash.slice(0, 12)}`);
        } catch {
          // non-fatal: caching is best-effort
        }
      }
      return res;
    },
  };
}
