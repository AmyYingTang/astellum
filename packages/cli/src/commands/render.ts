import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname, join, basename, extname } from 'node:path';
import { Reading } from '@astellum/schema';
import { renderAnnotated, generateEmbedHtml, renderPoster } from '@astellum/renderer';

const FORMATS = ['annotated', 'embed', 'poster', 'all'] as const;
type Format = (typeof FORMATS)[number];

export interface RenderArgs {
  report: string;
  format: string;
  out?: string;
}

/** Filesystem-safe stem from an object name: drop spaces (so "NGC 3372" →
 * "NGC3372"), keep hyphens (so "Sh2-308" stays intact), neutralize unsafe
 * chars. Falls back to "report" if nothing usable remains. */
function slugifyName(name: string): string {
  const cleaned = name
    .replace(/[/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, '')
    .replace(/^[.-]+|[.-]+$/g, '');
  return cleaned || 'report';
}

async function imageToDataUri(path: string): Promise<string> {
  const mime = extname(path).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  const buf = await readFile(path);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export async function renderReport(args: RenderArgs): Promise<void> {
  if (!FORMATS.includes(args.format as Format)) {
    throw new Error(`Unknown --format "${args.format}" (expected: ${FORMATS.join(' | ')})`);
  }
  const fmt = args.format as Format;
  const want = (f: Format): boolean => fmt === 'all' || fmt === f;

  const reportPath = resolve(args.report);
  const rawReport = await readFile(reportPath, 'utf8');
  const report = Reading.parse(JSON.parse(rawReport));
  const reportDir = dirname(reportPath);
  const imagePath = resolve(reportDir, report.image.src);
  const outDir = args.out ? resolve(args.out) : reportDir;
  await mkdir(outDir, { recursive: true });

  const written: string[] = [];
  const slug = slugifyName(report.object.name.en || report.object.name.zh);

  // Carry the full reading.json alongside the rendered image so downstream
  // consumers (e.g. the gallery site) have the structured metadata — color_key
  // per feature, object info, labels — and don't have to guess from pixels.
  const reportOut = join(outDir, `${slug}.json`);
  if (reportOut !== reportPath) {
    await writeFile(reportOut, rawReport, 'utf8');
    written.push(reportOut);
  }

  if (want('annotated')) {
    const out = join(outDir, `${slug}_annotated.jpg`);
    await renderAnnotated({ report, imagePath, outPath: out });
    written.push(out);
  }

  const dataUri = want('embed') || want('poster') ? await imageToDataUri(imagePath) : '';

  if (want('embed')) {
    const out = join(outDir, `${slug}_embed.html`);
    await writeFile(out, generateEmbedHtml(report, { imageDataUri: dataUri }), 'utf8');
    written.push(out);
  }

  if (want('poster')) {
    for (const p of await renderPoster({ report, imageDataUri: dataUri, outDir })) {
      const named = join(dirname(p), `${slug}_${basename(p)}`);
      await rename(p, named);
      written.push(named);
    }
  }

  for (const w of written) console.log(`Wrote ${w}`);
}
