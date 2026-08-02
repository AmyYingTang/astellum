import express from 'express';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  identify,
  createConfiguredSolveClient,
  isFitsPath,
  fitsBufferToImage,
  isLocalSolver,
  solverName,
  createSimbadCatalogClient,
  createVizierCatalogClient,
  createOpenNgcCatalogClient,
  createCompositeCatalogClient,
} from '@astrolens/identify';
import type { FactSheet } from '@astrolens/schema';
import { PredefinedReading, findPredefined } from '@astrolens/schema';
import { loadConfig } from '@astrolens/schema/node';
import { draftPredefinedStyle } from '@astrolens/reader';
import { AtlasEntry, AtlasFile, findEntry, normalizeId } from './atlas.js';
import { LocalAtlasStore, type AtlasStore } from './store.js';
import { FEATURE_TYPES } from './featureTypes.js';
import { SEED_TARGETS } from './seedTargets.js';
import type {
  ObjectsResponse,
  ObjectSummary,
  EntryResponse,
  ExportRegistryResponse,
  SaveEntryRequest,
  SaveEntryResponse,
  SolveJob,
  StatusCounts,
  SuggestedIdentity,
  TargetRow,
  TargetsResponse,
  UploadRequest,
  UploadResponse,
} from './shared.js';

const here = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(here, 'client');
const KEY_RE = /^[A-Za-z0-9._-]+$/;

export interface AtlasServerOptions {
  /** Data dir for the local store (atlas.json + refimg/). */
  dataDir: string;
  port?: number;
  store?: AtlasStore; // inject an alternative adapter (r2/s3) later
}

export interface AtlasServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

function statusCounts(entry: AtlasEntry): StatusCounts {
  const c: StatusCounts = { draft: 0, in_review: 0, approved: 0 };
  for (const a of entry.annotations) c[a.status] += 1;
  return c;
}

function contentType(key: string): string {
  return extname(key).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
}

/** Derive a suggested atlas identity from the identification result: the primary
 *  A-class object's canonical id + a deduped alias pool + its catalog type. The
 *  user confirms/edits it, so this only needs to be a good starting point. */
function suggestIdentity(fs: FactSheet): SuggestedIdentity | null {
  const obj =
    fs.objects.find((o) => o.role === 'primary' && o.tier === 'A') ??
    fs.objects.find((o) => o.tier === 'A');
  if (!obj) return null;
  const primary_id = obj.designations[0] ?? obj.names[0] ?? obj.id;
  const pool = [
    obj.common_name?.zh,
    obj.common_name?.en,
    ...obj.names,
    ...obj.designations,
    ...Object.values(obj.catalog_ids),
  ].filter((s): s is string => Boolean(s));
  const seen = new Set([normalizeId(primary_id)]);
  const aliases: string[] = [];
  for (const s of pool) {
    const k = normalizeId(s);
    if (!seen.has(k)) {
      seen.add(k);
      aliases.push(s);
    }
  }
  return { primary_id, aliases, type: obj.type ? { zh: obj.type.zh, en: obj.type.en, otype: obj.type.otype } : undefined };
}

