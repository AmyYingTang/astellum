#!/usr/bin/env node
import { cac } from 'cac';
import { TOOL_VERSION } from './version.js';
import { loadEnv } from './env.js';
import { identifyImage } from './commands/identify.js';
import { identifyAi } from './commands/identifyAi.js';
import { readReport } from './commands/read.js';
import { renderReport } from './commands/render.js';
import { editReport } from './commands/edit.js';
import { studio } from './commands/studio.js';
import { atlas } from './commands/atlas.js';
import { prefetchCatalogs } from './commands/prefetch.js';
import { runKiosk, watchKiosk } from './commands/kiosk.js';
import { serveKiosk } from './commands/kioskServe.js';
import { runHub } from './commands/hub.js';
import { readingsStatus, readingsDraft } from './commands/readings.js';

const cli = cac('astrolens');

cli
  .command('hub', 'Navigation page for all three surfaces, plus settings')
  .option('--port <port>', 'Port to serve on', { default: 3000 })
  .option('--studio-port <port>', 'Studio port', { default: 3010 })
  .option('--atlas-port <port>', 'Atlas port', { default: 3100 })
  .option('--kiosk-port <port>', 'Kiosk port', { default: 3200 })
  .option('--workspace <dir>', 'Studio projects directory')
  .option('--atlas-data-dir <dir>', 'Atlas data dir')
  .option('--settings', 'Open the settings page instead of the nav page')
  .option('--no-open', 'Do not open the browser automatically')
  .action(async (options) => {
    await runHub({
      port: Number(options.port),
      studioPort: Number(options.studioPort),
      atlasPort: Number(options.atlasPort),
      kioskPort: Number(options.kioskPort),
      workspace: options.workspace,
      atlasDataDir: options.atlasDataDir,
      settings: options.settings,
      open: options.open,
    });
  });

cli
  .command('readings', 'Predefined reading library: coverage report')
  .option('--style <name>', 'Style to report on', { default: 'general' })
  .action(async (options) => {
    await readingsStatus({ style: options.style });
  });

cli
  .command('readings-draft [target]', 'Draft predefined readings with the LLM (offsite; needs claude)')
  .option('--all', 'Draft every annotated target that has no reading yet')
  .option('--style <name>', 'Style to write into', { default: 'general' })
  .option('--model <model>', 'Model passed to the claude CLI')
  .option('--out <file>', 'Library file to write (default: ~/.astrolens/readings.json)')
  .option('--force', 'Redraft targets that already have a reading')
  .action(async (target: string | undefined, options) => {
    await readingsDraft({
      target,
      all: options.all,
      style: options.style,
      model: options.model,
      out: options.out,
      force: options.force,
    });
  });

cli
  .command('kiosk <image>', 'Onsite: one-shot identify → predefined reading → fullscreen page')
  .option('--target <name>', 'The target you shot, e.g. "M42" (recommended — it is the identity)')
  .option('--lang <lang>', 'Display language: zh or en', { default: 'zh' })
  .option('--style <name>', 'Predefined reading style (default: the profile\'s)')
  .option('--profile <name>', 'Config profile to run under (default: the active one)')
  .option('--out <dir>', 'Output directory')
  .option('--no-open', 'Do not open the finished page in a browser')
  .action(async (image: string, options) => {
    await runKiosk({
      image,
      target: options.target,
      lang: options.lang,
      style: options.style,
      profile: options.profile,
      out: options.out,
      open: options.open,
    });
  });

cli
  .command('kiosk-serve', 'Onsite: a browser page to pick a file from (FITS / JPG / PNG)')
  .option('--port <port>', 'Port to serve on', { default: 3200 })
  .option('--profile <name>', 'Config profile to run under')
  .option('--workdir <dir>', 'Where generated frames are written')
  .option('--no-open', 'Do not open the browser automatically')
  .action(async (options) => {
    await serveKiosk({
      port: Number(options.port),
      profile: options.profile,
      workdir: options.workdir,
      open: options.open,
    });
  });

cli
  .command('kiosk-watch <dir>', 'Onsite: watch a folder and build a frame for each new image')
  .option('--target <name>', 'Fixed target for every image (default: guessed from the filename)')
  .option('--lang <lang>', 'Display language: zh or en', { default: 'zh' })
  .option('--style <name>', 'Predefined reading style')
  .option('--profile <name>', 'Config profile to run under')
  .option('--out <dir>', 'Output directory')
  .action(async (dir: string, options) => {
    await watchKiosk({
      dir,
      target: options.target,
      lang: options.lang,
      style: options.style,
      profile: options.profile,
      out: options.out,
    });
  });

