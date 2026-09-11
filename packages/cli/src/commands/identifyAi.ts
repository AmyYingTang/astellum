import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import {
  pixelToWorld,
  createLuminanceSampler,
  estimateBackground,
  visibleRadiusPx,
} from '@astellum/identify';
import { runClaude, extractJson } from '@astellum/reader';

/**
 * EXPERIMENT (`astellum identify-ai`): an AI Class-B feature pass, isolated from
 * the deterministic identify pipeline so it can be compared against the CV
 * morphology side-by-side. It feeds Claude (via the existing `claude` CLI + Read
 * tool — vision) a grid-annotated image plus the A-class prior (the plate-solved
 * identity + type + ionizing core), and asks for the visually prominent pillars /
 * bright rims a human would point out — including BRIGHT emission structures the
 * dark-column CV detector can't see. Output is suggestion-only (`detection_source
 * 'ai'`); coordinates are coarse (the model sees the image downscaled), so they're
 * approximate markers to confirm/refine, not precise placements.
 *
 * Requires the `claude` CLI to be authenticated (same as `astellum read`).
 */

const COLS = 8;
const ROWS = 6;
const LETTERS = 'ABCDEFGH';

interface AiFeature {
  type?: string;
  label_zh?: string;
  label_en?: string;
  cell?: string;
  pos?: [number, number];
  toward_core?: boolean;
  note?: string;
}

interface MinimalFactSheet {
  image: { width: number; height: number; src?: string };
  solve: { status: string; pixscale_arcsec?: number; wcs?: unknown };
  objects: Array<{
    role: string;
    names?: string[];
    designations?: string[];
    common_name?: { zh?: string; en?: string };
    category: string;
    type?: { zh?: string; en?: string };
    coord: { pixel: [number, number] | null };
    size_arcmin?: [number, number];
  }>;
}

function gridSvg(
  w: number,
  h: number,
  cw: number,
  ch: number,
  cx: number,
  cy: number,
  r: number,
): string {
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`];
  for (let i = 1; i < COLS; i++)
    parts.push(`<line x1="${i * cw}" y1="0" x2="${i * cw}" y2="${h}" stroke="#9fc6ff" stroke-width="3" stroke-opacity="0.4"/>`);
  for (let j = 1; j < ROWS; j++)
    parts.push(`<line x1="0" y1="${j * ch}" x2="${w}" y2="${j * ch}" stroke="#9fc6ff" stroke-width="3" stroke-opacity="0.4"/>`);
  for (let i = 0; i < COLS; i++)
    for (let j = 0; j < ROWS; j++)
      parts.push(
        `<text x="${i * cw + cw / 2}" y="${j * ch + ch / 2 + 30}" font-size="92" fill="#ffe24a" stroke="#0b0e14" stroke-width="5" paint-order="stroke" text-anchor="middle" font-family="sans-serif" font-weight="700" opacity="0.85">${LETTERS[i]}${j + 1}</text>`,
      );
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${Math.round(r)}" fill="none" stroke="#ff4d6d" stroke-width="6" stroke-opacity="0.95"/>`);
  parts.push(
    `<line x1="${cx - 40}" y1="${cy}" x2="${cx + 40}" y2="${cy}" stroke="#ff4d6d" stroke-width="6"/><line x1="${cx}" y1="${cy - 40}" x2="${cx}" y2="${cy + 40}" stroke="#ff4d6d" stroke-width="6"/>`,
  );
  parts.push('</svg>');
  return parts.join('');
}

function buildPrompt(annotPath: string, name: string, typeLabel: string, category: string): string {
  return [
    `The image at ${annotPath} is a plate-solved amateur astrophoto of ${name}, a ${typeLabel}.`,
    `A reference GRID is overlaid: ${COLS} columns A–${LETTERS[COLS - 1]} (left→right) × ${ROWS} rows 1–${ROWS} (top→bottom), each cell labelled in yellow (e.g. "D3"). The nebula's bright core is marked with a RED CROSS and its extent with a RED CIRCLE.`,
    ``,
    `Read the image file ${annotPath}.`,
    ``,
    `Identify the 3–6 MOST VISUALLY PROMINENT Class-B morphological features a person would point to in this ${category}:`,
    `- "pillar": a column/finger of gas or dust — either a DARK dust column silhouetted against bright gas, OR a BRIGHT illuminated column / elephant trunk. Include the famous bright ones.`,
    `- "bright_rim": a bright, sharply-lit edge of the gas (an ionization front).`,
    `Pick only genuinely eye-catching, characteristic structures; skip faint or ambiguous ones.`,
    ``,
    `Output ONLY a JSON array (no prose, no markdown fences). Each item:`,
    `{"type":"pillar"|"bright_rim","label_zh":"…","label_en":"…","cell":"D3","pos":[0.5,0.5],"toward_core":true,"note":"short phrase"}`,
    `- "cell": the grid cell the feature is centred in.`,
    `- "pos": fractional position WITHIN that cell, [x,y], x rightward 0–1, y downward 0–1.`,
    `- "toward_core": whether its bright/lit side faces the red core.`,
    `Return ONLY the JSON array.`,
  ].join('\n');
}

const COLOR: Record<string, string> = { pillar: '#bb9af7', bright_rim: '#4ec3e0' };

