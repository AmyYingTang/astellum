import { join } from 'node:path';
import { COLOR_PALETTE, type Feature, type Reading } from '@astellum/schema';
import { buildOverlaySvg } from './annotate.js';

function paragraphs(f: Feature, lang: 'zh' | 'en'): string[] {
  return [f.explanation[lang], f.physics?.[lang], f.interesting?.[lang]]
    .filter((s): s is string => !!s)
    .join('\n\n')
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type PosterLayout = 'portrait' | 'landscape';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const POSTER_STRINGS = {
  zh: {
    overview: '导读',
    features: '画面要点',
    facts: '冷知识',
    footer: 'astellum · 读图报告',
    stage: (n: number) => `阶段 ${n}`,
    distance: (ly: number) => `约 ${ly.toLocaleString()} 光年`,
    size: (am: number) => `视直径 ${am}′`,
  },
  en: {
    overview: 'Overview',
    features: 'Visual features',
    facts: 'Fun facts',
    footer: 'astellum · reading report',
    stage: (n: number) => `Stage ${n}`,
    distance: (ly: number) => `~${ly.toLocaleString()} light-years`,
    size: (am: number) => `angular size ${am}′`,
  },
} as const;

/** Static poster HTML: image + overlay + reading text. Responsive layout — the
 * viewport width chosen at screenshot time selects portrait vs landscape. */
export function buildPosterHtml(report: Reading, imageDataUri: string): string {
  const o = report.object;
  const lang = report.display_language;
  const s = POSTER_STRINGS[lang];

  const features = report.features
    .map((f) => {
      const c = COLOR_PALETTE[f.color_key];
      const body = paragraphs(f, lang).map((p) => `<p>${esc(p)}</p>`).join('');
      return `<li><span class="dot" style="background:${c.badge}">${esc(f.badge.num)}</span>
        <div><b>${esc(f.label[lang])}</b>${body}</div></li>`;
    })
    .join('');

  const facts = report.extra_facts.map((x) => `<li>${esc(x[lang])}</li>`).join('');

  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8">
<style>
  :root{--bg:#070a10;--text:#e6e9f0;--muted:#8a93a8;--line:#222b3d;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);color:var(--text);
    font-family:-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;}
  .root{max-width:1280px;margin:0 auto;padding:40px;}
  header{border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:28px;}
  h1{font-size:40px;margin:0;letter-spacing:1px;}
  .meta{color:var(--muted);margin-top:10px;font-size:15px;}
  .aliases{color:var(--muted);font-size:13px;margin-top:4px;}
  .poster{display:flex;gap:36px;align-items:flex-start;}
  .stage{flex:1 1 58%;min-width:0;position:relative;line-height:0;}
  .stage img{width:100%;border-radius:10px;display:block;box-shadow:0 10px 40px rgba(0,0,0,.5);}
  .stage svg{position:absolute;inset:0;width:100%;height:100%;}
  .panel{flex:1 1 42%;}
  .narrative{font-size:15px;line-height:1.85;color:#cfd6e4;margin:0 0 24px;}
  .label{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin:0 0 12px;}
  ul.features{list-style:none;margin:0 0 24px;padding:0;}
  ul.features li{display:flex;gap:12px;margin-bottom:16px;}
  .dot{flex-shrink:0;width:26px;height:26px;border-radius:50%;color:#070a10;font-weight:700;
    font-size:13px;display:flex;align-items:center;justify-content:center;}
  ul.features b{font-size:15px;}
  ul.features p{margin:4px 0 0;font-size:13.5px;line-height:1.7;color:#aeb6c6;}
  ul.facts{margin:0;padding-left:18px;color:#9aa5b8;font-size:13px;line-height:1.7;}
  footer{margin-top:32px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);
    font-size:12px;display:flex;justify-content:space-between;}
  @media (max-width:1000px){.root{padding:28px;}h1{font-size:32px;}.poster{flex-direction:column;}
    .stage,.panel{flex:1 1 100%;width:100%;}.panel{margin-top:8px;}}
</style></head><body>
<div class="root">
  <header><h1>${esc(o.name[lang])}</h1></header>
  <div class="poster">
    <div class="stage"><img src="${imageDataUri}" alt="${esc(
      o.name[lang],
    )}">${buildOverlaySvg(report, { imageHref: imageDataUri })}</div>
    <div class="panel">
      <p class="label">${s.overview}</p><p class="narrative">${esc(report.narrative[lang])}</p>
      <p class="label">${s.features}</p><ul class="features">${features}</ul>
      ${facts ? `<p class="label">${s.facts}</p><ul class="facts">${facts}</ul>` : ''}
    </div>
  </div>
  <footer><span>${s.footer}</span><span>${esc(report.generator.tool)} v${esc(report.generator.tool_version)}</span></footer>
</div></body></html>`;
}

const VIEWPORT: Record<PosterLayout, number> = { portrait: 820, landscape: 1280 };

export interface PosterBuffer {
  layout: PosterLayout;
  /** Suggested filename: `poster-<layout>.png`. */
  name: string;
  buffer: Buffer;
}

/** Render the poster PNG bytes per layout via Puppeteer. */
export async function renderPosterBuffers(opts: {
  report: Reading;
  imageDataUri: string;
  layouts?: PosterLayout[];
}): Promise<PosterBuffer[]> {
  const layouts = opts.layouts ?? ['portrait', 'landscape'];
  const html = buildPosterHtml(opts.report, opts.imageDataUri);

  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: true });
  const out: PosterBuffer[] = [];
  try {
    for (const layout of layouts) {
      const page = await browser.newPage();
      await page.setViewport({ width: VIEWPORT[layout], height: 800, deviceScaleFactor: 2 });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      // Puppeteer ≥ 22 returns a Uint8Array (not a Node Buffer); wrap so
      // `.toString('base64')` works.
      const shot = Buffer.from(await page.screenshot({ fullPage: true, type: 'png' }));
      await page.close();
      out.push({ layout, name: `poster-${layout}.png`, buffer: shot });
    }
  } finally {
    await browser.close();
  }
  return out;
}

export interface RenderPosterOptions {
  report: Reading;
  imageDataUri: string;
  outDir: string;
  layouts?: PosterLayout[];
}

/** Render poster PNG(s) and write them into outDir. */
export async function renderPoster(opts: RenderPosterOptions): Promise<string[]> {
  const buffers = await renderPosterBuffers({
    report: opts.report,
    imageDataUri: opts.imageDataUri,
    layouts: opts.layouts,
  });
  const { writeFile } = await import('node:fs/promises');
  const written: string[] = [];
  for (const b of buffers) {
    const outPath = join(opts.outDir, b.name);
    await writeFile(outPath, b.buffer);
    written.push(outPath);
  }
  return written;
}
