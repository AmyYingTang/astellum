import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLocalSolver, solverName } from './solveClient.js';

/**
 * Which solver is in force is read from the control file, not only from
 * `ASTELLUM_SOLVER`.
 *
 * The env var came first and was once the only way to say this, so these two
 * functions only ever looked at it. A machine switched to the local solver in
 * Settings was therefore told it was on nova, and the atlas refused to solve
 * without a nova API key it had no use for — while the solving itself, which
 * takes the mode from config, went local as asked.
 */
describe('which solver is in force', () => {
  const env = { ...process.env };
  let path: string;

  const config = (mode: string): void => {
    path = join(mkdtempSync(join(tmpdir(), 'astellum-cfg-')), 'config.json');
    writeFileSync(path, JSON.stringify({ version: 1, solve: { mode } }), 'utf8');
    process.env.ASTELLUM_CONFIG = path;
  };

  beforeEach(() => {
    delete process.env.ASTELLUM_SOLVER;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('believes the control file when no env var contradicts it', () => {
    config('local');
    expect(isLocalSolver()).toBe(true);
    expect(solverName()).toBe('local astrometry.net');
  });

  it('says nova when that is what the control file says', () => {
    config('nova');
    expect(isLocalSolver()).toBe(false);
    expect(solverName()).toBe('nova');
  });

  /*
   * `applyEnvOverrides` folds ASTELLUM_SOLVER into `solve.mode`, so reading the
   * config honours the env var too — which is the point of reading only one of
   * the two. The env var stays the override, as everywhere else.
   */
  it('still lets the env var win, because config already applied it', () => {
    config('nova');
    process.env.ASTELLUM_SOLVER = 'local';
    expect(isLocalSolver()).toBe(true);
    expect(solverName()).toBe('local astrometry.net');
  });

  it('takes a mode from a caller that already loaded one, without re-reading', () => {
    config('nova');
    expect(isLocalSolver('local')).toBe(true);
    expect(solverName('local')).toBe('local astrometry.net');
    process.env.ASTELLUM_SOLVER = 'local';
    expect(isLocalSolver('nova')).toBe(false); // the caller's answer is final
  });
});
