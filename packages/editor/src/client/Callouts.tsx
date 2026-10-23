import type * as React from 'react';
import type Konva from 'konva';
import { Circle as KCircle, Group, Line, Rect, Shape, Text } from 'react-konva';
import {
  COLOR_PALETTE,
  insetEdgePoint,
  type Callout,
  type Feature,
  type Reading,
} from '@astellum/schema';
import type { Action } from './state.js';

/**
 * The magnified insets, on the canvas the curator is working on.
 *
 * They are a property of the exported picture, not of the editing session — but
 * a curator who cannot see them until they export has to export to find out
 * whether an inset landed on the thing they were framing. Drawing them here
 * costs one layer and removes that round trip.
 *
 * Where they go is decided by `planCallouts` in the schema, the same call the
 * exporter makes, so what is on screen is what comes out — including after a
 * drag, which only writes the position back for that same planner to use.
 */

/** Map a point in the source image into an inset's own pixels. */
const into = (c: Callout, x: number, y: number): [number, number] => [
  c.inset.x + (x - c.crop.x) * c.scale,
  c.inset.y + (y - c.crop.y) * c.scale,
];

/**
 * The enlarged patch, with the surround held back.
 *
 * Hand-drawn on a canvas context because the effect is a composite one: dim
 * the panel, punch the named region out of the dimming, then slide the photo
 * in behind both. Konva has no mask, and `destination-out` on a shared canvas
 * would erase whatever else had been drawn there — so this lives on the
 * callout layer, which is its own canvas and holds nothing it could damage.
 */
function patchSceneFunc(
  c: Callout,
  f: Feature,
  image: HTMLImageElement,
  band: number,
): (ctx: Konva.Context) => void {
  return (ctx) => {
    const { x, y, w, h } = c.inset;
    const raw = ctx as unknown as CanvasRenderingContext2D;

    raw.save();
    raw.beginPath();
    raw.rect(x, y, w, h);
    raw.clip();

    raw.fillStyle = 'rgba(3,5,10,.4)';
    raw.fillRect(x, y, w, h);

    // The region keeps the picture; everything else keeps the wash.
    raw.globalCompositeOperation = 'destination-out';
    raw.beginPath();
    if (f.polygon?.length && (f.shape === 'polygon' || f.shape === 'polyline')) {
      f.polygon.forEach((p, i) => {
        const [px, py] = into(c, p[0], p[1]);
        if (i === 0) raw.moveTo(px, py);
        else raw.lineTo(px, py);
      });
      if (f.shape === 'polygon') {
        raw.closePath();
        raw.fillStyle = '#000';
        raw.fill();
      } else {
        raw.strokeStyle = '#000';
        raw.lineWidth = band * 2 * c.scale;
        raw.lineJoin = 'round';
        raw.lineCap = 'round';
        raw.stroke();
      }
    } else if (f.shape === 'arc' && f.arc) {
      const [ax, ay] = into(c, f.arc.cx, f.arc.cy);
      raw.arc(ax, ay, f.arc.r * c.scale, f.arc.a0, f.arc.a1);
      raw.strokeStyle = '#000';
      raw.lineWidth = band * 2 * c.scale;
      raw.lineCap = 'round';
      raw.stroke();
    } else {
      const [ax, ay] = into(c, f.circle.cx, f.circle.cy);
      raw.arc(ax, ay, f.circle.r * c.scale, 0, Math.PI * 2);
      raw.fillStyle = '#000';
      raw.fill();
    }

    // Behind both, so the hole shows the photograph rather than nothing.
    raw.globalCompositeOperation = 'destination-over';
    raw.drawImage(image, c.crop.x, c.crop.y, c.crop.w, c.crop.h, x, y, w, h);
    raw.restore();
  };
}

