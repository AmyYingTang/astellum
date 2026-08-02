import {
  prefetchOfflineCatalogs,
  offlineCatalogStatus,
  isOfflineReady,
  defaultOfflineDir,
  catalogCacheStatus,
  prewarmTargets,
  createCatalogFromSources,
  loadRegistries,
  defaultRegistryPaths,
  bandsForField,
  indexUrls,
  isComplete,
} from '@astrolens/identify';
import { loadConfig } from '@astrolens/schema/node';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Build the offline star-table pack, or report on it.
 *
 * This is the "get ready before you leave" step: run it once with a network and
 * the machine can identify targets with the network unplugged. Reporting is
 * separate (`--check`) so an operator can confirm readiness on a dark field
 * without touching anything.
 */

export interface PrefetchArgs {
  dir?: string;
  check?: boolean;
  /** Also warm the online-answer snapshot for every annotated target. */
  targets?: boolean;
  /** Download plate-solving indexes down to this field width, in arcminutes. */
  indexes?: number;
  /** Where index files go (must be on astrometry.cfg's add_path). */
  indexDir?: string;
}

const kb = (b?: number): string => (b == null ? '—' : `${(b / 1024).toFixed(1)} KB`);

export async function prefetchCatalogs(args: PrefetchArgs = {}): Promise<void> {
  const dir = args.dir ?? defaultOfflineDir();

  if (args.check) {
    const status = await offlineCatalogStatus(dir);
    console.log(`Offline catalog pack: ${dir}\n`);
    for (const s of status) {
      const mark = s.present ? '✓' : '✗';
      const detail = s.present ? `${s.rows != null ? `${s.rows} rows, ` : ''}${kb(s.bytes)}` : 'MISSING';
      console.log(`  ${mark} ${s.key.padEnd(12)} ${detail}`);
    }
    const total = status.reduce((n, s) => n + (s.bytes ?? 0), 0);
    console.log(`\n  total ${(total / 1024 / 1024).toFixed(2)} MB`);

    const snap = await catalogCacheStatus();
    console.log(
      `\nOnline-answer snapshot: ${snap.entries} field(s), ${(snap.bytes / 1024).toFixed(0)} KB` +
        `${snap.entries ? '' : ' — none yet (astrolens prefetch --targets)'}`,
    );

    const cfg = loadConfig();
    const offline = cfg.catalog.sources.includes('offline');
    console.log(
      `\nsolve=${cfg.solve.mode}, catalog=${cfg.catalog.sources.join('+')}, ` +
        `reading=${cfg.reading.mode}`,
    );
    if (isOfflineReady(status)) {
      console.log('Ready to run with the network unplugged.');
    } else {
      console.log('NOT ready — run `astrolens prefetch` while you still have a network.');
      if (offline) process.exitCode = 1; // the active profile depends on it
    }
    return;
  }

  if (args.indexes) {
    // The only large download here, and its size is set entirely by the
    // narrowest field you need to solve — so ask, rather than guess.
    const bands = bandsForField(args.indexes);
    const files = indexUrls(bands);
    const mb = files.reduce((n, f) => n + f.mb, 0);
    const dir = args.indexDir ?? join(homedir(), 'astrometry-indexes');
    console.log(
      `Plate-solving indexes for fields down to ${args.indexes}′:\n` +
        `  bands ${bands[bands.length - 1]!.scale}–${bands[0]!.scale}, ` +
        `${files.length} files, about ${mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb.toFixed(0) + ' MB'}\n` +
        `  → ${dir}\n`,
    );
    await mkdir(dir, { recursive: true });
    let got = 0;
    let skipped = 0;
    const failed: string[] = [];
    for (const [i, f] of files.entries()) {
      const dest = join(dir, f.file);
      // Resume-friendly, and it checks the size against the server rather than
      // trusting that any non-empty file is finished — a truncated index is
      // indistinguishable from a complete one by existence alone.
      if (await isComplete(dest, f.url)) {
        skipped += 1;
        continue;
      }
      process.stdout.write(`  [${i + 1}/${files.length}] ${f.file} … `);
      try {
        const res = await fetch(f.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await writeFile(dest, Buffer.from(await res.arrayBuffer()));
        const { size } = await stat(dest);
        console.log(`${(size / 1048576).toFixed(1)} MB`);
        got += 1;
      } catch (e) {
        console.log('FAILED');
        failed.push(`${f.file}: ${(e as Error).message}`);
      }
    }
    console.log(`\n  ${got} downloaded, ${skipped} already present.`);
    if (failed.length) {
      for (const f of failed) console.log(`  ✗ ${f}`);
      console.log('  Re-run to retry — completed files are skipped.');
      process.exitCode = 1;
    }
    console.log(
      `\nPoint the solver at them if you have not already:\n` +
        `  echo "add_path ${dir}" >> "$(brew --prefix)/etc/astrometry.cfg"`,
    );
    return;
  }

  if (args.targets) {
    // The static tables identify the target; this captures what the *online*
    // services say about the same field — the faint companions and the Chinese
    // names the tables don't carry — so the field machine can replay them.
    const registry = await loadRegistries(defaultRegistryPaths());
    if (!registry?.objects.length) {
      console.log('No atlas registry found — export one from the atlas tool first.');
      process.exitCode = 1;
      return;
    }
    console.log(`Warming the online-answer snapshot for ${registry.objects.length} target(s)…\n`);
    const client = createCatalogFromSources(['simbad', 'vizier', 'openngc'], { snapshot: true });
    const results = await prewarmTargets(registry.objects, client);
    for (const r of results) {
      if (r.skipped) console.log(`  – ${r.target}: ${r.skipped}`);
      else if (r.error) console.log(`  ✗ ${r.target}: ${r.error}`);
      else console.log(`  ✓ ${r.target.padEnd(20)} r=${r.radius_deg!.toFixed(2)}° → ${r.candidates} objects`);
    }
    const snap = await catalogCacheStatus();
    const bad = results.filter((r) => r.error).length;
    console.log(`\n  snapshot: ${snap.entries} field(s), ${(snap.bytes / 1024).toFixed(0)} KB → ${snap.dir}`);
    if (bad) process.exitCode = 1;
    return;
  }

  console.log(`Downloading the offline catalog pack into ${dir}…\n`);
  const results = await prefetchOfflineCatalogs(dir);
  const failed = results.filter((r) => r.error);
  const bytes = results.reduce((n, r) => n + (r.bytes ?? 0), 0);
  console.log(
    `\n${results.length - failed.length}/${results.length} catalogs ready ` +
      `(${(bytes / 1024 / 1024).toFixed(2)} MB).`,
  );
  if (failed.length) {
    for (const f of failed) console.log(`  ✗ ${f.key}: ${f.error}`);
    console.log('\nRe-run to retry the failed ones; the rest are already cached.');
    process.exitCode = 1;
  } else {
    console.log('Run `astrolens prefetch --check` any time to confirm.');
  }
}
