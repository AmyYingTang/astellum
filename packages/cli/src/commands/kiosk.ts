import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';
import sharp from 'sharp';
import {
  identify,
  createConfiguredSolveClient,
  createCatalogFromSources,
  defaultRegistryPaths,
  offlineCatalogStatus,
  isOfflineReady,
  isFitsPath,
  fitsToPng,
} from '@astellum/identify';
import {
  readingFromPredefined,
  tailorReading,
  loadReadingLibraries,
  defaultReadingsPaths,
  coverageSummary,
  type RunClaudeOptions,
} from '@astellum/reader';
import {
  generateKioskHtml,
  type KioskPicker,
  type KioskRole,
  type KioskState,
} from '@astellum/renderer';
import { loadConfig } from '@astellum/schema/node';
import {
  FactSheet,
  defaultRoleId,
  isRoleId,
  rolePresets,
  type KioskConfig,
  type Reading,
} from '@astellum/schema';
import { TOOL_VERSION } from '../version.js';

/**
 * One command, one frame: image in, fullscreen touchable page out.
 *
 * This is the onsite flow. Everything it needs is decided ahead of time by the
 * profile, so on the night there is nothing to configure — the operator picks a
 * file (or names the target) and a screen appears.
 *
 * It never leaves the audience with a spinner or an error page. If the solve
 * fails, or the target isn't in the atlas, or nobody has written its reading
 * yet, it says so in one plain sentence and still shows the picture with
 * whatever is genuinely known.
 */

export interface KioskArgs {
  image: string;
  target?: string;
  out?: string;
  lang?: string;
  style?: string;
  /**
   * Who this frame is for — a role id, which is also a style key.
   *
   * One answer serves both modes: offline it selects the pre-written text,
   * on the night it becomes the sentence the model is given about its reader.
   */
  role?: string;
  /**
   * Write for the audience in front of you instead of reading what a curator
   * wrote. `undefined` follows `kiosk.readingSource`, which is `predefined`
   * unless a deployment has turned this on.
   */
  source?: 'predefined' | 'ai';
  /** Audience instruction for the `ai` path, already phrased. Overrides what
   *  `role` would have said, for a caller that has its own wording. */
  tone?: string;
  /** Model runner, so this path can be exercised without a logged-in CLI. */
  runner?: (o: RunClaudeOptions) => Promise<string>;
  /** Open the finished page in a browser. Default true — the command exists to
   *  put something on a screen, and another tool invoking it shouldn't have to
   *  know how. */
  open?: boolean;
  /** Back link and picker for the generated page. Only the server passes this:
   *  the page this command writes is opened as a file:// URL with nothing
   *  serving it, so a picker would have nowhere to POST and a relative back
   *  link would point into the filesystem. */
  chrome?: { hubUrl?: string; picker?: KioskPicker };
}

/** Open a file in the platform browser, best-effort. */
async function openInBrowser(target: string): Promise<void> {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const { execFile } = await import('node:child_process');
    execFile(cmd, [target], () => {
      /* a headless box has no browser; the path is printed either way */
    });
  } catch {
    // non-fatal
  }
}

/** What we could not show, and why — the operator's side of the screen. */
function reportDropped(sheet: FactSheet, reading: Reading): void {
  const drawn = new Set(reading.features.map((f) => f.fact_ref?.object_id));
  const dropped = sheet.objects.filter((o) => !drawn.has(o.id));
  if (dropped.length) {
    console.log(`\n  Not shown (${dropped.length}):`);
    for (const o of dropped) {
      const why = !o.coord.pixel
        ? 'no position on this frame'
        : o.tier === 'B'
          ? 'B-class feature without atlas backing'
          : 'below the prominence threshold';
      console.log(`    · ${o.names[0] ?? o.id} — ${why}`);
    }
  }
  for (const w of sheet.warnings) console.log(`  ⚠ ${w}`);
}

export interface KioskResult {
  htmlPath: string;
  state: KioskState;
  objectName: string;
  /** Per-layer counts, so a caller can report coverage without re-deriving it. */
  coverage: ReturnType<typeof coverageSummary>;
  matchedTarget: string | null;
}

