import sharp from 'sharp';
import { pixelToWorld, FEATURE_TAXONOMY, type FactSheet, type Wcs } from '@astellum/schema';
import { visibleRadiusPx } from './features.js';
import { createLuminanceSampler, estimateBackground } from './luminance.js';

/**
 * AI Class-B feature pass (experiment) — a VLM alternative to the deterministic CV
 * morphology. Given a solved factsheet + image, it overlays a labelled reference
 * grid + the nebula core/extent, feeds that plus the A-class prior (identity,
 * type, ionizing core) to Claude (via an injected `runClaude` — the `claude` CLI
 * vision), and asks for the visually prominent pillars / bright rims a human would
 * point to, including BRIGHT emission structures the dark-column CV can't see.
 *
 * `runClaude` is injected so this module needs no dependency on the reader (it's
 * the same pattern as the solve/catalog clients). Output is suggestion-only Class-B
 * FactObjects (`detection_source: 'ai'`); coordinates are coarse (the model sees
 * the image downscaled), so they're approximate markers to confirm/refine.
 */

const COLS = 8;
const ROWS = 6;
const LETTERS = 'ABCDEFGH';

export type RunClaudeFn = (opts: { prompt: string; model?: string }) => Promise<string>;

interface AiRaw {
  type?: string;
  label_zh?: string;
  label_en?: string;
  cell?: string;
  pos?: [number, number];
  toward_core?: boolean;
  note?: string;
}

function gridSvg(w: number, h: number, cw: number, ch: number, cx: number, cy: number, r: number): string {
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

/** Pull the first top-level JSON array out of the model's reply (tolerant of fences/prose). */
function extractArray(s: string): string {
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  return start >= 0 && end > start ? s.slice(start, end + 1) : '[]';
}

/**
 * Run the AI pass and return Class-B suggestion FactObjects (literals, validated
 * by FactSheet.parse downstream). Writes the grid-annotated image to `gridOutPath`
 * (so the caller can show "what the model saw").
 */
export async function runAiFeaturePass(
  factsheet: FactSheet,
  imagePath: string,
  gridOutPath: string,
  runClaude: RunClaudeFn,
  model = 'claude-opus-4-8',
): Promise<Array<Record<string, unknown>>> {
  const wcs = factsheet.solve.wcs as Wcs | undefined;
  if (factsheet.solve.status !== 'solved' || !wcs) {
    throw new Error('factsheet is not solved (need WCS for the AI feature pass)');
  }
  const w = factsheet.image.width;
  const h = factsheet.image.height;
  const ps = factsheet.solve.pixscale_arcsec ?? 1;
  const prim =
    factsheet.objects.find((o) => o.category === 'emission_nebula' && o.coord.pixel) ??
    factsheet.objects.find((o) => o.role === 'primary') ??
    factsheet.objects[0];
  if (!prim || !prim.coord.pixel) throw new Error('no primary object with a pixel position');
  const [pcx, pcy] = prim.coord.pixel;
  const sizeMaj = prim.size_arcmin?.[0] ?? 60;

  const sampler = await createLuminanceSampler(imagePath, w, h);
  const bg = estimateBackground(sampler, w, h);
  const win = Math.max(8, Math.round(Math.min(w, h) / 50));
  const catR = (sizeMaj * 60) / ps / 2;
  const visR = visibleRadiusPx([pcx, pcy], catR, sampler, bg, w, h, win);
  const r = visR > win ? visR : catR;

  const cw = w / COLS;
  const ch = h / ROWS;
  await sharp(imagePath)
    .composite([{ input: Buffer.from(gridSvg(w, h, cw, ch, pcx, pcy, r)), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toFile(gridOutPath);

  const name = prim.common_name?.zh ?? prim.common_name?.en ?? prim.names[0] ?? prim.designations[0] ?? 'this nebula';
  const typeLabel = `${prim.type.zh} / ${prim.type.en}`.trim();
  const raw = await runClaude({ prompt: buildPrompt(gridOutPath, name, typeLabel, prim.category), model });
  let feats: AiRaw[];
  try {
    const parsed = JSON.parse(extractArray(raw)) as unknown;
    feats = Array.isArray(parsed) ? (parsed as AiRaw[]) : [];
  } catch {
    throw new Error(`Could not parse AI JSON. Raw output:\n${raw.slice(0, 1500)}`);
  }

  const armPx = Math.min(Math.max(0.04 * Math.min(w, h), 40), 200);
  return feats.map((f, k) => {
    const col = Math.max(0, LETTERS.indexOf((f.cell?.[0] ?? 'D').toUpperCase()));
    const row = Math.max(0, (parseInt(f.cell?.slice(1) ?? '3', 10) || 3) - 1);
    const [fx, fy] = f.pos ?? [0.5, 0.5];
    const px = Math.round((col + Math.min(1, Math.max(0, fx))) * cw);
    const py = Math.round((row + Math.min(1, Math.max(0, fy))) * ch);
    const world = pixelToWorld(wcs, px, py);
    const ft = f.type === 'bright_rim' ? 'ionization_front' : 'pillar';
    const tax = FEATURE_TAXONOMY[ft];
    const zh = f.label_zh ?? tax.zh;
    const en = f.label_en ?? tax.en;
    let arrow_to: { ra_deg: number; dec_deg: number; pixel: [number, number] } | undefined;
    if (f.toward_core) {
      const dx = pcx - px;
      const dy = pcy - py;
      const d = Math.hypot(dx, dy) || 1;
      const tx = Math.round(px + (dx / d) * armPx);
      const ty = Math.round(py + (dy / d) * armPx);
      const tw = pixelToWorld(wcs, tx, ty);
      arrow_to = {
        ra_deg: tw ? tw[0] : world ? world[0] : 0,
        dec_deg: tw ? tw[1] : world ? world[1] : 0,
        pixel: [tx, ty],
      };
    }
    return {
      id: `ai${k + 1}`,
      role: 'context',
      tier: 'B',
      parent_object_id: prim.id,
      feature_type: ft,
      feature_class: 'B-visual',
      names: [`${zh} / ${en}`],
      designations: [],
      category: 'emission_nebula',
      type: { otype: '', zh, en, source: 'ai' },
      coord: { ra_deg: world ? world[0] : 0, dec_deg: world ? world[1] : 0, pixel: [px, py] },
      ...(arrow_to ? { arrow_to } : {}),
      catalog_ids: {},
      confidence: 0.6,
      localization: { method: 'none', confidence: 0.4 },
      detection_source: 'ai',
      needs_human_review: true,
    };
  });
}
