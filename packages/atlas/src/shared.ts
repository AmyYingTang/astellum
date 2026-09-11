import type { Wcs } from '@astellum/schema';
import type { AtlasEntry } from './atlas.js';

// Wire contracts shared by the atlas server and its React client.

export interface UploadRequest {
  filename: string;
  /** data: URI or bare base64 of the reference image. */
  imageBase64: string;
}
export interface UploadResponse {
  ok: boolean;
  jobId?: string;
  error?: string;
}

export type JobState = 'running' | 'done' | 'failed';

/** Identity + type suggested by the A-class identification pipeline, to prefill
 *  the annotation form. The user can still edit it. */
export interface SuggestedIdentity {
  primary_id: string;
  aliases: string[];
  /** Object type from the catalog cross-match (emission/reflection/…). Context
   *  only — NOT stored in the atlas (B-class morphology is type-agnostic). */
  type?: { zh?: string; en?: string; otype: string };
}

/** A plate-solve + identify job. nova is slow, so upload returns a jobId the
 *  client polls. */
export interface SolveJob {
  state: JobState;
  stage?: 'storing' | 'solving' | 'identifying';
  error?: string;
  // Present once state === 'done':
  wcs?: Wcs;
  imageRef?: string;
  width?: number;
  height?: number;
  suggested?: SuggestedIdentity;
}

export interface StatusCounts {
  draft: number;
  in_review: number;
  approved: number;
}
export interface ObjectSummary {
  primary_id: string;
  aliases: string[];
  annotations: number;
  status: StatusCounts;
}
export interface ObjectsResponse {
  objects: ObjectSummary[];
}

export interface EntryResponse {
  entry: AtlasEntry | null;
}

export interface SaveEntryRequest {
  entry: AtlasEntry;
}
export interface SaveEntryResponse {
  ok: boolean;
  error?: string;
  /** New entry revision after a successful save. */
  rev?: number;
  /** True when the save was rejected because someone else changed the entry. */
  conflict?: boolean;
}

/** A row in the target list: a seed-pool target and/or a real atlas entry. */
export interface TargetRow {
  key: string;
  /** Catalogue designation, shown alongside the nickname. */
  designation: string;
  name_en: string;
  name_zh: string;
  kind_en: string;
  kind_zh: string;
  note_en: string;
  note_zh: string;
  hemisphere: string;
  /** Suggested feature types to draw. */
  features: string[];
  /** Identity strings, so search finds a target even before it's annotated. */
  match: string[];
  /** True when this came from the curated seed pool (false = user-added entry). */
  seed: boolean;
  /** The atlas entry's primary_id, when one exists. */
  primary_id?: string;
  /** 0 when nothing has been annotated for this target yet. */
  annotations: number;
  status: StatusCounts;
  /** True once a solved reference image is attached — i.e. the target is ready
   *  to draw on. Distinct from `annotations > 0`: an imported target has an
   *  image but no annotations yet. */
  has_image: boolean;
}

export interface TargetsResponse {
  targets: TargetRow[];
}

export interface ExportRegistryResponse {
  ok: boolean;
  objects?: number;
  annotations?: number;
  error?: string;
}