/** The roles, as the page needs them: an id and both labels. */
function kioskRoles(): KioskRole[] {
  return rolePresets().map((r) => ({ id: r.id, labelZh: r.labelZh, labelEn: r.labelEn }));
}

/**
 * What a frame directory remembers about itself.
 *
 * Only `role` could be recovered from `reading.json`; `source` could not, and
 * it is the one the role switch turns on. A frame the model wrote has no
 * pre-written text to switch to, and offering the switch anyway would replace
 * its prose with the library's at a touch, in front of a room.
 */
interface FrameRecord {
  source: 'predefined' | 'ai';
  role: string;
}

const FRAME_FILE = 'frame.json';

/** How this frame was written. Absent for a directory an older version wrote. */
export async function loadFrameRecord(dir: string): Promise<FrameRecord | null> {
  try {
    const raw = JSON.parse(await readFile(join(dir, FRAME_FILE), 'utf8')) as Partial<FrameRecord>;
    if (raw.source !== 'predefined' && raw.source !== 'ai') return null;
    return { source: raw.source, role: typeof raw.role === 'string' ? raw.role : defaultRoleId() };
  } catch {
    return null;
  }
}

/** Build one frame. Returns null when nothing could be identified — the one
 *  case where no page is produced, because identity is never fabricated. */
