import type { Reading } from '@astellum/schema';
import type {
  CreateProjectRequest,
  CreateProjectResponse,
  ExportFile,
  ExportFormat,
  ExportRequest,
  ExportResponse,
  FactsheetResponse,
  JobStatus,
  ProjectsResponse,
  ProjectSummary,
  ReportResponse,
  SaveResponse,
  ConfigResponse,
  SavePredefinedResponse,
} from '../shared.js';

// GETs that read regeneratable files (report/factsheet/job/list) must never be
// served from the HTTP cache, or a re-identify / generate won't show up after
// location.reload() — the file on disk is fresh but the browser reuses the old
// response.
const NO_STORE: RequestInit = { cache: 'no-store' };

export async function listProjects(): Promise<ProjectSummary[]> {
  const res = await fetch('/api/projects', NO_STORE);
  if (!res.ok) throw new Error(`Failed to list projects (${res.status})`);
  return ((await res.json()) as ProjectsResponse).projects;
}

export async function createProject(req: CreateProjectRequest): Promise<string> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  const body = (await res.json()) as CreateProjectResponse;
  if (!body.ok || !body.slug) throw new Error(body.error ?? `Create failed (${res.status})`);
  return body.slug;
}

export async function reidentify(
  slug: string,
  opts: { starMagMax?: number; role?: string } = {},
): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/reidentify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(opts),
  });
  const body = (await res.json()) as { ok: boolean; error?: string };
  if (!body.ok) throw new Error(body.error ?? `Re-identify failed (${res.status})`);
}


export async function generateReading(
  slug: string,
  tone?: string,
  role?: string,
): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/reading`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tone, role }),
  });
  const body = (await res.json()) as { ok: boolean; error?: string };
  if (!body.ok) throw new Error(body.error ?? `Generate reading failed (${res.status})`);
}

/**
 * Re-read this project's text from the library in another role.
 *
 * Cheap and local — the fact sheet is already on disk — which is why the
 * role switch can act the moment it is changed instead of asking first.
 */
export async function readPredefinedText(slug: string, role: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/predefined-text`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  const body = (await res.json()) as { ok: boolean; error?: string };
  if (!body.ok) throw new Error(body.error ?? `Could not re-read the text (${res.status})`);
}

export async function fetchJob(slug: string): Promise<JobStatus> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/job`, NO_STORE);
  return (await res.json()) as JobStatus;
}

export async function fetchFactsheet(slug: string): Promise<FactsheetResponse> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/factsheet`, NO_STORE);
  if (!res.ok) throw new Error(`Failed to load fact sheet (${res.status})`);
  return (await res.json()) as FactsheetResponse;
}

export async function fetchReport(slug: string): Promise<ReportResponse> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/report`, NO_STORE);
  if (!res.ok) throw new Error(`Failed to load report (${res.status})`);
  return (await res.json()) as ReportResponse;
}

export async function saveReport(slug: string, report: Reading): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ report }),
  });
  const body = (await res.json()) as SaveResponse;
  if (!body.ok) throw new Error(body.error ?? `Save failed (${res.status})`);
}

export async function exportProject(
  slug: string,
  format: ExportFormat,
  layout?: ExportRequest['layout'],
  lang?: ExportRequest['lang'],
): Promise<ExportFile[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format, layout, lang }),
  });
  const body = (await res.json()) as ExportResponse;
  if (!body.ok) throw new Error(body.error ?? `Export failed (${res.status})`);
  return body.files ?? [];
}

export const imageUrl = (slug: string): string => `/api/projects/${encodeURIComponent(slug)}/image`;
export const fileUrl = (slug: string, name: string): string =>
  `/api/projects/${encodeURIComponent(slug)}/files/${encodeURIComponent(name)}`;

export async function getConfig(): Promise<ConfigResponse> {
  const res = await fetch('/api/config', NO_STORE);
  if (!res.ok) throw new Error(`Failed to read config (${res.status})`);
  return (await res.json()) as ConfigResponse;
}

/** Promote this project's reading into the predefined library (the F3 loop). */
/** Whether the user's library already has this target's text for `style`. */
export async function predefinedExists(slug: string, style: string): Promise<boolean> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(slug)}/predefined-status?style=${encodeURIComponent(style)}`,
    NO_STORE,
  );
  const body = (await res.json()) as { ok: boolean; exists?: boolean; error?: string };
  if (!body.ok) throw new Error(body.error ?? `Could not check the library (${res.status})`);
  return !!body.exists;
}

export async function savePredefined(slug: string, style?: string): Promise<SavePredefinedResponse> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/save-predefined`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ style }),
  });
  const body = (await res.json()) as SavePredefinedResponse;
  if (!body.ok) throw new Error(body.error ?? `Failed to save (${res.status})`);
  return body;
}

/** Save the human-drawn features into the user's atlas overlay (the F2 loop). */
/** How many annotations from this project's earlier save a new save replaces. */
export async function annotationsToReplace(slug: string): Promise<number> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/annotations-status`, NO_STORE);
  const body = (await res.json()) as { ok: boolean; replaced?: number; error?: string };
  if (!body.ok) throw new Error(body.error ?? `Could not check the atlas overlay (${res.status})`);
  return body.replaced ?? 0;
}

export async function saveAnnotations(
  slug: string,
): Promise<{ ok: boolean; saved: number; target?: string; note?: string }> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/save-annotations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const body = (await res.json()) as { ok: boolean; saved?: number; target?: string; note?: string; error?: string };
  if (!body.ok) throw new Error(body.error ?? `Failed to save (${res.status})`);
  return { ok: true, saved: body.saved ?? 0, target: body.target, note: body.note };
}