cli
  .command('prefetch', 'Download the offline catalog pack (run once, with a network)')
  .option('--dir <dir>', 'Pack directory (default: ~/.cache/astrolens/catalogs)')
  .option('--check', 'Report what is on disk instead of downloading')
  .option('--targets', 'Warm the online-answer snapshot for every annotated target')
  .option('--indexes <arcmin>', 'Download plate-solve indexes down to this field width (e.g. 60)')
  .option('--index-dir <dir>', 'Where index files go (default ~/astrometry-indexes)')
  .action(async (options) => {
    await prefetchCatalogs({
      dir: options.dir,
      check: options.check,
      targets: options.targets,
      indexes: options.indexes != null ? Number(options.indexes) : undefined,
      indexDir: options.indexDir,
    });
  });

cli
  .command('identify <image>', 'Stage 1: plate-solve + catalog → factsheet.json (no LLM)')
  .option('--target <name>', 'Target name hint, e.g. "M42" (used on solve failure)')
  .option('--out <dir>', 'Output directory', { default: '.' })
  .option('--band <band>', 'broadband | narrowband | unknown', { default: 'unknown' })
  .option('--starless', 'Mark the image as starless')
  .option('--top-n <n>', 'Max catalogued objects to keep')
  .option('--api-key <key>', 'nova API key (defaults to $ASTROMETRY_API_KEY)')
  .option('--no-cache', 'Force a fresh nova solve (ignore the on-disk solve cache)')
  .action(async (image: string, options) => {
    await identifyImage({
      image,
      target: options.target,
      out: options.out,
      band: options.band,
      starless: options.starless,
      topN: options.topN != null ? Number(options.topN) : undefined,
      apiKey: options.apiKey,
      cache: options.cache,
    });
  });

cli
  .command('identify-ai <project>', 'EXPERIMENT: AI Class-B feature pass on a solved project (compare vs CV)')
  .option('--model <model>', 'Model passed to the claude CLI', { default: 'claude-opus-4-8' })
  .option('--out <dir>', 'Output directory (default: the project directory)')
  .action(async (project: string, options) => {
    await identifyAi({ project, model: options.model, out: options.out });
  });

cli
  .command('read <image>', 'Full pipeline: identify (factsheet) + reader (reading)')
  .option('--hint <name>', 'Object name hint, e.g. "Sh2-308"')
  .option('--lang <lang>', 'Display language: zh or en', { default: 'zh' })
  .option('--out <dir>', 'Output directory', { default: '.' })
  .option('--model <model>', 'Model passed to the claude CLI')
  .option('--style <text>', 'Extra instructions for tone/audience/focus')
  .option('--api-key <key>', 'nova API key (defaults to $ASTROMETRY_API_KEY)')
  .option('--no-cache', 'Force a fresh nova solve (ignore the on-disk solve cache)')
  .action(async (image: string, options) => {
    await readReport({
      image,
      hint: options.hint,
      lang: options.lang,
      out: options.out,
      model: options.model,
      style: options.style,
      apiKey: options.apiKey,
      cache: options.cache,
    });
  });

cli
  .command('render <report>', 'Render a reading.json to image / embed / poster')
  .option('--format <format>', 'annotated | embed | poster | all', { default: 'annotated' })
  .option('--out <dir>', 'Output directory (default: the report directory)')
  .action(async (report: string, options) => {
    await renderReport({ report, format: options.format, out: options.out });
  });

cli
  .command('edit <report>', 'Open the local editor for a reading.json')
  .option('--port <port>', 'Port to serve on', { default: 3000 })
  .option('--no-open', 'Do not open the browser automatically')
  .action(async (report: string, options) => {
    await editReport({ report, port: Number(options.port), open: options.open });
  });

cli
  .command('studio', 'Launch the astrolens studio (home + editor) in the browser')
  .option('--workspace <dir>', 'Projects directory', { default: 'out' })
  .option('--port <port>', 'Port to serve on', { default: 3000 })
  .option('--atlas-data-dir <dir>', 'Feature-atlas data dir (default ~/.astrolens/atlas)')
  .option('--atlas-port <port>', 'Port for the co-launched feature-atlas tool', { default: 3100 })
  .option('--no-open', 'Do not open the browser automatically')
  .action(async (options) => {
    await studio({
      workspace: options.workspace,
      port: Number(options.port),
      open: options.open,
      atlasDataDir: options.atlasDataDir,
      atlasPort: Number(options.atlasPort),
    });
  });

cli
  .command('atlas', 'Launch the feature-atlas annotation tool (build the B-class baseline library)')
  .option('--data-dir <dir>', 'Atlas data dir (default ~/.astrolens/atlas; seed curators pass packages/atlas/data)')
  .option('--port <port>', 'Port to serve on', { default: 3100 })
  .option('--no-open', 'Do not open the browser automatically')
  .action(async (options) => {
    await atlas({ dataDir: options.dataDir, port: Number(options.port), open: options.open });
  });

cli.help();
cli.version(TOOL_VERSION);

async function main(): Promise<void> {
  try {
    loadEnv(); // pick up ASTROMETRY_API_KEY etc. from ./.env (shell vars still win)
    cli.parse(process.argv, { run: false });
    await cli.runMatchedCommand();
  } catch (err) {
    console.error(`astrolens: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

void main();