export async function runKiosk(args: KioskArgs): Promise<KioskResult | null> {
  const p = loadConfig();
  const lang = args.lang === 'en' ? 'en' : 'zh';
  const role = isRoleId(args.role) ? args.role! : defaultRoleId();
  // The role is the style key. `args.style` stays ahead of it for the CLI,
  // where somebody may have written text under a key of their own.
  const style = args.style ?? (isRoleId(args.role) ? role : p.reading.style);
  // What the model is told about its reader, when it is the model writing.
  const tone = args.tone ?? rolePresets().find((r) => r.id === role)?.[lang === 'en' ? 'textEn' : 'textZh'];
  // A kiosk reads from the library by default — it has to work unplugged. A
  // deployment can ask for the words to be written on the night instead; the
  // structure is still grounded either way, the model only rewrites prose.
  const textSource = args.source ?? p.kiosk.readingSource;
  console.log(
    `solve=${p.solve.mode}, catalog=${p.catalog.sources.join('+')}, ` +
      (textSource === 'ai' ? `reading=ai:${role}` : `reading=predefined:${style}`),
  );

  // Fail loudly *here*, with the audience not yet watching, rather than halfway
  // through the first frame of the night.
  if (p.catalog.sources.includes('offline')) {
    const status = await offlineCatalogStatus();
    if (!isOfflineReady(status)) {
      const missing = status.filter((s) => !s.present).map((s) => s.key);
      console.log(`  ⚠ offline catalog pack incomplete (missing: ${missing.join(', ')}).`);
      console.log('    Run `astellum prefetch` while you still have a network.');
    }
  }

  const source = resolve(args.image);
  // Not `out/` — that is the studio's workspace, and a kiosk run leaves a
  // reading.json with no image beside it, which lists there as a project whose
  // thumbnail cannot load. Kiosk output is a frame to show, not a project.
  const outDir = resolve(args.out ?? join('out', 'kiosk', basename(source, extname(source))));
  await mkdir(outDir, { recursive: true });

  // A stacker writes FITS, and nothing downstream can open one. Convert at the
  // door, with a display stretch — a linear master is nearly black otherwise,
  // and the solver needs to see stars as much as the audience does.
  let imagePath = source;
  let hintFromFile: string | undefined;
  if (isFitsPath(source)) {
    imagePath = join(outDir, 'image.png');
    const f = await fitsToPng(source, imagePath);
    hintFromFile = f.objectName;
    console.log(
      `  FITS ${f.width}×${f.height} → stretched PNG` +
        `${f.objectName ? `, OBJECT="${f.objectName}"` : ''}` +
        `${f.bayerPattern ? ` (Bayer ${f.bayerPattern}: shown as mono, not demosaiced)` : ''}`,
    );
  }

  const meta = await sharp(imagePath).metadata();
  if (!meta.width || !meta.height) throw new Error(`Could not read image: ${imagePath}`);

  const t0 = Date.now();
  const sheet = await identify(
    {
      imagePath,
      width: meta.width,
      height: meta.height,
      imageSrc: basename(imagePath),
      // A FITS header's OBJECT is what the capture program was pointed at —
      // as good a target name as the operator would have typed.
      targetName: args.target ?? hintFromFile,
      registryPaths: defaultRegistryPaths(),
    },
    {
      solve: createConfiguredSolveClient({
        apiKey: process.env.ASTROMETRY_API_KEY,
        mode: p.solve.mode,
        cache: p.solve.cache,
        fovLowDeg: p.solve.fovLowDeg,
        fovHighDeg: p.solve.fovHighDeg,
      }),
      catalog: createCatalogFromSources(p.catalog.sources, { snapshot: p.catalog.snapshot }),
    },
  );
  await writeFile(join(outDir, 'factsheet.json'), JSON.stringify(sheet, null, 2) + '\n', 'utf8');

  const trimmed = trimForKiosk(sheet, p.kiosk);

  const solved = sheet.solve.status === 'solved';
  const hasObjects = trimmed.objects.some((o) => o.tier !== 'B');
  if (!hasObjects) {
    console.log(`\n  Nothing identified (solve=${sheet.solve.status}).`);
    for (const w of sheet.warnings) console.log(`  ⚠ ${w}`);
    console.log('  No frame produced — identity is never fabricated.');
    return null;
  }

  const library = await loadReadingLibraries(defaultReadingsPaths());
  const predefined = readingFromPredefined(trimmed, library, {
    toolVersion: TOOL_VERSION,
    displayLanguage: lang,
    imageSrc: basename(imagePath),
    style,
    fallback: p.reading.fallback,
  });
  const coverage = predefined.coverage;
  let reading = predefined.reading;

  // The grounded reading above is the floor, not the draft: if the model is
  // unreachable — the case this whole surface is built around — the frame goes
  // up with the curator's words rather than not at all.
  if (textSource === 'ai') {
    try {
      reading = await tailorReading(reading, {
        imagePath,
        tone,
        factsheet: trimmed,
        model: p.reading.model ?? undefined,
        runner: args.runner,
      });
      console.log(`  text: written for this audience (${role})`);
    } catch (e) {
      console.log(`  ⚠ could not write on the night (${(e as Error).message})`);
      console.log('    Showing the predefined reading instead.');
    }
  }

  const bClass = trimmed.objects.filter((o) => o.tier === 'B').length;
  const state: KioskState = !solved
    ? 'unsolved'
    : bClass === 0
      ? 'no_annotations'
      : coverage.matchedTarget
        ? 'ok'
        : 'generic_only';

  const buf = await readFile(imagePath);
  const mime = extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  const html = generateKioskHtml(reading, {
    imageDataUri: `data:${mime};base64,${buf.toString('base64')}`,
    textSources: Object.fromEntries(coverage.sources),
    state,
    // Switching role means re-reading the library, which the server can do in
    // a second. It means asking the model again when the words were written on
    // the night, which it cannot — so there is nothing to offer there.
    roles: p.kiosk.switchableStyle && textSource !== 'ai' ? kioskRoles() : undefined,
    currentRole: role,
    idleResetSec: p.kiosk.idleResetSec,
    hubUrl: args.chrome?.hubUrl,
    picker: args.chrome?.picker,
  });
  const htmlPath = join(outDir, 'kiosk.html');
  await writeFile(htmlPath, html, 'utf8');
  await writeFile(join(outDir, 'reading.json'), JSON.stringify(reading, null, 2) + '\n', 'utf8');
  await writeFile(
    join(outDir, FRAME_FILE),
    JSON.stringify({ source: textSource, role } satisfies FrameRecord, null, 2) + '\n',
    'utf8',
  );

  const c = coverageSummary(coverage);
  console.log(`\n  ${reading.object.name.zh} / ${reading.object.name.en} — ${state}`);
  console.log(
    `  text: target=${c.target} note=${c.annotation_note} generic=${c.feature_generic} facts=${c.facts}` +
      `${coverage.matchedTarget ? ` (matched ${coverage.matchedTarget})` : ' (no predefined entry)'}`,
  );
  reportDropped(trimmed, reading);
  console.log(`\n  ${((Date.now() - t0) / 1000).toFixed(1)}s → ${htmlPath}`);
  if (args.open !== false) await openInBrowser(htmlPath);
  return {
    htmlPath,
    state,
    objectName: reading.object.name[lang],
    coverage: c,
    matchedTarget: coverage.matchedTarget,
  };
}

