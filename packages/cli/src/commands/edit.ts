import { resolve, dirname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { startStudioServer } from '@astellum/editor';
import { TOOL_VERSION } from '../version.js';

export interface EditArgs {
  report: string;
  port: number;
  open: boolean;
}

/** Open the studio focused on one reading.json. The report's directory is the
 * project (slug = its name), and its parent is the workspace. */
export async function editReport(args: EditArgs): Promise<void> {
  const reportPath = resolve(args.report);
  const dir = dirname(reportPath);
  const slug = basename(dir);
  const workspace = dirname(dir);

  const handle = await startStudioServer({ workspace, port: args.port, toolVersion: TOOL_VERSION });
  const url = `${handle.url}/#/p/${encodeURIComponent(slug)}`;

  console.log(`astellum editor running at ${url}`);
  console.log(`Editing: ${reportPath}`);
  console.log('Press Ctrl+C to stop.');

  if (args.open) {
    spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
  }

  const shutdown = (): void => {
    void handle.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
