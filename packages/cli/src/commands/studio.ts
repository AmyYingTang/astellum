import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { exitWhenOrphaned } from '../supervised.js';
import { startStudioServer } from '@astrolens/editor';
import { startAtlasServer } from '@astrolens/atlas';
import { solverName } from '@astrolens/identify';
import { TOOL_VERSION } from '../version.js';

export interface StudioArgs {
  workspace: string;
  port: number;
  open: boolean;
  /** Atlas tool data dir (the "Feature Atlas" link on the home opens it). */
  atlasDataDir?: string;
  atlasPort?: number;
}

export async function studio(args: StudioArgs): Promise<void> {
  const workspace = resolve(args.workspace);
  const handle = await startStudioServer({ workspace, port: args.port, toolVersion: TOOL_VERSION });

  // Co-launch the feature-atlas tool so the home-page "Feature Atlas" link works
  // out of the box. Best-effort: if its port is taken, the studio still runs.
  const atlasPort = args.atlasPort ?? 3100;
  const atlasDataDir = resolve(args.atlasDataDir ?? join(homedir(), '.astrolens', 'atlas'));
  let atlas: { close: () => Promise<void> } | undefined;
  try {
    atlas = await startAtlasServer({ dataDir: atlasDataDir, port: atlasPort });
    console.log(`feature-atlas tool running at http://localhost:${atlasPort} (data: ${atlasDataDir})`);
  } catch (e) {
    console.error(`(feature-atlas tool not started: ${(e as Error).message})`);
  }

  console.log(`astrolens studio running at ${handle.url}`);
  console.log(`Workspace: ${workspace}`);
  console.log(`Plate-solver: ${solverName()}`);
  console.log('Press Ctrl+C to stop.');
  exitWhenOrphaned();

  if (args.open) {
    spawn('open', [handle.url], { stdio: 'ignore', detached: true }).unref();
  }

  const shutdown = (): void => {
    void Promise.all([handle.close(), atlas?.close()]).then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