/**
 * Precision over recall onsite: drop the incidental context objects and any
 * B-class feature a human hasn't approved in the atlas.
 *
 * Shared with the re-render below, so a frame that comes back in another style
 * is the same frame — same features, same numbers, different words.
 */
export function trimForKiosk(sheet: FactSheet, k: KioskConfig): FactSheet {
  let objects = sheet.objects;
  if (k.dropContext) objects = objects.filter((o) => o.role !== 'context' || o.tier === 'B');
  if (k.requireAtlasForB) {
    objects = objects.filter((o) => o.tier !== 'B' || o.detection_source === 'atlas');
  }
  if (k.maxFeatures) {
    const a = objects.filter((o) => o.tier !== 'B');
    const b = objects.filter((o) => o.tier === 'B').slice(0, k.maxFeatures);
    objects = [...a, ...b];
  }
  return { ...sheet, objects };
}

/**
 * The same frame, read for a different role.
 *
 * The expensive half of a frame — the solve and the catalogue query — is
 * already on disk as `factsheet.json`, so a school group and the public
 * session after it are a second apart, not a minute. Nothing about the picture
 * or the marks changes; only which layer the words come from.
 *
 * Returns null when this frame has nothing to re-read from, which is what a
 * directory written by an older version looks like.
 */
export async function restyleFrame(opts: {
  dir: string;
  /** The role to read in — a style key. */
  role: string;
  lang: 'zh' | 'en';
  chrome?: { hubUrl?: string; picker?: KioskPicker };
}): Promise<string | null> {
  const p = loadConfig();
  let sheet: FactSheet;
  try {
    sheet = FactSheet.parse(JSON.parse(await readFile(join(opts.dir, 'factsheet.json'), 'utf8')));
  } catch {
    return null;
  }
  const trimmed = trimForKiosk(sheet, p.kiosk);
  const library = await loadReadingLibraries(defaultReadingsPaths());
  const { reading, coverage } = readingFromPredefined(trimmed, library, {
    toolVersion: TOOL_VERSION,
    displayLanguage: opts.lang,
    imageSrc: sheet.image.src,
    style: opts.role,
    fallback: p.reading.fallback,
  });

  const bClass = trimmed.objects.filter((o) => o.tier === 'B').length;
  const state: KioskState =
    sheet.solve.status !== 'solved'
      ? 'unsolved'
      : bClass === 0
        ? 'no_annotations'
        : coverage.matchedTarget
          ? 'ok'
          : 'generic_only';

  const imagePath = join(opts.dir, reading.image.src);
  const buf = await readFile(imagePath);
  const mime = extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  const html = generateKioskHtml(reading, {
    imageDataUri: `data:${mime};base64,${buf.toString('base64')}`,
    textSources: Object.fromEntries(coverage.sources),
    state,
    roles: p.kiosk.switchableStyle ? kioskRoles() : undefined,
    currentRole: opts.role,
    idleResetSec: p.kiosk.idleResetSec,
    hubUrl: opts.chrome?.hubUrl,
    picker: opts.chrome?.picker,
  });
  // The frame on disk becomes the re-read one: the next plain visit to this
  // id should show what is on the screen, not what it said before — and the
  // role it is now in, so the switch opens where the operator left it.
  await writeFile(join(opts.dir, 'kiosk.html'), html, 'utf8');
  await writeFile(join(opts.dir, 'reading.json'), JSON.stringify(reading, null, 2) + '\n', 'utf8');
  await writeFile(
    join(opts.dir, FRAME_FILE),
    JSON.stringify({ source: 'predefined', role: opts.role } satisfies FrameRecord, null, 2) + '\n',
    'utf8',
  );
  return html;
}


