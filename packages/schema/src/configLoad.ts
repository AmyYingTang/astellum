import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  AstrolensConfig,
  DEFAULT_CONFIG,
  Profile,
  resolveProfile,
  type PartialProfile,
} from './config.js';

/**
 * Disk + env side of the control file. Server-only (`node:fs`), so it is NOT
 * exported from the package index — @astrolens/schema is bundled into the
 * browser clients. Import it via `@astrolens/schema/node`.
 *
 * Precedence, lowest to highest:
 *   built-in profile → ~/.astrolens/config.json → ./astrolens.config.json → env
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

/** Merge two config files (later wins), unioning their profile deltas. */
function mergeConfigs(base: AstrolensConfig, over: AstrolensConfig | null): AstrolensConfig {
  if (!over) return base;
  const profiles: Record<string, PartialProfile> = { ...base.profiles };
  for (const [name, patch] of Object.entries(over.profiles)) {
    const prev = profiles[name];
    profiles[name] = prev ? { ...prev, ...patch } : patch;
  }
  return {
    version: over.version ?? base.version,
    activeProfile: over.activeProfile ?? base.activeProfile,
    profiles,
  };
}

function parseConfig(raw: unknown, path: string): AstrolensConfig | null {
  if (raw == null) return null;
  const parsed = AstrolensConfig.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid config at ${path}: ${parsed.error.issues[0]?.message ?? 'bad shape'}`);
  }
  return parsed.data;
}

/** Read + merge the config files. Missing files are a valid "all defaults" state. */
export function loadConfigFile(cwd = process.cwd()): AstrolensConfig {
  const userPath = userConfigPath();
  const wsPath = workspaceConfigPath(cwd);
  let cfg = mergeConfigs(DEFAULT_CONFIG, parseConfig(readJson(userPath), userPath));
  cfg = mergeConfigs(cfg, parseConfig(readJson(wsPath), wsPath));
  return cfg;
}

/**
 * Apply the legacy environment variables on top of a resolved profile. These
 * predate the config file and remain the highest-priority override, so an
 * existing `ASTROLENS_SOLVER=local` still wins over any file.
 */
export function applyEnvOverrides(profile: Profile): Profile {
  const out = Profile.parse(profile);
  const solver = (process.env.ASTROLENS_SOLVER ?? '').toLowerCase();
  if (solver === 'local' || solver === 'nova') out.solve.mode = solver;
  const mode = (process.env.ASTROLENS_READING_MODE ?? '').toLowerCase();
  if (mode === 'ai' || mode === 'predefined') out.reading.mode = mode;
  if (process.env.ASTROLENS_READING_STYLE) out.reading.style = process.env.ASTROLENS_READING_STYLE;
  return out;
}

export interface LoadedConfig {
  /** The merged file contents (what a settings UI edits and writes back). */
  file: AstrolensConfig;
  /** Which profile is in force. */
  profileName: string;
  /** Built-in baseline + file deltas + env overrides — what the pipeline reads. */
  profile: Profile;
}

/**
 * The one call every entry point makes. `$ASTROLENS_PROFILE` (or an explicit
 * argument) picks the profile; otherwise the file's `activeProfile`.
 */
export function loadConfig(opts: { cwd?: string; profile?: string } = {}): LoadedConfig {
  const file = loadConfigFile(opts.cwd);
  const profileName = opts.profile ?? process.env.ASTROLENS_PROFILE ?? file.activeProfile;
  return {
    file,
    profileName,
    profile: applyEnvOverrides(resolveProfile(file, profileName)),
  };
}
