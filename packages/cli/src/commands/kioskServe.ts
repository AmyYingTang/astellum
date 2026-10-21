import express from 'express';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { Reading, BUILT_IN_STYLE_PRESETS, contentOverlay } from '@astellum/schema';
import { loadConfig } from '@astellum/schema/node';
import { offlineCatalogStatus, isOfflineReady } from '@astellum/identify';
import {
  KIOSK_FAVICON,
  generateKioskShellHtml,
  renderPosterBuffers,
  type KioskPicker,
} from '@astellum/renderer';
import { loadReadingLibraries, defaultReadingsPaths } from '@astellum/reader';
import { runKiosk, restyleFrame, styleNames } from './kiosk.js';
import { exitWhenOrphaned } from '../supervised.js';
import { langFor } from '../lang.js';

/**
 * The kiosk itself, served.
 *
 * `astellum kiosk <file>` assumes somebody is at a terminal. On the night they
 * usually aren't — the machine is plugged into a screen and whoever is running
 * the session wants to pick a file and have a frame appear.
 *
 * So `/` *is* the kiosk: the same fullscreen surface, empty until you choose
 * something. Picking happens in an overlay on top of it rather than on a page
 * of its own, which is why there is no form here any more — it lives in
 * `generateKioskShellHtml`, next to the frame it shares its chrome with.
 *
 * Deliberately not the studio. No project list, no editing, no export menu —
 * everything here has to be usable at arm's length in the dark by someone who
 * is also answering questions.
 */

export interface KioskServeArgs {
  port?: number;
  open?: boolean;
  workdir?: string;
}

