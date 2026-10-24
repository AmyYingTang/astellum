import type * as React from 'react';
import type Konva from 'konva';
import { Circle as KCircle, Group, Line, Rect, Shape, Text } from 'react-konva';
import {
  COLOR_PALETTE,
  LIFT,
  insetEdgePoint,
  raisedCrop,
  raisedPoint,
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

/** The same point, on the raised piece. */
const intoRaised = (c: Callout, f: Feature, x: number, y: number): [number, number] => {
  const [rx, ry] = raisedPoint(f, x, y);
  return into(c, rx, ry);
};

/** Trace the named region, in the inset's own pixels, as a canvas path. */
function tracePiece(ctx: CanvasRenderingContext2D, c: Callout, f: Feature, band: number): void {
  ctx.beginPath();
  if (f.polygon?.length && (f.shape === 'polygon' || f.shape === 'polyline')) {
    f.polygon.forEach((p, i) => {
      const [px, py] = intoRaised(c, f, p[0], p[1]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    if (f.shape === 'polygon') ctx.closePath();
    return;
  }
  if (f.shape === 'arc' && f.arc) {
    const [ax, ay] = intoRaised(c, f, f.arc.cx, f.arc.cy);
    const [ex] = intoRaised(c, f, f.arc.cx + f.arc.r, f.arc.cy);
    ctx.arc(ax, ay, Math.abs(ex - ax), f.arc.a0, f.arc.a1);
    return;
  }
  const [ax, ay] = intoRaised(c, f, f.circle.cx, f.circle.cy);
  const [ex] = intoRaised(c, f, f.circle.cx + f.circle.r, f.circle.cy);
  ctx.arc(ax, ay, Math.abs(ex - ax), 0, Math.PI * 2);
  void band;
}

/** An open line encloses nothing, so its region is a band along it. */
const isBand = (f: Feature): boolean => f.shape === 'polyline' || f.shape === 'arc';

/**
 * The piece, raised above the picture: a shadow onto what is below it and the
 * piece itself drawn a little larger, as a thing held nearer the eye is.
 *
 * Nothing fills the panel. The picture shows through, so a magnified mark
 * costs the viewer a box outline and the piece's own footprint rather than a
 * square of photograph painted over.
 *
 * Hand-drawn on a canvas context because Konva has no mask. Everything is
 * plain source-over painting — shadow, then piece — except the cut, which is
 * made offscreen.
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
    const lift = Math.max(3, Math.min(w, h) * LIFT.offsetShare);
    const blur = Math.max(2, Math.min(w, h) * LIFT.blurShare);
    const stroke = band * 2 * c.scale * LIFT.scale;

    raw.save();
    raw.beginPath();
    raw.rect(x, y, w, h);
    raw.clip();

    // Nothing fills the panel: the picture below goes on showing through it.

    // The shadow. The shape is painted solid only so that it casts one; the
    // piece lands on top of it a moment later.
    raw.save();
    raw.shadowColor = `rgba(0,0,0,${LIFT.shadowOpacity})`;
    raw.shadowBlur = blur;
    raw.shadowOffsetX = lift;
    raw.shadowOffsetY = lift;
    raw.fillStyle = '#05070c';
    raw.strokeStyle = '#05070c';
    raw.lineWidth = stroke;
    raw.lineJoin = 'round';
    raw.lineCap = 'round';
    tracePiece(raw, c, f, band);
    if (isBand(f)) raw.stroke();
    else raw.fill();
    raw.restore();

    // The piece: the same patch again, from a window smaller by exactly the
    // lift, so it comes out larger and still centred on the feature.
    //
    // Cut on a canvas of its own. `clip()` takes a path, and an open line
    // encloses no area — a rim or an arc would clip to nothing — so the region
    // is cut with `destination-in` instead, which works for a stroked band and
    // a filled contour alike. Offscreen, so that compositing mode has nothing
    // but this piece to act on.
    const r = raisedCrop(c, f);
    const cut = document.createElement('canvas');
    cut.width = Math.max(1, Math.round(w));
    cut.height = Math.max(1, Math.round(h));
    const cx = cut.getContext('2d');
    if (cx) {
      cx.drawImage(image, r.x, r.y, r.w, r.h, 0, 0, cut.width, cut.height);
      cx.globalCompositeOperation = 'destination-in';
      cx.translate(-x, -y); // the tracer speaks in the frame's coordinates
      cx.lineWidth = stroke;
      cx.lineJoin = 'round';
      cx.lineCap = 'round';
      cx.fillStyle = '#000';
      cx.strokeStyle = '#000';
      tracePiece(cx, c, f, band);
      if (isBand(f)) cx.stroke();
      else cx.fill();
      raw.drawImage(cut, x, y);
    }

    raw.restore();
  };
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
