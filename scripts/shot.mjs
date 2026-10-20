#!/usr/bin/env node
// Capture the front page of a Chrome started with --remote-debugging-port
// (see scripts/poster-shots.sh) as a high-resolution PNG — screenshots for
// talks and posters, at whatever pixel density the print needs. Grabs the
// page as it is right now, so click your way to the frame you want first.
//
// Goes through the debug port rather than the OS screen-grabber on purpose:
// no Screen Recording permission, no window chrome in the image, and the
// scale factor is ours to choose.
//
//   node scripts/shot.mjs out/poster-shots/studio.png        # 2x
//   node scripts/shot.mjs out/poster-shots/kiosk.png 3       # 3x
//
// Port is 9222 unless $CHROME_DEBUG_PORT says otherwise.

import { writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/shot.mjs <out.png> [scale]');
  process.exit(1);
}
const scale = Number(process.argv[3] ?? 2);
const port = process.env.CHROME_DEBUG_PORT ?? '9222';

let targets;
try {
  targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
} catch {
  console.error(
    `No Chrome listening on 127.0.0.1:${port}. Start one with scripts/poster-shots.sh.`,
  );
  process.exit(1);
}

// Extensions and devtools show up as targets too; we want a real page.
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http'));
if (!page) {
  console.error(`Chrome on :${port} has no http page open.`);
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
// Nothing here should take seconds; a hang means Chrome is wedged or the tab
// is throttled, and a stuck process with no output is the worst way to find
// that out.
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} got no answer in 20s — is that Chrome window alive?`));
    }, 20_000);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });

ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  const waiter = msg.id && pending.get(msg.id);
  if (!waiter) return;
  pending.delete(msg.id);
  if (msg.error) waiter.reject(new Error(msg.error.message));
  else waiter.resolve(msg.result);
});
await new Promise((ok) => ws.addEventListener('open', ok));

// Re-render at the requested density without resizing the window the user is
// working in: same CSS viewport, higher deviceScaleFactor, then put it back.
const { layoutViewport } = await send('Page.getLayoutMetrics');
const width = layoutViewport.clientWidth;
const height = layoutViewport.clientHeight;
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: scale,
  mobile: false,
});
// A backgrounded window produces no frames, and the capture then just hangs —
// so raise it first. This is why the window flashes to the front when you run
// the script; it goes back to whatever you were doing on its own.
await send('Page.bringToFront');
const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
await send('Emulation.clearDeviceMetricsOverride');
ws.close();

writeFileSync(out, Buffer.from(data, 'base64'));
console.log(`${out}  ${width * scale}x${height * scale}  <- ${page.url}`);
