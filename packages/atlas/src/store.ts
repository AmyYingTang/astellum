import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PredefinedLibrary } from '@astellum/schema';
import { AtlasFile, EMPTY_ATLAS } from './atlas.js';

// Storage adapter (TOOL_HANDOFF §3, §12). Two separable concerns:
//   1. the atlas JSON — small, portable, the ONLY thing the consumer reads;
//      stored as a committable static data file.
//   2. reference images — large binaries, needed only for tool-side editing.
//
// Backend is config-driven, never hardcoded: `local` (default, zero deps,
// self-deploy out of the box) here; `r2`/`s3` adapters implement the same
// interface later. Credentials (if any) stay server-side env — never VITE_.

export interface AtlasStore {
  loadAtlas(): Promise<AtlasFile>;
  saveAtlas(atlas: AtlasFile): Promise<void>;
  /** Persist a reference image under `key`; returns the key stored in the entry. */
  putRefImage(key: string, data: Buffer): Promise<string>;
  /** Fetch a reference image by key (works for local FS or object storage). */
  getRefImage(key: string): Promise<Buffer>;
  /** Write the read-optimized approved-only registry (the apply-side artifact). */
  saveRegistry(registry: unknown): Promise<void>;
  /** Read it back, to tell whether it still matches what has been approved. */
  loadRegistry(): Promise<unknown | null>;
  /** Predefined readings, stored beside the annotations they belong to. */
  loadReadings(): Promise<PredefinedLibrary>;
  saveReadings(library: PredefinedLibrary): Promise<void>;
}

export interface LocalStoreOptions {
  /** Root data dir. atlas.json lives here; ref images under `<dataDir>/refimg`. */
  dataDir: string;
}

export class LocalAtlasStore implements AtlasStore {
  private readonly dataDir: string;
  private readonly atlasPath: string;
  private readonly registryPath: string;
  private readonly readingsPath: string;
  private readonly imgDir: string;

  constructor(opts: LocalStoreOptions) {
    this.dataDir = resolve(opts.dataDir);
    this.atlasPath = join(this.dataDir, 'atlas.json');
    this.registryPath = join(this.dataDir, 'registry.json');
    // Readings live in the same dir as the annotations they describe, so which
    // layer you edit follows from which atlas you opened — the shipped seed for
    // a curator, your own dir for a deployment correcting it.
    this.readingsPath = join(this.dataDir, 'readings.json');
    this.imgDir = join(this.dataDir, 'refimg');
  }

  async loadAtlas(): Promise<AtlasFile> {
    try {
      const raw = await readFile(this.atlasPath, 'utf8');
      return AtlasFile.parse(JSON.parse(raw));
    } catch (e) {
      // Missing file → empty atlas (first run). Re-throw genuine parse errors so
      // a corrupt data file isn't silently masked as "empty".
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY_ATLAS };
      throw e;
    }
  }

  async saveAtlas(atlas: AtlasFile): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const valid = AtlasFile.parse(atlas);
    await writeFile(this.atlasPath, JSON.stringify(valid, null, 2) + '\n', 'utf8');
  }

  async putRefImage(key: string, data: Buffer): Promise<string> {
    await mkdir(this.imgDir, { recursive: true });
    await writeFile(this.safePath(key), data);
    return key;
  }

  async getRefImage(key: string): Promise<Buffer> {
    return readFile(this.safePath(key));
  }

  /** What was exported last, or null if nothing ever was. */
  async loadRegistry(): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(this.registryPath, 'utf8')) as unknown;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async saveRegistry(registry: unknown): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  }

  async loadReadings(): Promise<PredefinedLibrary> {
    try {
      return PredefinedLibrary.parse(JSON.parse(await readFile(this.readingsPath, 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return { schema_version: 1, entries: [] };
      }
      throw e;
    }
  }

  async saveReadings(library: PredefinedLibrary): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const valid = PredefinedLibrary.parse(library);
    await writeFile(this.readingsPath, JSON.stringify(valid, null, 2) + '\n', 'utf8');
  }

  /** Guard against path traversal in a ref-image key. */
  private safePath(key: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`Invalid image key: ${key}`);
    return join(this.imgDir, key);
  }
}
