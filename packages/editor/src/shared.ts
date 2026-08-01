import type { Reading, FactSheet, Profile } from '@astrolens/schema';

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

export type ExportFormat = 'annotated' | 'embed' | 'poster' | 'all';

export interface ExportRequest {
  format: ExportFormat;
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
  profileName: string;
  profiles: string[];
  profile: Profile;
  offlineCatalog: boolean;
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
