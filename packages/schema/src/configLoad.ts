import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ContentOverlay, setContentOverlay } from './content.js';
import {
  AstrolensConfig,
  DEFAULT_CONFIG,
  PartialConfig,
  fromLegacyProfiles,
  mergeConfig,
} from './config.js';

/**
 * Disk + env side of the control file. Server-only (`node:fs`), so it is NOT
 * exported from the package index — @astrolens/schema is bundled into the
 * browser clients. Import it via `@astrolens/schema/node`.
 *
 * Precedence, lowest to highest:
 *   defaults → ~/.astrolens/config.json → ./astrolens.config.json → env
 *
 * Env stays on top so every existing `.env` / `export` recipe keeps working
 * unchanged — the config file adds a layer, it doesn't take one away.
 */

export function userConfigPath(): string {
  return process.env.ASTROLENS_CONFIG ?? join(homedir(), '.astrolens', 'config.json');
}

export function workspaceConfigPath(cwd = process.cwd()): string {
  return resolve(cwd, 'astrolens.config.json');
}

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Could not read config at ${path}: ${(e as Error).message}`);
  }
}

function parseConfig(raw: unknown, path: string): PartialConfig | undefined {
  if (raw == null) return undefined;
  // A file written before the profiles were flattened still means something.
  const legacy = fromLegacyProfiles(raw);
  if (legacy) return legacy;
  const parsed = PartialConfig.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid config at ${path}: ${parsed.error.issues[0]?.message ?? 'bad shape'}`);
  }
  return parsed.data;
}

/** Read + merge the config files. Missing files are a valid "all defaults" state. */
export function loadConfigFile(cwd = process.cwd()): AstrolensConfig {
  const userPath = userConfigPath();
  const wsPath = workspaceConfigPath(cwd);
  let cfg = mergeConfig(DEFAULT_CONFIG, parseConfig(readJson(userPath), userPath));
  cfg = mergeConfig(cfg, parseConfig(readJson(wsPath), wsPath));
  return cfg;
}

/**
 * Apply the legacy environment variables on top. These predate the config file
 * and remain the highest-priority override, so an existing
 * `ASTROLENS_SOLVER=local` still wins over anything saved in the UI.
 */
export function applyEnvOverrides(config: AstrolensConfig): AstrolensConfig {
  const out = AstrolensConfig.parse(config);
  const solver = (process.env.ASTROLENS_SOLVER ?? '').toLowerCase();
  if (solver === 'local' || solver === 'nova') out.solve.mode = solver;
  const mode = (process.env.ASTROLENS_READING_MODE ?? '').toLowerCase();
  if (mode === 'ai' || mode === 'predefined') out.reading.mode = mode;
  if (process.env.ASTROLENS_READING_STYLE) out.reading.style = process.env.ASTROLENS_READING_STYLE;
  const lo = Number(process.env.ASTROLENS_FOV_LOW);
  const hi = Number(process.env.ASTROLENS_FOV_HIGH);
  if (Number.isFinite(lo) && lo > 0) out.solve.fovLowDeg = lo;
  if (Number.isFinite(hi) && hi > 0) out.solve.fovHighDeg = hi;
  return out;
}

/** The one call every entry point makes. */
export function loadConfig(opts: { cwd?: string } = {}): AstrolensConfig {
  return applyEnvOverrides(loadConfigFile(opts.cwd));
}

// --- curator content overlay ------------------------------------------------

/** The shipped overlay, edited by whoever curates this deployment. */
export function contentPath(): string {
  return process.env.ASTROLENS_CONTENT ?? resolve('packages/atlas/data/content.json');
}

/** A self-deployer's own overrides, merged on top. */
export function userContentPath(): string {
  return process.env.ASTROLENS_USER_CONTENT ?? join(homedir(), '.astrolens', 'content.json');
}

/**
 * Read the content overlay and install it.
 *
 * Every section is optional and merges over the built-ins, so a missing file is
 * the normal state and a partial file is a legitimate one — a curator who only
 * wants to reword two feature notes writes exactly those two.
 *
 * A malformed file is reported and then ignored rather than thrown: text that
 * fails to parse should not stop a kiosk from running, and the built-in wording
 * is a perfectly good frame to fall back to.
 */
export function loadContent(): ContentOverlay {
  const merged: ContentOverlay = {};
  for (const path of [contentPath(), userContentPath()]) {
    const raw = readJson(path);
    if (raw == null) continue;
    const parsed = ContentOverlay.safeParse(raw);
    if (!parsed.success) {
      console.error(
        `[content] ignoring ${path}: ${parsed.error.issues[0]?.path.join('.')} ${
          parsed.error.issues[0]?.message
        }`,
      );
      continue;
    }
    // An empty section means "I didn't specify this", not "make it empty" —
    // the shipped template has every key present so it can be filled in, and
    // reading that as a replacement would blank the built-ins.
    const o = parsed.data;
    if (o.featureNotes && Object.keys(o.featureNotes).length) {
      merged.featureNotes = { ...merged.featureNotes, ...o.featureNotes };
    }
    if (o.nicknames && Object.keys(o.nicknames).length) {
      merged.nicknames = { ...merged.nicknames, ...o.nicknames };
    }
    if (o.stylePresets?.length) merged.stylePresets = o.stylePresets;
    if (o.readingBrief && Object.keys(o.readingBrief).length) {
      merged.readingBrief = { ...merged.readingBrief, ...o.readingBrief };
    }
  }
  setContentOverlay(merged);
  return merged;
}
