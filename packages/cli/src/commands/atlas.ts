import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { startAtlasServer } from '@astellum/atlas';
import { solverName } from '@astellum/identify';

export interface AtlasArgs {
  dataDir?: string;
  port: number;
  open: boolean;
}

export async function atlas(args: AtlasArgs): Promise<void> {
  // Default to a per-user dir OUTSIDE the repo so a self-deployer's annotations
  // never clobber the shipped/curated seed (packages/atlas/data). Amy curates
  // the seed by passing --data-dir packages/atlas/data (astellum does).
  const dataDir = resolve(args.dataDir ?? join(homedir(), '.astellum', 'atlas'));
  const handle = await startAtlasServer({ dataDir, port: args.port });

  console.log(`astellum feature-atlas tool running at ${handle.url}`);
  console.log(`Data dir: ${dataDir}`);
  console.log(`Plate-solver: ${solverName()}`);
  console.log('Press Ctrl+C to stop.');

  if (args.open) {
    spawn('open', [handle.url], { stdio: 'ignore', detached: true }).unref();
  }

  const shutdown = (): void => {
    void handle.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
