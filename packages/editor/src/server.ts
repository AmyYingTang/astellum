import express from 'express';
import { readFile, writeFile, mkdir, readdir, access, rename } from 'node:fs/promises';
import { resolve, dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  Reading,
  FactSheet,
  PredefinedLibrary,
  findPredefined,
  pickStyle,
  mergeLibraries,
  stylePresets,
  isRoleId,
  defaultRoleId,
  Registry,
  pixelToWorld,
} from '@astellum/schema';
import { loadConfig } from '@astellum/schema/node';
import {
  identify,
  createConfiguredSolveClient,
  isLocalSolver,
  createCatalogFromSources,
  isOfflineCatalog,
  offlineCatalogStatus,
  isOfflineReady,
  loadRegistries,
  loadRegistry,
  atlasTypeFor,
  isFitsPath,
  fitsToPng,
  mergeRegistries,
  userRegistryPath,
  defaultRegistryPaths,
} from '@astellum/identify';
import {
  readingFromFactsheet,
  readingFromPredefined,
  loadReadingLibraries,
  defaultReadingsPaths,
  coverageSummary,
  loadReadingLibrary,
  userReadingsPath,
  tailorReading,
  ReaderError,
  dropFieldRings,
} from '@astellum/reader';
import { renderAnnotatedBuffer, renderPosterBuffers } from '@astellum/renderer';
import type {
  CreateProjectRequest,
  ExportFile,
  ExportFormat,
  ExportRequest,
  FactsheetResponse,
  JobStatus,
  ProjectSummary,
  ReportResponse,
  SaveRequest,
} from './shared.js';
import { objectStem } from './shared.js';

const here = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(here, 'client');
const SLUG_RE = /^[A-Za-z0-9._-]+$/;

export interface StudioServerOptions {
  workspace: string;
  port?: number;
  toolVersion?: string;
}

export interface StudioServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Filesystem-safe stem from an object name for export filenames: drop spaces
 * (so "NGC 3372" → "NGC3372"), keep hyphens ("Sh2-308" stays intact),
 * neutralize unsafe chars. Falls back to "report". */
async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function uniqueSlug(workspace: string, base: string): Promise<string> {
  const root = base || 'reading';
  let slug = root;
  let n = 2;
  while (await exists(join(workspace, slug))) {
    slug = `${root}-${n}`;
    n += 1;
  }
  return slug;
}