function overlaySvg(
  w: number,
  h: number,
  feats: Array<{ type?: string; pixel: [number, number]; toward_core?: boolean }>,
  core: [number, number],
): string {
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`];
  feats.forEach((f, i) => {
    const [x, y] = f.pixel;
    const c = COLOR[f.type ?? 'pillar'] ?? '#bb9af7';
    parts.push(`<circle cx="${x}" cy="${y}" r="110" fill="none" stroke="${c}" stroke-width="6" stroke-dasharray="22 14"/>`);
    if (f.toward_core) {
      const dx = core[0] - x;
      const dy = core[1] - y;
      const d = Math.hypot(dx, dy) || 1;
      const tx = Math.round(x + (dx / d) * 150);
      const ty = Math.round(y + (dy / d) * 150);
      parts.push(`<line x1="${x}" y1="${y}" x2="${tx}" y2="${ty}" stroke="${c}" stroke-width="5"/>`);
    }
    parts.push(`<circle cx="${x}" cy="${y - 150}" r="46" fill="${c}" stroke="#0b0e14" stroke-width="3"/>`);
    parts.push(`<text x="${x}" y="${y - 134}" font-size="54" font-weight="700" fill="#0b0e14" text-anchor="middle" font-family="sans-serif">${i + 1}</text>`);
  });
  parts.push('</svg>');
  return parts.join('');
}

export interface IdentifyAiArgs {
  project: string;
  model?: string;
  out?: string;
}

export async function identifyAi(args: IdentifyAiArgs): Promise<void> {
  const dir = resolve(args.project);
  const outDir = args.out ? resolve(args.out) : dir;
  const fs = JSON.parse(await readFile(join(dir, 'factsheet.json'), 'utf8')) as MinimalFactSheet;
  if (fs.solve.status !== 'solved' || !fs.solve.wcs) {
    throw new Error('factsheet is not solved (need WCS for the AI feature pass)');
  }
  const wcs = fs.solve.wcs as Parameters<typeof pixelToWorld>[0];
  const w = fs.image.width;
  const h = fs.image.height;
  const ps = fs.solve.pixscale_arcsec ?? 1;
  const imagePath = join(dir, fs.image.src ?? 'image.jpg');
  const prim = fs.objects.find((o) => o.role === 'primary') ?? fs.objects[0];
  if (!prim || !prim.coord.pixel) throw new Error('no primary object with a pixel position');
  const [pcx, pcy] = prim.coord.pixel;
  const sizeMaj = prim.size_arcmin?.[0] ?? 60;

  // Visible-glow circle (image-measured) — a better extent than the catalog size.
  const sampler = await createLuminanceSampler(imagePath, w, h);
  const bg = estimateBackground(sampler, w, h);
  const win = Math.max(8, Math.round(Math.min(w, h) / 50));
  const catR = (sizeMaj * 60) / ps / 2;
  const visR = visibleRadiusPx([pcx, pcy], catR, sampler, bg, w, h, win);
  const r = visR > win ? visR : catR;

  const cw = w / COLS;
  const ch = h / ROWS;
  const annot = join(outDir, 'ai_grid.jpg');
  await sharp(imagePath)
    .composite([{ input: Buffer.from(gridSvg(w, h, cw, ch, pcx, pcy, r)), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toFile(annot);

  const name = prim.common_name?.zh ?? prim.common_name?.en ?? prim.names?.[0] ?? prim.designations?.[0] ?? 'this nebula';
  const typeLabel = `${prim.type?.zh ?? ''} / ${prim.type?.en ?? prim.category}`.trim();
  const prompt = buildPrompt(annot, name, typeLabel, prim.category);

  console.log(`[identify-ai] asking claude (${args.model ?? 'claude-opus-4-8'}) about ${name} …`);
  const raw = await runClaude({ prompt, model: args.model ?? 'claude-opus-4-8' });
  let feats: AiFeature[];
  try {
    const parsed = JSON.parse(extractJson(raw)) as unknown;
    feats = Array.isArray(parsed) ? (parsed as AiFeature[]) : [];
  } catch {
    throw new Error(`Could not parse AI JSON. Raw output:\n${raw.slice(0, 2000)}`);
  }

  const mapped = feats.map((f) => {
    const col = Math.max(0, LETTERS.indexOf((f.cell?.[0] ?? 'D').toUpperCase()));
    const row = Math.max(0, (parseInt(f.cell?.slice(1) ?? '3', 10) || 3) - 1);
    const [fx, fy] = f.pos ?? [0.5, 0.5];
    const px = Math.round((col + Math.min(1, Math.max(0, fx))) * cw);
    const py = Math.round((row + Math.min(1, Math.max(0, fy))) * ch);
    const world = pixelToWorld(wcs, px, py);
    return {
      ...f,
      pixel: [px, py] as [number, number],
      ra_deg: world ? world[0] : null,
      dec_deg: world ? world[1] : null,
    };
  });

  const overlay = join(outDir, 'ai_overlay.jpg');
  await sharp(imagePath)
    .composite([{ input: Buffer.from(overlaySvg(w, h, mapped, [pcx, pcy])), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toFile(overlay);
  await writeFile(join(outDir, 'ai_features.json'), JSON.stringify(mapped, null, 2) + '\n', 'utf8');

  console.log(`[identify-ai] ${mapped.length} feature(s) → ${overlay}`);
  for (const m of mapped) {
    console.log(`  ${m.type ?? '?'} @ ${m.cell ?? '?'} [${m.pixel[0]},${m.pixel[1]}]  ${m.label_zh ?? m.label_en ?? ''} — ${m.note ?? ''}`);
  }
}