/** The contour, drawn again at the inset's scale. */
function Contour({
  c,
  f,
  strokeW,
}: {
  c: Callout;
  f: Feature;
  strokeW: number;
}): React.JSX.Element | null {
  const color = COLOR_PALETTE[f.color_key];
  if (!f.polygon?.length) return null;
  const points = f.polygon.flatMap((p) => into(c, p[0], p[1]));
  return f.shape === 'polyline' ? (
    <Line points={points} stroke={color.stroke} strokeWidth={strokeW} lineCap="round" lineJoin="round" />
  ) : (
    <Line
      points={points}
      closed
      stroke={color.stroke}
      strokeWidth={strokeW}
      dash={[strokeW * 4, strokeW * 3]}
      lineJoin="round"
    />
  );
}

export function Callouts({
  report,
  callouts,
  image,
  px,
  dispatch,
}: {
  report: Reading;
  callouts: Callout[];
  image: HTMLImageElement | null;
  /** Screen pixels → image pixels, so the frame holds its weight at any zoom. */
  px: (screen: number) => number;
  dispatch: (a: Action) => void;
}): React.JSX.Element | null {
  if (!callouts.length) return null;
  const { width, height } = report.image;
  const band = Math.max(4, Math.min(width, height) / 100);

  const pairs = callouts
    .map((c) => ({ c, f: report.features.find((x) => x.id === c.id) }))
    .filter((p): p is { c: Callout; f: Feature } => !!p.f);

  return (
    <>
      {/* The patches first, all of them: each one erases inside its own frame
          on the way to drawing itself, so nothing that has to survive may be
          underneath it yet. */}
      {image &&
        pairs.map(({ c, f }) => (
          <Shape key={`patch-${c.id}`} sceneFunc={patchSceneFunc(c, f, image, band)} listening={false} />
        ))}

      {pairs.map(({ c, f }) => {
        const color = COLOR_PALETTE[f.color_key];
        const e = insetEdgePoint(c.inset, c.anchor);
        const br = Math.min(c.inset.w, c.inset.h) * 0.09;
        return (
          <Group key={`chrome-${c.id}`}>
            <Line
              points={[c.anchor.x, c.anchor.y, e.x, e.y]}
              stroke={color.stroke}
              strokeWidth={px(1.5)}
              dash={[px(7), px(5)]}
              opacity={0.75}
              listening={false}
            />
            <Contour c={c} f={f} strokeW={px(2)} />
            {/* The whole panel is the handle, not just its border: a 2px
                stroke is the only thing Konva would hit-test without a fill,
                and asking someone to grab a hairline to move a panel is not a
                drag anyone would find. The fill is transparent to the eye and
                opaque to the hit graph. */}
            <Rect
              x={c.inset.x}
              y={c.inset.y}
              width={c.inset.w}
              height={c.inset.h}
              cornerRadius={px(6)}
              fill="rgba(0,0,0,0.001)"
              stroke={color.stroke}
              strokeWidth={px(2)}
              draggable
              onDragStart={() => dispatch({ type: 'beginChange' })}
              onDragMove={(ev) =>
                dispatch({
                  type: 'setCalloutPos',
                  id: c.id,
                  x: Math.round(ev.target.x()),
                  y: Math.round(ev.target.y()),
                  commit: false,
                })
              }
              onDragEnd={(ev) =>
                dispatch({
                  type: 'setCalloutPos',
                  id: c.id,
                  x: Math.round(ev.target.x()),
                  y: Math.round(ev.target.y()),
                })
              }
            />
            <KCircle
              x={c.inset.x + br * 1.4}
              y={c.inset.y + br * 1.4}
              radius={br}
              fill={color.badge}
              stroke="#0b0e14"
              strokeWidth={px(1)}
              listening={false}
            />
            <Text
              x={c.inset.x + br * 1.4 - br}
              y={c.inset.y + br * 1.4 - br * 0.55}
              width={br * 2}
              align="center"
              text={c.num}
              fontSize={br * 1.1}
              fontStyle="700"
              fill="#0b0e14"
              listening={false}
            />
          </Group>
        );
      })}
    </>
  );
}
