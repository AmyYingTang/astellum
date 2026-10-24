import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { COLOR_PALETTE, type Feature, type Reading } from '@astellum/schema';

/** What the preview shows, and so what the export button writes. */
export type PreviewFormat = 'annotated' | 'landscape' | 'portrait';

/**
 * The poster's own headings. A copy of `POSTER_STRINGS` in the renderer's
 * poster.ts, which the browser cannot import (it is a Node module) — change the
 * two together, or the preview stops being what the PNG says.
 */
const POSTER_STRINGS = {
  zh: { overview: '导读', features: '画面要点', facts: '冷知识', footer: 'astellum · 读图报告' },
  en: {
    overview: 'Overview',
    features: 'Visual features',
    facts: 'Fun facts',
    footer: 'astellum · reading report',
  },
} as const;

/** The viewport widths `renderPosterBuffers` screenshots at. */
const POSTER_WIDTH: Record<'landscape' | 'portrait', number> = { landscape: 1280, portrait: 820 };

function paragraphs(f: Feature, lang: 'zh' | 'en'): string[] {
  return [f.explanation[lang], f.physics?.[lang], f.interesting?.[lang]]
    .filter((s): s is string => !!s)
    .join('\n\n')
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The page as it will be exported.
 *
 * `annotated` is the canvas alone. The two posters lay the same canvas out the
 * way poster.ts does, at the width Puppeteer renders them, and scale the whole
 * page down to fit — so a line that wraps here wraps there. The canvas stays
 * live inside it (Konva reads the CSS scale back off its bounding box), which
 * is the point of drawing it here rather than showing the server's HTML.
 *
 * Text is in the page's language, and export is asked for that same one —
 * switching language switches what will be written.
 */
export function PosterPreview({
  report,
  format,
  canvas,
  lang,
}: {
  report: Reading;
  format: PreviewFormat;
  lang: 'zh' | 'en';
  /** The editable canvas, filling whatever box it is given. */
  canvas: React.ReactNode;
}): React.JSX.Element {
  if (format === 'annotated') return <div className="pp-annotated">{canvas}</div>;
  return <ScaledPoster report={report} layout={format} canvas={canvas} lang={lang} />;
}

function ScaledPoster({
  report,
  layout,
  canvas,
  lang,
}: {
  report: Reading;
  layout: 'landscape' | 'portrait';
  canvas: React.ReactNode;
  lang: 'zh' | 'en';
}): React.JSX.Element {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, h: 0 });
  const pageW = POSTER_WIDTH[layout];

  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = (): void => {
      const scale = Math.min(1, o.clientWidth / pageW);
      const h = Math.round(i.offsetHeight * scale);
      setFit((prev) => (prev.scale === scale && prev.h === h ? prev : { scale, h }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    measure();
    return () => ro.disconnect();
  }, [pageW]);

  const s = POSTER_STRINGS[lang];
  const { width, height } = report.image;

  return (
    <div className="pp-fit" ref={outer} style={{ height: fit.h || undefined }}>
      <div
        ref={inner}
        className={`pp pp-${layout}`}
        style={{ width: pageW, transform: `scale(${fit.scale})` }}
      >
        <header>
          <h1>{report.object.name[lang]}</h1>
        </header>
        <div className="pp-poster">
          <div className="pp-stage" style={{ aspectRatio: `${width} / ${height}` }}>
            {canvas}
          </div>
          <div className="pp-panel">
            <p className="pp-label">{s.overview}</p>
            <p className="pp-narrative">{report.narrative[lang]}</p>
            <p className="pp-label">{s.features}</p>
            <ul className="pp-features">
              {report.features.map((f) => (
                <li key={f.id}>
                  <span className="pp-dot" style={{ background: COLOR_PALETTE[f.color_key].badge }}>
                    {f.badge.num}
                  </span>
                  <div>
                    <b>{f.label[lang]}</b>
                    {paragraphs(f, lang).map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            {report.extra_facts.length > 0 && (
              <>
                <p className="pp-label">{s.facts}</p>
                <ul className="pp-facts">
                  {report.extra_facts.map((x, i) => (
                    <li key={i}>{x[lang]}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
        <footer>
          <span>{s.footer}</span>
          <span>
            {report.generator.tool} v{report.generator.tool_version}
          </span>
        </footer>
      </div>
    </div>
  );
}
