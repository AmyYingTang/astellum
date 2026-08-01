import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  PredefinedLibrary,
  DEFAULT_STYLE,
  mergeLibraries,
  missingElements,
  pickStyle,
  findPredefined,
  type RegistryEntry,
} from '@astrolens/schema';
import { loadRegistries, defaultRegistryPaths } from '@astrolens/identify';
import {
  draftPredefinedStyle,
  draftToEntry,
  loadReadingLibraries,
  loadReadingLibrary,
  defaultReadingsPaths,
  userReadingsPath,
} from '@astrolens/reader';

/**
 * Manage the predefined reading library: see what's covered, and draft what
 * isn't.
 *
 * Drafting needs a network and the `claude` CLI, so it belongs to the offsite
 * half of the workflow — you fill the library at a desk, then the kiosk uses it
 * with everything unplugged. Drafts are written as `ai_draft` and stay that way
 * until a person reviews them.
 */

export interface ReadingsArgs {
  target?: string;
  all?: boolean;
  style?: string;
  model?: string;
  out?: string;
  force?: boolean;
}

const ELEMENT_LABEL: Record<string, string> = {
  property_and_position: '性质与位置',
  sense_of_scale: '尺度感',
  important_features: '逐条特征',
  culture: '文化',
  fun_facts: '冷知识',
};

/** Coverage report: every annotated target, and what its reading is missing. */
export async function readingsStatus(args: ReadingsArgs = {}): Promise<void> {
  const registry = await loadRegistries(defaultRegistryPaths());
  const library = await loadReadingLibraries(defaultReadingsPaths());
  const style = args.style ?? DEFAULT_STYLE;

  if (!registry?.objects.length) {
    console.log('No atlas registry found — export one from the atlas tool first.');
    return;
  }
  console.log(`Predefined readings (style "${style}") — ${registry.objects.length} annotated targets\n`);

  let done = 0;
  let draft = 0;
  let none = 0;
  for (const entry of registry.objects) {
    const found = library
      ? findPredefined(library, [entry.primary_id, ...entry.aliases])
      : undefined;
    const picked = found ? pickStyle(found, style) : undefined;
    if (!picked) {
      none += 1;
      console.log(`  ✗ ${entry.primary_id.padEnd(20)} (${entry.annotations.length} 条标注) — 未录入`);
      continue;
    }
    const missing = missingElements(picked.style);
    const tag = found!.source === 'human' ? '✓' : '~';
    if (found!.source === 'human') done += 1;
    else draft += 1;
    const gaps = missing.length
      ? ` — 缺 ${missing.map((m) => ELEMENT_LABEL[m] ?? m).join('、')}`
      : '';
    const src = found!.source === 'human' ? '' : ` [${found!.source}]`;
    console.log(`  ${tag} ${entry.primary_id.padEnd(20)} (${entry.annotations.length} 条标注)${src}${gaps}`);
  }
  console.log(`\n  已审核 ${done} · 待审草稿 ${draft} · 未录入 ${none}`);
  if (none) {
    console.log('  批量起草: `astrolens readings-draft --all`  (或 `./quickastrolens draft all`)');
  }
}

/** Draft one or every uncovered target with the LLM. */
export async function readingsDraft(args: ReadingsArgs = {}): Promise<void> {
  const registry = await loadRegistries(defaultRegistryPaths());
  if (!registry?.objects.length) throw new Error('No atlas registry found.');
  const style = args.style ?? DEFAULT_STYLE;
  const outPath = args.out ?? userReadingsPath();
  const existing =
    (await loadReadingLibrary(outPath)) ?? PredefinedLibrary.parse({ schema_version: 1, entries: [] });
  const library = await loadReadingLibraries(defaultReadingsPaths());

  let targets: RegistryEntry[];
  if (args.target) {
    const key = args.target.toLowerCase().replace(/\s+/g, '');
    const hit = registry.objects.find(
      (o) =>
        o.primary_id.toLowerCase().replace(/\s+/g, '') === key ||
        o.aliases.some((a) => a.toLowerCase().replace(/\s+/g, '') === key),
    );
    if (!hit) throw new Error(`"${args.target}" is not an annotated target in the registry.`);
    targets = [hit];
  } else if (args.all) {
    targets = registry.objects;
  } else {
    throw new Error('Give a target name, or --all.');
  }

  // Don't spend a model call on something already written, unless asked to.
  if (!args.force) {
    targets = targets.filter((entry) => {
      const found = library ? findPredefined(library, [entry.primary_id, ...entry.aliases]) : undefined;
      return !(found && pickStyle(found, style));
    });
  }
  if (!targets.length) {
    console.log('Everything requested already has a reading. Use --force to redraft.');
    return;
  }

  console.log(`Drafting ${targets.length} target(s) in style "${style}" — this calls the claude CLI.\n`);
  const now = new Date().toISOString();
  const drafted: typeof existing.entries = [];
  const failed: { id: string; error: string }[] = [];
  for (const [i, entry] of targets.entries()) {
    process.stdout.write(`  [${i + 1}/${targets.length}] ${entry.primary_id} … `);
    try {
      const s = await draftPredefinedStyle(entry, { style, model: args.model });
      drafted.push(draftToEntry(entry, style, s, now));
      console.log(`ok (${s.features.length} 条特征配文)`);
    } catch (e) {
      failed.push({ id: entry.primary_id, error: (e as Error).message });
      console.log(`FAILED`);
    }
    // Write after each one: a long batch shouldn't lose everything to one crash.
    const merged = mergeLibraries([existing, PredefinedLibrary.parse({ schema_version: 1, entries: drafted })]);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  }

  console.log(`\n  ${drafted.length} drafted → ${outPath}`);
  if (failed.length) {
    console.log(`  ${failed.length} failed:`);
    for (const f of failed) console.log(`    · ${f.id}: ${f.error}`);
    process.exitCode = 1;
  }
  console.log('\n  These are marked `ai_draft`. Review them, then set source to "human".');
}