export async function startStudioServer(opts: StudioServerOptions): Promise<StudioServerHandle> {
  const workspace = resolve(opts.workspace);
  await mkdir(workspace, { recursive: true });
  const port = opts.port ?? 3000;
  const toolVersion = opts.toolVersion ?? '0.1.0';

  const projectDir = (slug: string): string => {
    if (!SLUG_RE.test(slug)) throw new Error(`Invalid project id: ${slug}`);
    return join(workspace, slug);
  };
  const loadFactsheet = async (slug: string): Promise<FactSheet> =>
    FactSheet.parse(JSON.parse(await readFile(join(projectDir(slug), 'factsheet.json'), 'utf8')));
  // Every reader of a reading — the page, the export — sees it brought up to
  // the rules it would be built with today, so a project from before a rule
  // does not show what a new one would not.
  const loadReport = async (slug: string): Promise<Reading> => {
    const reading = Reading.parse(
      JSON.parse(await readFile(join(projectDir(slug), 'reading.json'), 'utf8')),
    );
    const factsheet = await loadFactsheet(slug).catch(() => null);
    return factsheet ? dropFieldRings(reading, factsheet) : reading;
  };

  // In-memory create-job status, mirrored to job.json for durability/visibility.
  const jobs = new Map<string, JobStatus>();
  const setJob = async (slug: string, status: JobStatus): Promise<void> => {
    jobs.set(slug, status);
    try {
      await writeFile(join(projectDir(slug), 'job.json'), JSON.stringify(status, null, 2) + '\n', 'utf8');
    } catch {
      // project dir may not exist yet / was removed — in-memory status still holds
    }
  };

  const app = express();
  // A stacked FITS master runs far past what a JPEG needs.
  app.use(express.json({ limit: '256mb' }));

  // The control file is read per request, never cached.
  //
  // It used to be one `loadConfig()` here, which meant a change made on the
  // settings page did nothing in this process until somebody restarted it —
  // and nothing said so. `loadConfig` is a small JSON file read; the studio
  // handles a request when a person clicks something.

  /** Can this machine actually do what the active profile promises? */
  const readiness = async (): Promise<{
    catalogsReady: boolean;
    missingCatalogs: string[];
    readingTargets: number;
    readingsCovered: number;
  }> => {
    const config = loadConfig();
    const status = await offlineCatalogStatus();
    const library = await loadReadingLibraries(defaultReadingsPaths()).catch(() => null);
    const registry = await loadRegistries(defaultRegistryPaths()).catch(() => null);
    const targets = registry?.objects ?? [];
    const covered = library
      ? targets.filter((o) => {
          const found = findPredefined(library, [o.primary_id, ...o.aliases]);
          return !!(found && pickStyle(found, config.reading.style));
        }).length
      : 0;
    return {
      catalogsReady: isOfflineReady(status),
      missingCatalogs: status.filter((s) => !s.present).map((s) => s.key),
      readingTargets: targets.length,
      readingsCovered: covered,
    };
  };

  app.get('/api/config', async (_req, res) => {
    const config = loadConfig();
    res.json({
      solver: config.solve.mode === 'local' ? 'local astrometry.net' : 'nova',
      localSolver: config.solve.mode === 'local',
      config,
      offlineCatalog: isOfflineCatalog(config.catalog.sources),
      // Set when launched from the hub, so the UI can offer a way back.
      hubUrl: process.env.ASTELLUM_HUB_URL || undefined,
      // Style presets are curator copy; the overlay wins over the built-ins.
      // Resolved here rather than in the client, so the roles the studio
      // offers and the style keys the library is read by cannot disagree.
      stylePresets: stylePresets(),
      defaultRole: defaultRoleId(),
      readiness: await readiness().catch(() => undefined),
    });
  });

  app.get('/api/projects', async (_req, res) => {
    const entries = await readdir(workspace, { withFileTypes: true });
    const projects: ProjectSummary[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        const r = await loadReport(e.name);
        // A kiosk run writes a reading.json next to a self-contained
        // kiosk.html and no image file — the picture is inlined. Left in the
        // workspace it would list as a project whose thumbnail 404s on every
        // render, so skip anything whose image isn't actually there.
        if (!(await exists(join(workspace, e.name, basename(r.image.src))))) continue;
        const summary: ProjectSummary = {
          slug: e.name,
          name: r.object.name[r.display_language],
          type: r.object.type[r.display_language],
          stage: r.object.stage,
          imageName: basename(r.image.src),
          features: r.features.length,
        };
        try {
          const fs = await loadFactsheet(e.name);
          summary.solveStatus = fs.solve.status;
          summary.needsReview = fs.objects.filter((o) => o.needs_human_review).length;
        } catch {
          // pre-Stage-1 project without a fact sheet — leave chips unset
        }
        projects.push(summary);
      } catch {
        // not a project dir — skip
      }
    }
    res.json({ projects });
  });

  // The nova key is only needed for the nova solver; the local astrometry.net
  // solver (ASTELLUM_SOLVER=local) needs no key.
  const requireApiKey = (): string | undefined => {
    const config = loadConfig();
    const apiKey = process.env.ASTROMETRY_API_KEY;
    // The local solver needs no key — and the active profile, not just the env
    // var, is what decides which solver runs. `isLocalSolver` reads the profile
    // itself now, so the mode is passed only to save it re-reading the file.
    if (!apiKey && !isLocalSolver(config.solve.mode)) {
      throw new Error(
        'Plate-solving needs a nova API key. Put ASTROMETRY_API_KEY in a .env file (where you run the studio) or export it, then restart — or switch the solver to local in Settings (or set ASTELLUM_SOLVER=local) for offline solving. Free key from nova.astrometry.net.',
      );
    }
    return apiKey;
  };

  /** Stage 1 background job: identify → factsheet.json + a stub reading.json (no LLM). */
  const runIdentify = async (
    slug: string,
    dir: string,
    imagePath: string,
    imageName: string,
    width: number,
    height: number,
    opts: {
      apiKey?: string;
      hint?: string;
      lang: 'zh' | 'en';
      starMagMax?: number;
      /** Which role's pre-written text to fill in; only used in `predefined`. */
      role?: string;
    },
  ): Promise<void> => {
    const config = loadConfig();
    try {
      const factsheet = await identify(
        {
          imagePath,
          width,
          height,
          imageSrc: imageName,
          targetName: opts.hint,
          starMagMax: opts.starMagMax,
          registryPaths: defaultRegistryPaths(),
        },
        {
          solve: createConfiguredSolveClient({
            apiKey: opts.apiKey,
            mode: config.solve.mode,
            cache: config.solve.cache,
            fovLowDeg: config.solve.fovLowDeg,
            fovHighDeg: config.solve.fovHighDeg,
          }),
          catalog: createCatalogFromSources(config.catalog.sources, {
            snapshot: config.catalog.snapshot,
          }),
        },
      );
      await writeFile(join(dir, 'factsheet.json'), JSON.stringify(factsheet, null, 2) + '\n', 'utf8');

      if (factsheet.objects.length === 0) {
        await setJob(slug, {
          state: 'failed',
          error: `No object identified (solve=${factsheet.solve.status}). ${factsheet.warnings.join(' ')}`.trim(),
          warnings: factsheet.warnings,
        });
        return;
      }

      // How the text gets written depends on the profile:
      //  - `ai` (offsite): a stub with grounded annotations and no explanations;
      //    the user reviews the placement, then asks for the LLM pass.
      //  - `predefined` (onsite): the curated library fills it in right here, so
      //    the frame is complete and showable with no network and no LLM.
      const { reading, coverage } =
        config.reading.mode === 'predefined'
          ? readingFromPredefined(factsheet, await loadReadingLibraries(defaultReadingsPaths()), {
              toolVersion,
              displayLanguage: opts.lang,
              imageSrc: imageName,
              // The role the curator has selected, which is a style key. The
              // configured style stays as the fallback for a request that
              // names no role at all.
              style: opts.role ?? config.reading.style,
              fallback: config.reading.fallback,
            })
          : {
              reading: readingFromFactsheet(factsheet, {
                toolVersion,
                displayLanguage: opts.lang,
                imageSrc: imageName,
              }),
              coverage: null,
            };
      await writeFile(join(dir, 'reading.json'), JSON.stringify(reading, null, 2) + '\n', 'utf8');
      if (coverage) {
        const c = coverageSummary(coverage);
        console.error(
          `[studio] predefined text: target=${c.target} note=${c.annotation_note} ` +
            `generic=${c.feature_generic} facts=${c.facts}` +
            `${coverage.matchedTarget ? ` (matched ${coverage.matchedTarget})` : ' (no target entry)'}`,
        );
      }
      await setJob(slug, { state: 'done', stage: 'done', warnings: factsheet.warnings });
    } catch (e) {
      await setJob(slug, { state: 'failed', error: (e as Error).message });
    }
  };

  app.post('/api/projects', async (req, res) => {
    try {
      const body = req.body as CreateProjectRequest;
      const apiKey = requireApiKey();

      const ext = (extname(body.filename ?? '') || '.jpg').toLowerCase();
      const base = slugify(basename(body.filename ?? 'reading', ext));
      const slug = await uniqueSlug(workspace, base);
      const dir = join(workspace, slug);
      await mkdir(dir, { recursive: true });

      const b64 = body.imageBase64.replace(/^data:[^;]+;base64,/, '');
      const sourcePath = join(dir, `source${ext}`);
      await writeFile(sourcePath, Buffer.from(b64, 'base64'));

      // A stacker writes FITS and nothing downstream can open one, so convert
      // at the door with a display stretch — a linear master is nearly black,
      // and the solver needs to see stars as much as the reader does. The
      // original is kept beside it; only the PNG is used from here on.
      let imageName = `image${ext}`;
      let imagePath = join(dir, imageName);
      let hintFromFile: string | undefined;
      if (isFitsPath(sourcePath)) {
        imageName = 'image.png';
        imagePath = join(dir, imageName);
        const f = await fitsToPng(sourcePath, imagePath);
        hintFromFile = f.objectName;
      } else {
        await rename(sourcePath, imagePath);
      }

      const meta = await sharp(imagePath).metadata();
      if (!meta.width || !meta.height) throw new Error('Could not read image dimensions');

      // nova is slow: run identify as a background job; client polls /job.
      await setJob(slug, { state: 'running', stage: 'solving' });
      res.json({ ok: true, slug });
      void runIdentify(slug, dir, imagePath, imageName, meta.width, meta.height, {
        apiKey,
        // A FITS header's OBJECT is what the capture program was pointed at —
        // as good a hint as the one the user would have typed.
        hint: body.hint || hintFromFile || undefined,
        lang: body.lang === 'en' ? 'en' : 'zh',
        ...(isRoleId(body.role) ? { role: body.role } : {}),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // Generate the AI reading on demand (LLM only) — tailors text onto the
  // already-reviewed annotations, preserving their circles/labels.
  //
  // KNOWN GAP: this does not consult `reading.mode`. A studio set to
  // `predefined` still offers the button and still comes here, so with no
  // model in reach it simply fails. `ReadingConfig.mode`'s comment says the
  // studio stops offering what it cannot do; it does not. Left as-is on
  // purpose — changing it is a behaviour change nobody has asked for yet.
  app.post('/api/projects/:slug/reading', async (req, res) => {
    try {
      const slug = req.params.slug;
      const dir = projectDir(slug);
      const body = (req.body ?? {}) as { tone?: string; role?: string };
      // The client folds the role into `tone` itself, because it knows which
      // language the curator is reading in. `role` is the fallback for a
      // caller that only names who it is for.
      const tone =
        body.tone ||
        (isRoleId(body.role) ? stylePresets().find((p) => p.id === body.role)?.textZh : undefined) ||
        undefined;
      const reading = await loadReport(slug);
      const files = await readdir(dir);
      const imageName = files.find((f) => /^image\.(jpe?g|png)$/i.test(f));
      const imagePath = imageName ? join(dir, imageName) : undefined;

      await setJob(slug, { state: 'running', stage: 'reading' });
      res.json({ ok: true, slug });
      void (async () => {
        try {
          // Hand the fact sheet along so the prompt can carry each feature's
          // precise taxonomy type — offsite is where precision is wanted.
          const factsheet = await loadFactsheet(slug).catch(() => undefined);
          const tailored = await tailorReading(reading, { imagePath, tone, factsheet });
          await writeFile(join(dir, 'reading.json'), JSON.stringify(tailored, null, 2) + '\n', 'utf8');
          await setJob(slug, { state: 'done', stage: 'done' });
        } catch (e) {
          // On parse failure, save the raw LLM output so it can be inspected.
          let error = (e as Error).message;
          if (e instanceof ReaderError && e.raw) {
            try {
              await writeFile(join(dir, 'raw_llm_output.txt'), e.raw, 'utf8');
              error += ` (raw output saved to ${slug}/raw_llm_output.txt)`;
            } catch {
              // best-effort
            }
          }
          await setJob(slug, { state: 'failed', error });
        }
      })();
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // Re-run identification on an existing project's stored image (no re-upload).
  /**
   * Re-read this project's text from the predefined library, in one role.
   *
   * The studio's half of the kiosk's role switch. The expensive work — the
   * solve and the catalogue query — is already on disk as `factsheet.json`,
   * so changing role is a library read, not an identification.
   *
   * Only for the predefined side. In `ai` mode a role is who the next
   * generation is written for, and re-reading here would replace prose the
   * model wrote with the library's, which nobody asked for.
   */
  app.post('/api/projects/:slug/predefined-text', async (req, res) => {
    try {
      const slug = req.params.slug;
      const dir = projectDir(slug);
      const config = loadConfig();
      const { role } = (req.body ?? {}) as { role?: string };
      if (!isRoleId(role)) throw new Error(`Not a role: ${role ?? '(none)'}`);
      const factsheet = await loadFactsheet(slug);
      let lang: 'zh' | 'en' = 'zh';
      try {
        lang = (await loadReport(slug)).display_language;
      } catch {
        // no prior reading — default zh
      }
      const files = await readdir(dir);
      const imageName = files.find((f) => /^image\.(jpe?g|png)$/i.test(f)) ?? factsheet.image.src;
      const { reading, coverage } = readingFromPredefined(
        factsheet,
        await loadReadingLibraries(defaultReadingsPaths()),
        {
          toolVersion,
          displayLanguage: lang,
          imageSrc: imageName,
          style: role,
          fallback: config.reading.fallback,
        },
      );
      await writeFile(join(dir, 'reading.json'), JSON.stringify(reading, null, 2) + '\n', 'utf8');
      res.json({ ok: true, role, matchedStyle: coverage.style ?? null });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  app.post('/api/projects/:slug/reidentify', async (req, res) => {
    try {
      const slug = req.params.slug;
      const dir = projectDir(slug);
      const apiKey = requireApiKey();
      const { starMagMax, role } = (req.body ?? {}) as { starMagMax?: number; role?: string };

      const files = await readdir(dir);
      const imageName = files.find((f) => /^image\.(jpe?g|png)$/i.test(f));
      if (!imageName) throw new Error('No source image found in this project');
      const imagePath = join(dir, imageName);
      const meta = await sharp(imagePath).metadata();
      if (!meta.width || !meta.height) throw new Error('Could not read image dimensions');

      let lang: 'zh' | 'en' = 'zh';
      try {
        lang = (await loadReport(slug)).display_language;
      } catch {
        // no prior reading — default zh
      }

      await setJob(slug, { state: 'running', stage: 'solving' });
      res.json({ ok: true, slug });
      void runIdentify(slug, dir, imagePath, imageName, meta.width, meta.height, {
        apiKey,
        lang,
        starMagMax: typeof starMagMax === 'number' ? starMagMax : undefined,
        ...(isRoleId(role) ? { role } : {}),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // RETIRED: the AI (VLM) Class-B feature pass. B-class features now come solely
  // from the approved feature atlas (Atlas Apply); the automatic detectors are
  // no longer wired to user-visible rendering. `runAiFeaturePass` stays in
  // @astellum/identify but is not exposed here. Kept as a 410 so any stale
  // client gets a clear signal instead of a 404.
  app.post('/api/projects/:slug/identify-ai', (_req, res) => {
    res.status(410).json({ ok: false, error: 'The AI feature pass is retired — B-class features come from the atlas.' });
  });

  app.get('/api/projects/:slug/job', async (req, res) => {
    const slug = req.params.slug;
    const inMem = jobs.get(slug);
    if (inMem) {
      res.json(inMem satisfies JobStatus);
      return;
    }
    try {
      const raw = await readFile(join(projectDir(slug), 'job.json'), 'utf8');
      res.json(JSON.parse(raw) as JobStatus);
    } catch {
      try {
        await access(join(projectDir(slug), 'reading.json'));
        res.json({ state: 'done', stage: 'done' } satisfies JobStatus);
      } catch {
        res.status(404).json({ state: 'failed', error: 'no such job' } satisfies JobStatus);
      }
    }
  });

  app.get('/api/projects/:slug/factsheet', async (req, res) => {
    try {
      const factsheet = await loadFactsheet(req.params.slug);
      res.json({ factsheet } satisfies FactsheetResponse);
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  });

  app.get('/api/projects/:slug/report', async (req, res) => {
    try {
      const report = await loadReport(req.params.slug);
      res.json({ report, imageName: basename(report.image.src) } satisfies ReportResponse);
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  });

  app.post('/api/projects/:slug/report', async (req, res) => {
    try {
      const report = Reading.parse((req.body as SaveRequest).report);
      report.edited_at = new Date().toISOString();
      await writeFile(
        join(projectDir(req.params.slug), 'reading.json'),
        JSON.stringify(report, null, 2) + '\n',
        'utf8',
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  // The other direction: an AI reading the curator is happy with becomes this
  // target's predefined entry, so the kiosk can show it offline later. Without
  // this the predefined library only ever grows by hand; with it, ordinary
  // offsite work fills it as a side effect.
  /**
   * Whether `save-predefined` would overwrite something: this target already
   * has text for this role in the user's library. Asked before saving so the
   * page can say so — the library is shared by every project of the target,
   * and the save is not undoable from here.
   */
  app.get('/api/projects/:slug/predefined-status', async (req, res) => {
    try {
      const asked = typeof req.query.style === 'string' ? req.query.style : undefined;
      const style = isRoleId(asked) ? asked! : defaultRoleId();
      const reading = await loadReport(req.params.slug);
      const factsheet = await loadFactsheet(req.params.slug).catch(() => null);
      const primary = factsheet?.objects.find((o) => o.tier !== 'B');
      const ids = [
        ...(primary ? [...primary.names, ...primary.designations] : []),
        reading.object.name.en,
        ...reading.object.aliases,
      ].filter(Boolean);
      const library = await loadReadingLibrary(userReadingsPath());
      const found = library ? findPredefined(library, ids) : undefined;
      res.json({ ok: true, exists: !!found?.styles[style], updatedAt: found?.updated_at });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  app.post('/api/projects/:slug/save-predefined', async (req, res) => {
    try {
      // The style key a reading is promoted under is the role it was written
      // for. Falls back to the default role rather than `reading.style`: a
      // request that names no role still has to land somewhere a role reads.
      const asked = ((req.body ?? {}) as { style?: string }).style;
      const style = isRoleId(asked) ? asked! : defaultRoleId();
      const reading = await loadReport(req.params.slug);
      const factsheet = await loadFactsheet(req.params.slug).catch(() => null);
      if (!factsheet) throw new Error('No factsheet for this project — re-identify it first.');

      // Text attaches to atlas annotation ids, which is what the kiosk matches
      // on. A feature drawn from a catalogue object has no annotation to hang
      // on, so it is skipped rather than saved under an id that means nothing.
      const byObj = new Map(factsheet.objects.map((o) => [o.id, o]));
      const features = reading.features
        .map((f) => {
          const obj = f.fact_ref ? byObj.get(f.fact_ref.object_id) : undefined;
          const id = obj?.atlas_annotation_id;
          return id && (f.explanation.zh.trim() || f.explanation.en.trim())
            ? { annotation_id: id, explanation: f.explanation, physics: f.physics, interesting: f.interesting }
            : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x);

      const primary = factsheet.objects.find((o) => o.tier !== 'B');
      const entry = {
        schema_version: 1 as const,
        primary_id: primary?.names[0] ?? reading.object.name.en,
        aliases: [...new Set([...(primary?.designations ?? []), ...reading.object.aliases])],
        styles: {
          [style]: {
            narrative: reading.narrative,
            fun_facts: reading.extra_facts,
            features,
          },
        },
        source: 'ai_approved' as const,
        updated_at: new Date().toISOString(),
      };

      const path = userReadingsPath();
      const existing =
        (await loadReadingLibrary(path)) ?? { schema_version: 1 as const, entries: [] };
      const merged = mergeLibraries([
        existing,
        PredefinedLibrary.parse({ schema_version: 1, entries: [entry] }),
      ]);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(merged, null, 2) + '\n', 'utf8');
      res.json({ ok: true, path, target: entry.primary_id, style, features: features.length });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  // Hand-drawn features → the user's own atlas overlay, projected back to sky
  // coordinates. Without this a curator's tweak dies with the project; with it,
  // the next image of the same target inherits the work.
  //
  // Saving again replaces what this project saved before rather than adding a
  // second copy: every annotation's id says which project and which feature
  // it came from (`anno_user_<slug>_<feature>`), so the earlier save can be
  // found and taken out first — including features deleted since. The one
  // exception is an annotation this project now reads *back* from the atlas
  // (after a re-identify): it is no longer a drawing here but an atlas
  // feature, so it is not in `fresh`, and dropping it would delete the work.
  const savedPrefix = (slug: string): string => `anno_user_${slug}_`;

  const planAnnotationSave = async (slug: string) => {
    const reading = await loadReport(slug);
    const factsheet = await loadFactsheet(slug);
    const wcs = factsheet.solve.wcs;
    if (!wcs) throw new Error('This project has no WCS — annotations can only be stored by sky position.');

    const primary = factsheet.objects.find((o) => o.tier !== 'B');
    if (!primary) throw new Error('No identified object to attach annotations to.');

    const byObj = new Map(factsheet.objects.map((o) => [o.id, o]));
    // Only what a person actually drew here. Two things are deliberately
    // excluded: atlas-sourced features (re-saving them duplicates the
    // baseline) and catalogued A-class objects — those come back from a
    // catalogue query on any future image, so storing them as hand
    // annotations would just pollute the overlay with things it doesn't own.
    const fresh = reading.features.filter((f) => {
      if (!f.fact_ref) return true; // added by hand in the editor
      const obj = byObj.get(f.fact_ref.object_id);
      return !!obj && obj.tier === 'B' && obj.detection_source !== 'atlas';
    });

    const toWorld = (p: [number, number]): [number, number] => {
      const [ra, dec] = pixelToWorld(wcs, p[0], p[1]);
      return [ra, dec];
    };
    const annotations = fresh
      .map((f) => {
        const kind = f.shape === 'polyline' ? 'polyline' : f.polygon?.length ? 'polygon' : 'point';
        const verts =
          kind === 'point'
            ? [toWorld([f.circle.cx, f.circle.cy])]
            : (f.polygon ?? []).map(toWorld);
        if (!verts.length) return null;
        const radiusArcmin =
          kind === 'point' && factsheet.solve.pixscale_arcsec
            ? (f.circle.r * factsheet.solve.pixscale_arcsec) / 60
            : undefined;
        return {
          id: `${savedPrefix(slug)}${f.id}`,
          // The atlas drawing vocabulary, not the palette key — recovered from
          // the fact object when there is one, else a neutral region callout.
          feature_type: atlasTypeFor(
            (f.fact_ref ? byObj.get(f.fact_ref.object_id) : undefined)?.feature_type,
          ),
          geometry: {
            type: kind,
            vertices: verts,
            ...(radiusArcmin ? { radius_arcmin: radiusArcmin } : {}),
          },
          label: f.label,
          ...(f.explanation.zh || f.explanation.en ? { note: f.explanation } : {}),
        };
      })
      .filter((a): a is NonNullable<typeof a> => !!a);

    const inUseHere = new Set(
      factsheet.objects.map((o) => o.atlas_annotation_id).filter((x): x is string => !!x),
    );
    const isEarlierSave = (id: string | undefined): boolean =>
      !!id && id.startsWith(savedPrefix(slug)) && !inUseHere.has(id);

    const path = userRegistryPath();
    const existing = (await loadRegistry(path)) ?? { schema_version: 1 as const, objects: [] };
    const replaced = existing.objects.reduce(
      (n, o) => n + o.annotations.filter((a) => isEarlierSave(a.id)).length,
      0,
    );
    return { reading, primary, annotations, existing, isEarlierSave, replaced, path };
  };

  /** How many annotations a save would replace — asked first, so the page can say. */
  app.get('/api/projects/:slug/annotations-status', async (req, res) => {
    try {
      const { replaced } = await planAnnotationSave(req.params.slug);
      res.json({ ok: true, replaced });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  app.post('/api/projects/:slug/save-annotations', async (req, res) => {
    try {
      const { reading, primary, annotations, existing, isEarlierSave, replaced, path } =
        await planAnnotationSave(req.params.slug);

      if (!annotations.length && !replaced) {
        res.json({ ok: true, saved: 0, note: 'Nothing new to save — every feature already comes from the atlas.' });
        return;
      }

      const kept = {
        ...existing,
        objects: existing.objects.map((o) => ({
          ...o,
          annotations: o.annotations.filter((a) => !isEarlierSave(a.id)),
        })),
      };
      const merged = mergeRegistries([
        kept,
        Registry.parse({
          schema_version: 1,
          objects: [
            {
              primary_id: primary.names[0] ?? reading.object.name.en,
              aliases: [...new Set([...primary.designations, ...reading.object.aliases])],
              annotations,
            },
          ],
        }),
      ]);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(merged, null, 2) + '\n', 'utf8');
      res.json({ ok: true, saved: annotations.length, replaced, path, target: primary.names[0] });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  app.get('/api/projects/:slug/image', async (req, res) => {
    try {
      const report = await loadReport(req.params.slug);
      const file = join(projectDir(req.params.slug), basename(report.image.src));
      if (!(await exists(file))) {
        res.status(404).type('text').send('No image for this project');
        return;
      }
      res.sendFile(file);
    } catch (e) {
      res.status(404).send((e as Error).message);
    }
  });

  app.post('/api/projects/:slug/export', async (req, res) => {
    try {
      const slug = req.params.slug;
      const { format, layout, lang } = req.body as ExportRequest;
      const stored = await loadReport(slug);
      // Every renderer writes in `display_language`, so asking for the page's
      // language is a matter of setting it for this export only.
      const report = lang === 'zh' || lang === 'en' ? { ...stored, display_language: lang } : stored;
      const dir = projectDir(slug);
      const imagePath = join(dir, report.image.src);
      const want = (f: ExportFormat): boolean => format === 'all' || format === f;
      const stem = objectStem(report.object.name.en || report.object.name.zh);
      const files: ExportFile[] = [];

      // Always carry the full reading.json so the gallery site has the
      // structured metadata (color_key per feature, object info, labels)
      // alongside the rendered image instead of guessing from pixels.
      files.push({
        name: `${stem}.json`,
        base64: Buffer.from(JSON.stringify(report, null, 2), 'utf8').toString('base64'),
        contentType: 'application/json',
      });

      if (want('annotated')) {
        const buf = await renderAnnotatedBuffer({ report, imagePath, format: 'jpeg' });
        files.push({
          name: `${stem}_annotated.jpg`,
          base64: buf.toString('base64'),
          contentType: 'image/jpeg',
        });
      }
      let dataUri = '';
      if (want('poster')) {
        const mime = extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
        dataUri = `data:${mime};base64,${(await readFile(imagePath)).toString('base64')}`;
      }
      if (want('poster')) {
        const posters = await renderPosterBuffers({
          report,
          imageDataUri: dataUri,
          layouts: layout ? [layout] : undefined,
        });
        for (const p of posters) {
          files.push({
            name: `${stem}_${p.name}`,
            base64: p.buffer.toString('base64'),
            contentType: 'image/png',
          });
        }
      }
      res.json({ ok: true, files });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  app.get('/api/projects/:slug/files/:name', (req, res) => {
    const { slug, name } = req.params;
    if (!SLUG_RE.test(slug) || !SLUG_RE.test(name)) {
      res.status(400).end();
      return;
    }
    res.sendFile(join(workspace, slug, name));
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