/** Constant-time string compare, so the shared password can't be timing-probed. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function startAtlasServer(opts: AtlasServerOptions): Promise<AtlasServerHandle> {
  const port = opts.port ?? 3100;
  const store: AtlasStore = opts.store ?? new LocalAtlasStore({ dataDir: opts.dataDir });

  // Serialize every atlas read-modify-write. Without this two concurrent saves
  // can both load, then both write — silently losing one.
  let writeChain: Promise<unknown> = Promise.resolve();
  const withAtlasLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = writeChain.then(() => fn());
    writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  // In-memory solve jobs (nova is slow; upload returns a jobId the client polls).
  const jobs = new Map<string, SolveJob>();
  let jobSeq = 0;

  const requireApiKey = (): string | undefined => {
    const apiKey = process.env.ASTROMETRY_API_KEY;
    if (!apiKey && !isLocalSolver()) {
      throw new Error(
        'Plate-solving needs a nova API key. Put ASTROMETRY_API_KEY in a .env file (where you run the atlas server) or export it, then restart — or set ASTROLENS_SOLVER=local for offline solving. Free key from nova.astrometry.net.',
      );
    }
    return apiKey;
  };

  const app = express();

  // Shared-password gate. Unset ($ATLAS_PASSWORD) → open, as for local single-
  // user use. Set → HTTP Basic on everything (pages, API and reference images),
  // which is what you want before exposing this over a tunnel. Any username.
  const password = process.env.ATLAS_PASSWORD;
  if (password) {
    app.use((req, res, next) => {
      const header = req.headers.authorization ?? '';
      const [scheme, encoded] = header.split(' ');
      if (scheme === 'Basic' && encoded) {
        const given = Buffer.from(encoded, 'base64').toString('utf8');
        const pass = given.slice(given.indexOf(':') + 1);
        if (safeEqual(pass, password)) return next();
      }
      res.set('WWW-Authenticate', 'Basic realm="astrolens atlas", charset="UTF-8"');
      res.status(401).send('Authentication required.');
    });
  }

  // Client downscales reference images before upload, so payloads are small;
  // this is a generous backstop for the rare large one that slips through.
  // A FITS reference image arrives undownscaled — the browser cannot decode one
  // to shrink it first — so the limit has to clear a full-size master.
  app.use(express.json({ limit: '256mb' }));

  // Which plate-solver is configured — shown in the tool's UI.
  app.get('/api/config', (_req, res) =>
    res.json({
      solver: solverName(),
      localSolver: isLocalSolver(),
      // Set when launched from the hub, so the UI can offer a way back.
      hubUrl: process.env.ASTROLENS_HUB_URL || undefined,
      // Whether an LLM is configured to write text — decides whether the
      // reading editor offers to draft one.
      readingMode: loadConfig().reading.mode,
    }),
  );

  // Static feature-type vocabulary — one source for client + server.
  app.get('/api/feature-types', (_req, res) => res.json({ featureTypes: FEATURE_TYPES }));

  // Upload a reference image → store it → plate-solve in the background.
  app.post('/api/upload', async (req, res) => {
    try {
      const body = req.body as UploadRequest;
      const apiKey = requireApiKey();
      const ext = (extname(body.filename ?? '') || '.jpg').toLowerCase();
      const jobId = `${Date.now().toString(36)}-${(jobSeq++).toString(36)}`;

      const b64 = body.imageBase64.replace(/^data:[^;]+;base64,/, '');
      let buf: Buffer = Buffer.from(b64, 'base64');
      let imageRef = `upload_${jobId}${ext === '.png' ? '.png' : '.jpg'}`;
      let fitsObject: string | undefined;

      // The browser downscales a reference image before uploading, but it has no
      // FITS decoder, so a FITS arrives whole and undecoded. Convert and apply
      // the same size cap here — what gets stored is then what the solve sees,
      // which is the property the WCS depends on.
      if (isFitsPath(body.filename ?? '')) {
        const converted = await fitsBufferToImage(buf, { maxEdge: 4096 });
        buf = Buffer.from(converted.buffer);
        imageRef = `upload_${jobId}.png`;
        fitsObject = converted.objectName;
      }
      await store.putRefImage(imageRef, buf);

      jobs.set(jobId, { state: 'running', stage: 'storing' });
      res.json({ ok: true, jobId } satisfies UploadResponse);

      // Background: read dims + solve. A temp file on disk is needed because the
      // nova client reads an image path.
      void (async () => {
        try {
          const meta = await sharp(buf).metadata();
          if (!meta.width || !meta.height) throw new Error('Could not read image dimensions');
          const dir = join(tmpdir(), 'astrolens-atlas');
          await mkdir(dir, { recursive: true });
          const tmpPath = join(dir, imageRef);
          await writeFile(tmpPath, buf);

          // Reuse the full identification pipeline (plate-solve + A-class catalog
          // cross-match) — same code the main path uses — so the annotation form
          // is prefilled with the canonical identity instead of hand-typed.
          jobs.set(jobId, { state: 'running', stage: 'identifying' });
          const factsheet = await identify(
            { imagePath: tmpPath, width: meta.width, height: meta.height, imageSrc: imageRef },
            {
              solve: createConfiguredSolveClient({ apiKey }),
              catalog: createCompositeCatalogClient([
                createSimbadCatalogClient(),
                createVizierCatalogClient(),
                createOpenNgcCatalogClient(),
              ]),
            },
          );
          if (factsheet.solve.status !== 'solved' || !factsheet.solve.wcs) {
            jobs.set(jobId, {
              state: 'failed',
              error: `Plate-solve failed (${factsheet.solve.status}). ${factsheet.warnings.join(' ')}`.trim(),
            });
            return;
          }
          jobs.set(jobId, {
            state: 'done',
            wcs: factsheet.solve.wcs,
            imageRef,
            width: meta.width,
            height: meta.height,
            // A FITS header's OBJECT is what the capture program was pointed
            // at — a reasonable identity when the catalogue cross-match is
            // undecided, but never a reason to override one that isn't.
            suggested: suggestIdentity(factsheet) ?? (fitsObject ? { primary_id: fitsObject, aliases: [] } : undefined),
          });
        } catch (e) {
          jobs.set(jobId, { state: 'failed', error: (e as Error).message });
        }
      })();
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message } satisfies UploadResponse);
    }
  });

  app.get('/api/job/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) {
      res.status(404).json({ state: 'failed', error: 'no such job' } satisfies SolveJob);
      return;
    }
    res.json(job satisfies SolveJob);
  });

  // Serve a stored reference image.
  app.get('/refimg/:key', async (req, res) => {
    const key = req.params.key;
    if (!KEY_RE.test(key)) {
      res.status(400).end();
      return;
    }
    try {
      const buf = await store.getRefImage(key);
      res.setHeader('Content-Type', contentType(key));
      res.send(buf);
    } catch (e) {
      res.status(404).send((e as Error).message);
    }
  });

  app.get('/api/objects', async (_req, res) => {
    const atlas = await store.loadAtlas();
    const objects: ObjectSummary[] = atlas.objects.map((o) => ({
      primary_id: o.primary_id,
      aliases: o.aliases,
      annotations: o.annotations.length,
      status: statusCounts(o),
    }));
    res.json({ objects } satisfies ObjectsResponse);
  });

  // The target list: the curated seed pool LEFT-JOINed with real atlas entries,
  // so un-annotated targets simply show 0. Nothing here is written to atlas.json
  // — the pool is static config. Entries that aren't in the pool (user-added) are
  // appended so the list is still the complete picture.
  app.get('/api/targets', async (_req, res) => {
    const atlas = await store.loadAtlas();
    const claimed = new Set<AtlasEntry>();
    const targets: TargetRow[] = SEED_TARGETS.map((t) => {
      const keys = new Set(t.match.map(normalizeId));
      const entry = atlas.objects.find(
        (o) => keys.has(normalizeId(o.primary_id)) || o.aliases.some((a) => keys.has(normalizeId(a))),
      );
      if (entry) claimed.add(entry);
      return {
        key: t.key,
        designation: t.designation,
        name_en: t.name_en,
        name_zh: t.name_zh,
        kind_en: t.kind_en,
        kind_zh: t.kind_zh,
        note_en: t.note_en,
        note_zh: t.note_zh,
        hemisphere: t.hemisphere,
        features: [...t.features],
        match: [...t.match],
        seed: true,
        ...(entry ? { primary_id: entry.primary_id } : {}),
        annotations: entry?.annotations.length ?? 0,
        status: entry ? statusCounts(entry) : { draft: 0, in_review: 0, approved: 0 },
        has_image: Boolean(entry?.reference),
      };
    });
    for (const o of atlas.objects) {
      if (claimed.has(o)) continue;
      targets.push({
        key: `entry:${o.primary_id}`,
        designation: o.primary_id,
        name_en: o.primary_id,
        name_zh: o.primary_id,
        kind_en: '—',
        kind_zh: '—',
        note_en: 'Added outside the seed pool.',
        note_zh: '清单之外自行添加的条目。',
        hemisphere: '',
        features: [],
        match: [o.primary_id, ...o.aliases],
        seed: false,
        primary_id: o.primary_id,
        annotations: o.annotations.length,
        status: statusCounts(o),
        has_image: Boolean(o.reference),
      });
    }
    res.json({ targets } satisfies TargetsResponse);
  });

  app.get('/api/object/:id', async (req, res) => {
    const atlas = await store.loadAtlas();
    const key = normalizeId(req.params.id);
    const entry =
      atlas.objects.find(
        (o) => normalizeId(o.primary_id) === key || o.aliases.some((a) => normalizeId(a) === key),
      ) ?? null;
    res.json({ entry } satisfies EntryResponse);
  });

  // Upsert an entry (matched by normalised primary_id). Serialized, and guarded
  // by the entry's `rev`: the client must send the rev it loaded, so a stale page
  // can't silently overwrite someone else's edits (two people, one instance).
  app.put('/api/object/:id', async (req, res) => {
    try {
      const incoming = AtlasEntry.parse((req.body as SaveEntryRequest).entry);
      const result = await withAtlasLock(async () => {
        const atlas = await store.loadAtlas();
        const key = normalizeId(incoming.primary_id);
        const idx = atlas.objects.findIndex((o) => normalizeId(o.primary_id) === key);
        const current = idx >= 0 ? atlas.objects[idx] : undefined;
        if (current && current.rev !== incoming.rev) {
          return { conflict: true, rev: current.rev } as const;
        }
        const saved = { ...incoming, rev: (current?.rev ?? 0) + 1 };
        if (idx >= 0) atlas.objects[idx] = saved;
        else atlas.objects.push(saved);
        await store.saveAtlas(AtlasFile.parse(atlas));
        return { conflict: false, rev: saved.rev } as const;
      });
      if (result.conflict) {
        res.status(409).json({
          ok: false,
          conflict: true,
          error: 'This entry was changed by someone else since you loaded it. Reload before saving.',
        } satisfies SaveEntryResponse);
        return;
      }
      res.json({ ok: true, rev: result.rev } satisfies SaveEntryResponse);
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message } satisfies SaveEntryResponse);
    }
  });

  // --- predefined readings -------------------------------------------------
  // Reviewed next to the annotations they describe: the same target, the same
  // pass. The layer you write follows the atlas you opened, so a deployment
  // correcting the shipped wording never edits the shipped file.

  app.get('/api/readings/:id', async (req, res) => {
    try {
      const atlas = await store.loadAtlas();
      const entry = findEntry(atlas, req.params.id);
      const lib = await store.loadReadings();
      const ids = entry ? [entry.primary_id, ...entry.aliases] : [req.params.id];
      const found = findPredefined(lib, ids);
      res.json({
        ok: true,
        reading: found ?? null,
        // Every annotation gets a slot, not just the approved ones. Text is
        // keyed by an id that is stable from the moment a shape is drawn, so
        // writing before approval is safe — and it lets one review pass cover
        // the shape and its words together instead of forcing two.
        annotations: (entry?.annotations ?? []).map((a) => ({
          id: a.id,
          feature_type: a.feature_type,
          label: a.label,
          note: a.note ?? null,
          status: a.status,
        })),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // Draft this target's reading with the LLM, from the annotations that are
  // already approved. The same job `astrolens readings-draft` does, offered
  // where the work actually happens — an annotator reviewing a target should
  // not have to leave for a terminal to get a first pass.
  //
  // The result is returned, not saved: it lands in the form for a person to
  // read and correct, which is the whole point of calling it a draft.
  app.post('/api/readings/:id/draft', async (req, res) => {
    try {
      const cfg = loadConfig();
      if (cfg.reading.mode !== 'ai') {
        throw new Error('Reading mode is set to the predefined library — nothing to draft with.');
      }
      const atlas = await store.loadAtlas();
      const entry = findEntry(atlas, req.params.id);
      if (!entry) throw new Error(`Not in the atlas: ${req.params.id}`);
      // Drafts included: an annotator writes text while the shapes are still
      // being worked on, and reviews both in one pass. A shape that is later
      // dropped leaves an entry keyed to an id nothing looks up — harmless.
      const drawn = entry.annotations.filter((a) => a.id);
      const style = String((req.body as { style?: string } | undefined)?.style ?? cfg.reading.style);

      const drafted = await draftPredefinedStyle(
        {
          primary_id: entry.primary_id,
          aliases: entry.aliases,
          annotations: drawn.map((a) => ({
            id: a.id,
            feature_type: a.feature_type,
            geometry: a.geometry,
            label: a.label,
            ...(a.note ? { note: a.note } : {}),
          })),
        },
        { style, model: cfg.reading.model ?? undefined },
      );
      res.json({ ok: true, style: drafted, styleName: style, annotations: drawn.length });
    } catch (e) {
      // The CLI's failures quote the whole prompt back, which is useful in a
      // terminal and a wall of text in a status line. Keep the first line.
      const msg = (e as Error).message.split('\n')[0]!.slice(0, 300);
      res.status(400).json({ ok: false, error: msg });
    }
  });

  app.put('/api/readings/:id', async (req, res) => {
    try {
      const body = req.body as { reading?: unknown };
      const parsed = PredefinedReading.parse(body.reading);
      const lib = await store.loadReadings();
      const key = normalizeId(parsed.primary_id);
      const entries = lib.entries.filter((e) => normalizeId(e.primary_id) !== key);
      entries.push({ ...parsed, updated_at: new Date().toISOString() });
      await store.saveReadings({ schema_version: 1, entries });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  // Export the read-optimized, approved-only registry the apply side consumes.
  // Slim: only what apply needs (id + aliases + feature_type + geometry + label).
  app.post('/api/export-registry', async (_req, res) => {
    try {
      const atlas = await store.loadAtlas();
      const objects = atlas.objects
        .map((o) => ({
          primary_id: o.primary_id,
          aliases: o.aliases,
          annotations: o.annotations
            .filter((a) => a.status === 'approved')
            .map((a) => ({
              // Carried so predefined readings can attach text to this exact
              // annotation (stable across re-exports).
              id: a.id,
              feature_type: a.feature_type,
              geometry: a.geometry,
              label: a.label,
              ...(a.label_anchor ? { label_anchor: a.label_anchor } : {}),
              ...(a.note ? { note: a.note } : {}),
            })),
        }))
        .filter((o) => o.annotations.length > 0);
      const registry = { schema_version: 1 as const, objects };
      await store.saveRegistry(registry);
      const annotations = objects.reduce((n, o) => n + o.annotations.length, 0);
      res.json({ ok: true, objects: objects.length, annotations } satisfies ExportRegistryResponse);
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message } satisfies ExportRegistryResponse);
    }
  });

  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(resolve(clientDist, 'index.html')));

  const server = app.listen(port);
  await new Promise<void>((res, rej) => {
    server.once('listening', () => res());
    server.once('error', rej);
  });

  return {
    url: `http://localhost:${port}`,
    port,
    close: () => new Promise<void>((res) => server.close(() => res())),
  };
}
