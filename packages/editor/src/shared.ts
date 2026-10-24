import type { Reading, FactSheet, AstellumConfig, StylePreset } from '@astellum/schema';

export interface ProjectSummary {
  slug: string;
  name: string;
  type: string;
  stage?: number;
  imageName: string;
  features: number;
  /** Grounding summary from the fact sheet, when present. */
  solveStatus?: 'solved' | 'user_provided' | 'failed';
  needsReview?: number;
}

export interface ProjectsResponse {
  projects: ProjectSummary[];
}

/** Background create-job lifecycle (POST /api/projects runs async). */
export type JobState = 'queued' | 'running' | 'done' | 'failed';
export type JobStage = 'solving' | 'reading' | 'done';

export interface JobStatus {
  state: JobState;
  stage?: JobStage;
  error?: string;
  warnings?: string[];
}

/** GET /api/projects/:slug/factsheet */
export interface FactsheetResponse {
  factsheet: FactSheet;
}

/** POST /api/projects — create a new reading from an uploaded image. */
export interface CreateProjectRequest {
  /** base64 (optionally a data: URI) of the image bytes. */
  imageBase64: string;
  filename: string;
  hint?: string;
  lang?: 'zh' | 'en';
  /** Extra instructions (tone/audience/focus) appended to the read prompt. */
  style?: string;
  /** Which role to fill the predefined text in for; a style key. */
  role?: string;
  /** Stage 1 only: identify → factsheet + a stub reading, skipping the LLM. */
  factsOnly?: boolean;
}

export interface CreateProjectResponse {
  ok: boolean;
  slug?: string;
  error?: string;
}

/** GET /api/projects/:slug/report */
export interface ReportResponse {
  report: Reading;
  imageName: string;
}

/** POST /api/projects/:slug/report */
export interface SaveRequest {
  report: Reading;
}

export interface SaveResponse {
  ok: boolean;
  error?: string;
}

/** `all` is the frame and both posters. The interactive embed page is the
 *  CLI's (`astellum render --format embed`); the studio no longer offers it. */
/**
 * The file-name stem of everything exported for a reading. Here rather than in
 * the server because the page needs it too: a Save dialog has to be opened
 * with its suggested name before the export is fetched — the browser only
 * allows the dialog straight from the click.
 */
export function objectStem(name: string): string {
  const cleaned = name
    .replace(/[/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, '')
    .replace(/^[.-]+|[.-]+$/g, '');
  return cleaned || 'report';
}

export type ExportFormat = 'annotated' | 'poster' | 'all';

export interface ExportRequest {
  format: ExportFormat;
  /** With `poster`: render only this layout. Both when omitted. */
  layout?: 'portrait' | 'landscape';
  /** Write the frame in this language — the one the studio is showing.
   *  The reading's own `display_language` when omitted. */
  lang?: 'zh' | 'en';
}

export interface ExportFile {
  name: string;
  /** base64-encoded file bytes. */
  base64: string;
  /** MIME type. */
  contentType: string;
}

export interface ExportResponse {
  ok: boolean;
  files?: ExportFile[];
  error?: string;
}

/** GET /api/config — the active control-file profile and a readiness self-check. */
export interface ConfigResponse {
  solver: string;
  localSolver: boolean;
  config: AstellumConfig;
  offlineCatalog: boolean;
  /** Present when the hub launched this studio. */
  hubUrl?: string;
  /** The presets in force — a curator's list if they supplied one. */
  stylePresets?: StylePreset[];
  /** Which role a surface should open in. */
  defaultRole?: string;
  readiness?: {
    catalogsReady: boolean;
    missingCatalogs: string[];
    readingTargets: number;
    readingsCovered: number;
  };
}

/** POST /api/projects/:slug/save-predefined — promote an AI reading into the library. */
export interface SavePredefinedResponse {
  ok: boolean;
  path?: string;
  target?: string;
  style?: string;
  features?: number;
  error?: string;
}
