import type * as React from 'react';
import { useState } from 'react';
import { COLOR_PALETTE, type Feature, type Reading as ReadingData } from '@astellum/schema';

function paragraphs(f: Feature, lang: 'zh' | 'en'): string[] {
  return [f.explanation[lang], f.physics?.[lang], f.interesting?.[lang]]
    .filter((s): s is string => !!s)
    .join('\n\n')
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Class-B direction arrow: a line from (cx,cy) toward `to` with an arrowhead. */
function ArrowShape(props: {
  cx: number;
  cy: number;
  to: [number, number];
  stroke: string;
  strokeW: number;
}): React.JSX.Element {
  const { cx, cy, to, stroke, strokeW } = props;
  const [ax, ay] = to;
  const ang = Math.atan2(ay - cy, ax - cx);
  const hl = strokeW * 6;
  const p2 = `${ax - hl * Math.cos(ang - 0.4)},${ay - hl * Math.sin(ang - 0.4)}`;
  const p3 = `${ax - hl * Math.cos(ang + 0.4)},${ay - hl * Math.sin(ang + 0.4)}`;
  return (
    <g className="ar-arrow">
      <line x1={cx} y1={cy} x2={ax} y2={ay} stroke={stroke} strokeWidth={strokeW} />
      <polygon points={`${ax},${ay} ${p2} ${p3}`} fill={stroke} />
    </g>
  );
}

export interface ReadingProps {
  report: ReadingData;
  imageSrc: string;
  language?: 'zh' | 'en';
  onFeatureClick?: (feature: Feature) => void;
  className?: string;
}

export function Reading(props: ReadingProps): React.JSX.Element {
  const { report, imageSrc, onFeatureClick, className } = props;
  const [active, setActive] = useState<string | null>(null);
  const lang = props.language ?? report.display_language;
  const { width, height } = report.image;
  const strokeW = Math.max(2, Math.round(Math.min(width, height) / 300));
  const o = report.object;

  const meta = [o.type[lang], o.stage ? `Stage ${o.stage}` : null, o.constellation]
    .filter(Boolean)
    .join(' · ');

  const select = (f: Feature): void => {
    setActive((prev) => (prev === f.id ? null : f.id));
    onFeatureClick?.(f);
  };

  return (
    <div className={`astellum-reading${className ? ` ${className}` : ''}`}>
      <div className="ar-stage">
        <img src={imageSrc} alt={o.name[lang]} onClick={() => setActive(null)} />
        <svg className="ar-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          {report.features.map((f) => {
            if (f.draw === false) return null; // not drawn (e.g. coincident shell)
            const c = COLOR_PALETTE[f.color_key];
            const { cx, cy, r } = f.circle;
            const br = f.badge.bubble_r;
            const clamp = (v: number, lo: number, hi: number): number =>
              hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));
            const bx = clamp(cx + (r + br) * 0.7071 + f.badge.offset_x, br, width - br);
            const by = clamp(cy - (r + br) * 0.7071 + f.badge.offset_y, br, height - br);
            return (
              <g
                key={f.id}
                className={`ar-feat${active === f.id ? ' active' : ''}`}
                onMouseEnter={() => setActive(f.id)}
                onClick={() => select(f)}
              >
                {f.shape === 'arrow' && f.arrow_to ? (
                  <ArrowShape cx={cx} cy={cy} to={f.arrow_to} stroke={c.stroke} strokeW={strokeW} />
                ) : (
                  <circle
                    className="ar-circle"
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill="none"
                    stroke={c.stroke}
                    strokeWidth={strokeW}
                    strokeDasharray={f.shape === 'shell' ? `${strokeW * 5} ${strokeW * 3}` : undefined}
                  />
                )}
                <circle cx={bx} cy={by} r={f.badge.bubble_r} fill={c.badge} stroke="#0b0e14" strokeWidth={strokeW / 2} />
                <text
                  x={bx}
                  y={by}
                  fontSize={f.badge.bubble_r * 1.1}
                  fontWeight={700}
                  fill="#0b0e14"
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {f.badge.num}
                </text>
              </g>
            );
          })}
        </svg>
        {report.features.map((f) =>
          active === f.id && f.draw !== false ? (
            <div
              key={f.id}
              className="ar-tip"
              style={{
                left: `${(f.circle.cx / width) * 100}%`,
                top: `${(f.circle.cy / height) * 100}%`,
              }}
            >
              <b>
                {f.badge.num}. {f.label[lang]}
              </b>
              {paragraphs(f, lang).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          ) : null,
        )}
      </div>

      <div className="ar-panel">
        <h3>{o.name[lang]}</h3>
        <div className="ar-meta">{meta}</div>
        <p className="ar-narr">{report.narrative[lang]}</p>
        {report.features.map((f) =>
          f.draw === false ? null : (
          <div
            key={f.id}
            className={`ar-feature${active === f.id ? ' active' : ''}`}
            onClick={() => select(f)}
          >
            <span className="ar-dot" style={{ background: COLOR_PALETTE[f.color_key].badge }}>
              {f.badge.num}
            </span>
            <div>
              <b>{f.label[lang]}</b>
              {paragraphs(f, lang).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
