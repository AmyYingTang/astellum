export const SCHEMA_VERSION = '1.0' as const;

export { ColorKey, COLOR_PALETTE } from './colorKeys.js';
export type { PaletteEntry } from './colorKeys.js';

// Presentation layer (Stage 2) — annotations / explanations / poster.
export * from './reading.js';

// Identification stage (Stage 1) — grounded fact sheet + taxonomy + WCS.
export * from './i18n.js';
export * from './taxonomy.js';
export * from './otypes.js';
export * from './wcs.js';
export * from './coords.js';
export * from './factsheet.js';
export * from './registry.js';

// Predefined (no-LLM) readings + the type-level generic notes they fall back to.
export * from './predefined.js';
export * from './featureNotes.js';

// The control file. Pure schema only — the disk/env loader is server-side and
// lives behind the `@astrolens/schema/node` subpath (this package is bundled
// into the browser clients).
export * from './config.js';
