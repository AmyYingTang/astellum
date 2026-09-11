#!/usr/bin/env node
// Refresh every feature's badge.bubble_r in existing report.json files to the
// resolution-scaled default (min(width,height)/40, floor 24) — matches the
// reader's generation default so old reports get the larger, consistent labels
// without re-running the AI. Pass one or more report.json paths (or globs your
// shell expands). Re-render afterward with `astellum render <report>`.
//
//   node scripts/resize-badges.mjs out/*/report.json

import { readFileSync, writeFileSync } from 'node:fs';

const DIVISOR = 40;
const FLOOR = 24;

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/resize-badges.mjs <report.json> [more...]');
  process.exit(1);
}

for (const file of files) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const min = Math.min(report.image.width, report.image.height);
  const bubbleR = Math.max(FLOOR, Math.round(min / DIVISOR));
  let changed = 0;
  for (const f of report.features) {
    if (f.badge.bubble_r !== bubbleR) {
      f.badge.bubble_r = bubbleR;
      changed++;
    }
  }
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(`${file}: ${report.features.length} badges -> bubble_r=${bubbleR} (${changed} changed)`);
}
