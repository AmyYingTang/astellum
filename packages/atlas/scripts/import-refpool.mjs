#!/usr/bin/env node
// Bulk-import the staged Commons reference images into the atlas.
//
// One-shot bootstrap so a reviewer opens a target and the image is already
// there, solved, instead of having to find and upload one. Drives the running
// atlas server over its normal HTTP API — no server-side code involved, it is
// exactly the "upload → wait for solve → fill primary ID → save" loop a person
// would do by hand, 98 times.
//
//   node packages/atlas/scripts/import-refpool.mjs --dry-run
//   node packages/atlas/scripts/import-refpool.mjs
//
// Safe to re-run: targets that already carry a reference are skipped, so an
// interrupted overnight run just picks up where it stopped.

import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');

// The server reads ATLAS_PASSWORD from .env, so we have to as well — otherwise
// every request here bounces off the password gate with a 401. Same loader the
// CLI uses; real shell vars still win over the file.
const { loadEnv } = await import(join(REPO, 'packages/cli/dist/env.js'));
loadEnv(join(REPO, '.env'));

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const POOL = resolve(flag('pool', join(REPO, 'packages/atlas/data/refpool')));
const SERVER = flag('server', 'http://127.0.0.1:3100').replace(/\/$/, '');
const DRY = has('dry-run');
const ONLY = flag('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const LIMIT = Number(flag('limit', '0')) || Infinity;
// Overwrite the reference image of an entry that already has one — but only if
// it carries no annotations, so a drawn-on target is still never touched. For
// swapping in a better image after the fact (e.g. an optical frame over a JWST one).
const REPLACE = has('replace');
// A local solve is ~10–60s; nova can queue for minutes. Generous, but bounded
// so one pathological image can't stall the whole overnight run.
const SOLVE_TIMEOUT_MS = Number(flag('solve-timeout', '600')) * 1000;

const password = process.env.ATLAS_PASSWORD;
const authHeaders = password
  ? { authorization: `Basic ${Buffer.from(`atlas:${password}`).toString('base64')}` }
  : {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init = {}) {
  // The server blocks its event loop for stretches while the identify pipeline
  // chews on a frame, and a single dropped connection used to kill the whole
  // target. Over a 97-image overnight run that's the difference between a few
  // retries and a morning of spurious failures.
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(`${SERVER}${path}`, {
        ...init,
        headers: {
          ...authHeaders,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
      });
      break;
    } catch (e) {
      if (attempt >= 4) throw new Error(`${e.message} (after ${attempt + 1} tries)`);
      await sleep(3000 * (attempt + 1));
    }
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // A 401 HTML page is the common case here; say so rather than "unexpected token".
    throw new Error(`${res.status} ${res.statusText} from ${path} — ${text.slice(0, 120)}`);
  }
  return { status: res.status, json };
}

/** Upload one image and poll until the solve finishes. */
async function solve(file, filename) {
  const b64 = (await readFile(file)).toString('base64');
  const up = await api('/api/upload', {
    method: 'POST',
    body: JSON.stringify({ filename, imageBase64: `data:image/jpeg;base64,${b64}` }),
  });
  if (!up.json.ok || !up.json.jobId) throw new Error(up.json.error ?? 'upload rejected');

  const deadline = Date.now() + SOLVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(2000);
    const { json: job } = await api(`/api/job/${up.json.jobId}`);
    if (job.state === 'done') return job;
    if (job.state === 'failed') throw new Error(job.error ?? 'solve failed');
  }
  throw new Error(`solve timed out after ${SOLVE_TIMEOUT_MS / 1000}s`);
}

async function main() {
  const { manifest } = JSON.parse(await readFile(join(POOL, 'manifest.json'), 'utf8'));
  // Aliases come from the seed pool so the entry matches every identity string
  // the apply side might look it up by, not just the catalogue number.
  const { SEED_TARGETS } = await import(join(REPO, 'packages/atlas/dist/seedTargets.js'));
  const seedByKey = new Map(SEED_TARGETS.map((t) => [t.key, t]));

  const rows = manifest
    .filter((m) => !ONLY.length || ONLY.includes(m.key))
    .slice(0, LIMIT);

  console.log(`pool     ${POOL}`);
  console.log(`server   ${SERVER}${password ? ' (password set)' : ' (no password)'}`);
  console.log(`targets  ${rows.length}${DRY ? '   [DRY RUN — nothing will be written]' : ''}\n`);

  const skipped = [];
  const failed = [];
  let done = 0;

  for (const [i, m] of rows.entries()) {
    const seed = seedByKey.get(m.key);
    const id = seed?.designation ?? m.designation;
    const tag = `[${String(i + 1).padStart(3)}/${rows.length}] ${id.padEnd(16)}`;

    // Never touch an entry that already has a reference or any annotations —
    // this script only fills empty slots, it does not overwrite anyone's work.
    const { json: existing } = await api(`/api/object/${encodeURIComponent(id)}`);
    const entry = existing.entry;
    if (entry?.annotations?.length) {
      console.log(`${tag} skip — has ${entry.annotations.length} annotation(s), leaving alone`);
      skipped.push(id);
      continue;
    }
    if (entry?.reference && !REPLACE) {
      console.log(`${tag} skip — already has a reference image`);
      skipped.push(id);
      continue;
    }
    if (entry?.reference && REPLACE) {
      console.log(`${tag} replacing existing reference image`);
    }

    if (DRY) {
      console.log(`${tag} would import ${m.commons_title.slice(0, 46)}`);
      done++;
      continue;
    }

    const t0 = Date.now();
    let job;
    try {
      job = await solve(join(POOL, m.file), basename(m.file));
    } catch (e) {
      console.log(`${tag} FAILED — ${e.message}`);
      failed.push({ id, reason: e.message, title: m.commons_title });
      continue;
    }

    const payload = {
      primary_id: id,
      aliases: (seed?.match ?? []).filter((a) => a !== id),
      reference: {
        image_ref: job.imageRef,
        wcs: job.wcs,
        width_px: job.width,
        height_px: job.height,
        credit: m.credit,
        license: m.license,
        source_url: m.source_url,
      },
      annotations: [],
      rev: entry?.rev ?? 0,
    };
    const save = await api(`/api/object/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ entry: payload }),
    });
    if (save.status === 409) {
      console.log(`${tag} FAILED — changed by someone else mid-run, skipping`);
      failed.push({ id, reason: 'save conflict', title: m.commons_title });
      continue;
    }
    if (!save.json.ok) {
      console.log(`${tag} FAILED — ${save.json.error ?? 'save rejected'}`);
      failed.push({ id, reason: save.json.error ?? 'save rejected', title: m.commons_title });
      continue;
    }
    done++;
    console.log(`${tag} ok  ${((Date.now() - t0) / 1000).toFixed(0)}s  ${m.commons_title.slice(0, 44)}`);
  }

  console.log(`\nimported ${done} · skipped ${skipped.length} · failed ${failed.length}`);
  if (failed.length) {
    console.log('\nfailed — these need a different image, or a manual upload:');
    for (const f of failed) console.log(`  ${f.id.padEnd(16)} ${f.reason}`);
    console.log('\nRe-running is safe; it will retry exactly these.');
  }
}

main().catch((e) => {
  console.error(`\nimport aborted: ${e.message}`);
  process.exit(1);
});
