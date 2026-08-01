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
} from '@astrolens/identify';
import {
  readingFromPredefined,
  loadReadingLibraries,
  defaultReadingsPaths,
  coverageSummary,
} from '@astrolens/reader';
import { generateKioskHtml, type KioskState } from '@astrolens/renderer';
import { loadConfig } from '@astrolens/schema/node';
import type { FactSheet, Reading } from '@astrolens/schema';
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
  profile?: string;
  open?: boolean;
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

export async function runKiosk(args: KioskArgs): Promise<void> {
  const cfg = loadConfig({ profile: args.profile });
  const p = cfg.profile;
  const lang = args.lang === 'en' ? 'en' : 'zh';
  const style = args.style ?? p.reading.style;
  console.log(
    `Profile "${cfg.profileName}": solve=${p.solve.mode}, catalog=${p.catalog.sources.join('+')}, ` +
      `reading=${p.reading.mode}${p.reading.mode === 'predefined' ? `:${style}` : ''}`,
  );

  // Fail loudly *here*, with the audience not yet watching, rather than halfway
  // through the first frame of the night.
  if (p.catalog.sources.includes('offline')) {
    const status = await offlineCatalogStatus();
    if (!isOfflineReady(status)) {
      const missing = status.filter((s) => !s.present).map((s) => s.key);
      console.log(`  ⚠ offline catalog pack incomplete (missing: ${missing.join(', ')}).`);
      console.log('    Run `astrolens prefetch` while you still have a network.');
    }
  }

  const imagePath = resolve(args.image);
  const meta = await sharp(imagePath).metadata();
  if (!meta.width || !meta.height) throw new Error(`Could not read image: ${imagePath}`);
  const outDir = resolve(args.out ?? join('out', basename(imagePath, extname(imagePath)) + '-kiosk'));
  await mkdir(outDir, { recursive: true });

  const t0 = Date.now();
  const sheet = await identify(
    {
      imagePath,
      width: meta.width,
      height: meta.height,
      imageSrc: basename(imagePath),
      targetName: args.target,
      registryPaths: defaultRegistryPaths(),
      ...(p.select.nebulaMinArcmin ? { nebulaMinArcmin: p.select.nebulaMinArcmin } : {}),
      ...(p.select.galaxyMinArcmin ? { galaxyMinArcmin: p.select.galaxyMinArcmin } : {}),
    },
    {
      solve: createConfiguredSolveClient({
        apiKey: process.env.ASTROMETRY_API_KEY,
        mode: p.solve.mode,
        cache: p.solve.cache,
      }),
      catalog: createCatalogFromSources(p.catalog.sources, { snapshot: p.catalog.snapshot }),
    },
  );
  await writeFile(join(outDir, 'factsheet.json'), JSON.stringify(sheet, null, 2) + '\n', 'utf8');

  // Precision over recall onsite: drop the incidental context objects and any
  // B-class feature a human hasn't approved in the atlas.
  let objects = sheet.objects;
  if (p.select.dropContext) objects = objects.filter((o) => o.role !== 'context' || o.tier === 'B');
  if (p.select.requireAtlasForB) {
    objects = objects.filter((o) => o.tier !== 'B' || o.detection_source === 'atlas');
  }
  if (p.select.maxFeatures) {
    const a = objects.filter((o) => o.tier !== 'B');
    const b = objects.filter((o) => o.tier === 'B').slice(0, p.select.maxFeatures);
    objects = [...a, ...b];
  }
  const trimmed: FactSheet = { ...sheet, objects };

  const solved = sheet.solve.status === 'solved';
  const hasObjects = trimmed.objects.some((o) => o.tier !== 'B');
  if (!hasObjects) {
    console.log(`\n  Nothing identified (solve=${sheet.solve.status}).`);
    for (const w of sheet.warnings) console.log(`  ⚠ ${w}`);
    console.log('  No frame produced — identity is never fabricated.');
    return;
  }

  const library = await loadReadingLibraries(defaultReadingsPaths());
  const { reading, coverage } = readingFromPredefined(trimmed, library, {
    toolVersion: TOOL_VERSION,
    displayLanguage: lang,
    imageSrc: basename(imagePath),
    style,
    fallback: p.reading.fallback,
  });

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
    styles: library ? styleNames(library) : undefined,
    currentStyle: coverage.style ?? style,
    idleResetSec: p.flow.idleResetSec,
  });
  const htmlPath = join(outDir, 'kiosk.html');
  await writeFile(htmlPath, html, 'utf8');
  await writeFile(join(outDir, 'reading.json'), JSON.stringify(reading, null, 2) + '\n', 'utf8');

  const c = coverageSummary(coverage);
  console.log(`\n  ${reading.object.name.zh} / ${reading.object.name.en} — ${state}`);
  console.log(
    `  text: target=${c.target} note=${c.annotation_note} generic=${c.feature_generic} facts=${c.facts}` +
      `${coverage.matchedTarget ? ` (matched ${coverage.matchedTarget})` : ' (no predefined entry)'}`,
  );
  reportDropped(trimmed, reading);
  console.log(`\n  ${((Date.now() - t0) / 1000).toFixed(1)}s → ${htmlPath}`);
}

function styleNames(library: { entries: { styles: Record<string, unknown> }[] }): string[] {
  const out = new Set<string>();
  for (const e of library.entries) for (const s of Object.keys(e.styles)) out.add(s);
  return [...out];
}

const IMAGE_RE = /\.(jpe?g|png|tiff?|fits?)$/i;

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
