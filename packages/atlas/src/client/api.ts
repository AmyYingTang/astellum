import type {
  EntryResponse,
  ExportRegistryResponse,
  RegistryStatusResponse,
  ObjectsResponse,
  SaveEntryRequest,
  SaveEntryResponse,
  SolveJob,
  TargetsResponse,
  UploadRequest,
  UploadResponse,
} from '../shared.js';
import type { FeatureType } from '../featureTypes.js';

async function jsonPost<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: url.includes('/object/') ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    // Non-JSON response (e.g. a 413 PayloadTooLarge HTML page) — surface a
    // legible error instead of a JSON-parse crash.
    const hint = r.status === 413 ? '（图像过大 · image too large）' : '';
    throw new Error(`HTTP ${r.status} ${r.statusText} ${hint}`.trim());
  }
}

export async function fetchConfig(): Promise<{ solver: string; localSolver: boolean }> {
  const r = await fetch('/api/config');
  return (await r.json()) as { solver: string; localSolver: boolean };
}

export async function fetchFeatureTypes(): Promise<FeatureType[]> {
  const r = await fetch('/api/feature-types');
  const { featureTypes } = (await r.json()) as { featureTypes: FeatureType[] };
  return featureTypes;
}

export function uploadImage(body: UploadRequest): Promise<UploadResponse> {
  return jsonPost<UploadResponse>('/api/upload', body);
}

export async function getJob(id: string): Promise<SolveJob> {
  const r = await fetch(`/api/job/${id}`);
  return (await r.json()) as SolveJob;
}

export async function fetchTargets(): Promise<TargetsResponse> {
  const r = await fetch('/api/targets');
  return (await r.json()) as TargetsResponse;
}

export async function listObjects(): Promise<ObjectsResponse> {
  const r = await fetch('/api/objects');
  return (await r.json()) as ObjectsResponse;
}

export async function getObject(id: string): Promise<EntryResponse> {
  const r = await fetch(`/api/object/${encodeURIComponent(id)}`);
  return (await r.json()) as EntryResponse;
}

export function saveObject(id: string, body: SaveEntryRequest): Promise<SaveEntryResponse> {
  return jsonPost<SaveEntryResponse>(`/api/object/${encodeURIComponent(id)}`, body);
}

/** Which targets have approved work the exported registry does not carry. */
export async function registryStatus(): Promise<RegistryStatusResponse> {
  const r = await fetch('/api/registry-status');
  return (await r.json()) as RegistryStatusResponse;
}

export async function exportRegistry(): Promise<ExportRegistryResponse> {
  const r = await fetch('/api/export-registry', { method: 'POST' });
  return (await r.json()) as ExportRegistryResponse;
}

/** Poll a solve job until done/failed. */
export async function pollJob(id: string, onTick?: (j: SolveJob) => void): Promise<SolveJob> {
  for (;;) {
    const j = await getJob(id);
    onTick?.(j);
    if (j.state !== 'running') return j;
    await new Promise((r) => setTimeout(r, 3000));
  }
}