export async function serveKiosk(args: KioskServeArgs = {}): Promise<void> {
  const port = args.port ?? 3200;
  const workdir = resolve(args.workdir ?? join(tmpdir(), 'astellum-kiosk'));
  await mkdir(workdir, { recursive: true });
  const cfg = loadConfig();

  const app = express();
  app.use(express.json({ limit: '256mb' })); // a FITS master is not small

  app.get('/favicon.svg', (_req, res) => {
    res.type('image/svg+xml').set('cache-control', 'max-age=86400').send(KIOSK_FAVICON);
  });

  /**
   * What every page served here gets: a way back to whatever launched us, and
   * the picker. Both are server-side facts — the picker needs an endpoint to
   * POST to, and the back link only exists when the hub spawned this process —
   * which is why the portable `file://` page produced by `astellum kiosk
   * <file>` is built without them.
   */
  const chrome = async (): Promise<{ hubUrl?: string; picker: KioskPicker }> => {
    const status = await offlineCatalogStatus().catch(() => []);
    const missing = status.filter((s) => !s.present).map((s) => s.key);
    const ready = status.length ? isOfflineReady(status) : true;
    // Offer whichever question this deployment can answer: the styles somebody
    // has actually written for, or — when it writes on the night — who is in
    // the room. The style list is the library's, the same one the frame's own
    // switch uses; it used to be the single configured style, which could
    // never satisfy the form's "more than one" condition, so that select has
    // never appeared.
    const ai = cfg.kiosk.readingSource === 'ai';
    // A library that will not parse must not take the picker down with it —
    // but it must not vanish quietly either, or a deployment loses its styles
    // and nobody learns why until the frame itself fails.
    const library = ai
      ? null
      : await loadReadingLibraries(defaultReadingsPaths()).catch((e: Error) => {
          console.log(`  ⚠ could not read the readings library: ${e.message}`);
          return null;
        });
    const overlay = contentOverlay().stylePresets;
    return {
      hubUrl: process.env.ASTELLUM_HUB_URL || undefined,
      picker: {
        endpoint: '/api/run',
        styles: library ? styleNames(library) : undefined,
        presets: ai ? (overlay?.length ? overlay : BUILT_IN_STYLE_PRESETS) : undefined,
        offlineNote: ready
          ? { zh: '离线星表齐全,可断网运行', en: 'Offline catalogues ready — this works unplugged.' }
          : {
              zh: `离线星表缺 ${missing.join('、')},先跑 astellum prefetch`,
              en: `Offline catalogues missing ${missing.join(', ')} — run astellum prefetch first.`,
            },
      },
    };
  };

  app.get('/', async (req, res) => {
    // Same cookie the hub writes, so walking in from the dashboard does not
    // switch language under you.
    res.type('html').send(generateKioskShellHtml({ ...(await chrome()), lang: langFor(req) }));
  });

  let seq = 0;
  app.post('/api/run', async (req, res) => {
    try {
      const body = req.body as {
        filename?: string;
        dataUrl?: string;
        target?: string;
        lang?: string;
        style?: string;
        tone?: string;
      };
      if (!body.dataUrl) throw new Error('No file received');
      const ext = (extname(body.filename ?? '') || '.jpg').toLowerCase();
      const id = `f${++seq}`;
      const dir = join(workdir, id);
      await mkdir(dir, { recursive: true });
      const src = join(dir, `source${ext}`);
      await writeFile(src, Buffer.from(body.dataUrl.replace(/^data:[^;]+;base64,/, ''), 'base64'));

      // The browser already has the page open; opening another one on the
      // server would put the frame on the wrong screen.
      const result = await runKiosk({
        image: src,
        target: body.target,
        lang: body.lang,
        style: body.style,
        // Only the form in `ai` mode sends one, and only `ai` mode's runKiosk
        // looks at it — but say it explicitly rather than inferring the source
        // from whether a chip was pressed.
        ...(cfg.kiosk.readingSource === 'ai' ? { source: 'ai' as const, tone: body.tone } : {}),
        out: dir,
        open: false,
        // The frame carries the same chrome as the shell it replaces, so the
        // way out and the way to the next image never disappear.
        chrome: await chrome(),
      });
      if (!result) throw new Error('这张图没有识别出可用的天体,没有生成页面。');
      res.json({ ok: true, url: `/view/${id}`, objectName: result.objectName, state: result.state });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  /**
   * The poster for a frame already on screen.
   *
   * Everything it needs is in the frame's own directory — the reading and the
   * image the reading points at — so this re-renders rather than keeping
   * anything in memory. The language is the page's, not the one baked into the
   * reading: the frame can be switched after it was made, and a poster that
   * disagreed with the screen it was printed from would be a puzzle.
   *
   * It is slow on purpose-built hardware and slower on a laptop: the renderer
   * starts a headless browser. The button that calls this says so.
   */
  app.get('/view/:id/poster', async (req, res) => {
    try {
      if (!/^f\d+$/.test(req.params.id)) throw new Error('bad id');
      const dir = join(workdir, req.params.id);
      const raw = JSON.parse(await readFile(join(dir, 'reading.json'), 'utf8')) as unknown;
      const lang = req.query.lang === 'en' ? 'en' : req.query.lang === 'zh' ? 'zh' : undefined;
      const report = Reading.parse(
        lang ? { ...(raw as Record<string, unknown>), display_language: lang } : raw,
      );
      const layout = req.query.layout === 'landscape' ? 'landscape' : 'portrait';
      const imgPath = join(dir, report.image.src);
      const mime = extname(imgPath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
      const dataUri = `data:${mime};base64,${(await readFile(imgPath)).toString('base64')}`;
      const [poster] = await renderPosterBuffers({ report, imageDataUri: dataUri, layouts: [layout] });
      if (!poster) throw new Error('poster render produced nothing');
      const stem = (report.object.name.en || report.object.name.zh || 'poster')
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, '-');
      res
        .type('image/png')
        .set('content-disposition', `attachment; filename="${stem}_${poster.name}"`)
        .send(poster.buffer);
    } catch (e) {
      res.status(400).type('text').send((e as Error).message);
    }
  });

  /**
   * The frame. With `?style=` it is re-read in that style first — the switch on
   * screen reloads here, and until now this route ignored the query, so that
   * switch silently did nothing at all.
   *
   * Re-reading costs a second (the solve and the catalogue query are already on
   * disk) and is only possible from the library, so it is refused outright when
   * this deployment has the words written on the night.
   */
  app.get('/view/:id', async (req, res) => {
    try {
      if (!/^f\d+$/.test(req.params.id)) throw new Error('bad id');
      const dir = join(workdir, req.params.id);
      const style = typeof req.query.style === 'string' ? req.query.style : undefined;
      if (style && cfg.kiosk.readingSource !== 'ai') {
        const html = await restyleFrame({
          dir,
          style,
          lang: langFor(req),
          chrome: await chrome(),
        });
        if (html) {
          res.type('html').send(html);
          return;
        }
        // No fact sheet to re-read from: show the frame as it stands rather
        // than an error page in front of an audience.
      }
      res.type('html').send(await readFile(join(dir, 'kiosk.html'), 'utf8'));
    } catch {
      res.status(404).type('text').send('Not found');
    }
  });

  await new Promise<void>((ok) => {
    const server = app.listen(port, () => ok());
    server.on('error', (e) => {
      throw e;
    });
  });
  const url = `http://localhost:${port}/`;
  console.log(`Kiosk: ${url}`);
  console.log(`Frames written to ${workdir}`);
  console.log('Ctrl+C to stop.');
  exitWhenOrphaned();
  if (args.open !== false) {
    const cmd =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    const { execFile } = await import('node:child_process');
    execFile(cmd, [url], () => {
      /* headless is fine */
    });
  }
  await new Promise<void>(() => {
    /* run until interrupted */
  });
}