/**
 * Every style key anybody has written for, anywhere in the merged library.
 *
 * No longer what either switch offers — both offer the roles, which exist
 * whether or not a curator has written for them. Kept because it is the honest
 * answer to "what is actually written here", which the atlas reports.
 */
export function styleNames(library: { entries: { styles: Record<string, unknown> }[] }): string[] {
  const out = new Set<string>();
  for (const e of library.entries) for (const s of Object.keys(e.styles)) out.add(s);
  return [...out];
}

const IMAGE_RE = /\.(jpe?g|png|tiff?|fits?|fts)$/i;

/**
 * Guess the target from a filename, which is how stacking software names its
 * output: "M42_300s_stack.tif" → "M42". A guess, not a claim — it is passed as
 * a hint, and identification still has to find that object in the field.
 */
export function targetFromFilename(file: string): string | undefined {
  const stem = basename(file, extname(file));
  const m =
    /\b(M\s?\d{1,3}|NGC\s?\d{1,4}[A-Za-z]?|IC\s?\d{1,4}[A-Za-z]?|Sh\s?2-\d{1,3}|B\s?\d{1,3}|LDN\s?\d{1,4}|vdB\s?\d{1,3}|Ced\s?\d{1,3}[A-Za-z]?|RCW\s?\d{1,3}|Abell\s?\d{1,3})\b/i.exec(
      // Underscores separate fields; hyphens do NOT — they're part of the
      // designation itself in "Sh2-155", "NGC 4038/4039", "SNR G260.4-03.4".
      stem.replace(/_+/g, ' '),
    );
  return m ? m[1]!.replace(/\s+/g, ' ').trim() : undefined;
}

/** Resolve once the file has stopped growing — a stack is still being written. */
async function waitUntilStable(path: string, quietMs = 1500, timeoutMs = 120_000): Promise<boolean> {
  const started = Date.now();
  let last = -1;
  for (;;) {
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return false; // vanished again
    }
    if (size > 0 && size === last) return true;
    last = size;
    if (Date.now() - started > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, quietMs));
  }
}

export interface WatchArgs extends Omit<KioskArgs, 'image'> {
  dir: string;
}

/**
 * Watch a folder and build a frame for each new image — the hands-off mode for
 * a stacking program that writes its result to disk.
 *
 * Deliberately simple: it reacts to files, it does not manage a queue. One image
 * at a time, the newest wins, and a failure logs and waits for the next one
 * rather than tearing down the watcher mid-session.
 */
export async function watchKiosk(args: WatchArgs): Promise<void> {
  const dir = resolve(args.dir);
  console.log(`Watching ${dir} for new images. Ctrl+C to stop.\n`);
  const seen = new Set<string>();
  try {
    for (const f of await readdir(dir)) if (IMAGE_RE.test(f)) seen.add(f);
    console.log(`  (ignoring ${seen.size} file(s) already here)`);
  } catch (e) {
    throw new Error(`Cannot watch ${dir}: ${(e as Error).message}`);
  }

  let busy = false;
  const handle = async (name: string): Promise<void> => {
    if (busy || seen.has(name) || !IMAGE_RE.test(name)) return;
    seen.add(name);
    busy = true;
    const path = join(dir, name);
    try {
      console.log(`\n→ ${name}`);
      if (!(await waitUntilStable(path))) {
        console.log('  still being written after 2 min — skipped.');
        return;
      }
      const target = args.target ?? targetFromFilename(name);
      if (target) console.log(`  target from filename: ${target}`);
      await runKiosk({ ...args, image: path, target });
    } catch (e) {
      // One bad frame must not end the night.
      console.log(`  failed: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  };

  const watcher = watch(dir, (_event, filename) => {
    if (filename) void handle(filename.toString());
  });
  await new Promise<void>((resolve_) => {
    process.on('SIGINT', () => {
      watcher.close();
      console.log('\nStopped watching.');
      resolve_();
    });
  });
}
