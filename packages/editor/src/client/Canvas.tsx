import type * as React from 'react';
import { memo, useEffect, useRef, useState } from 'react';
import {
  Stage,
  Layer,
  Image as KImage,
  Circle as KCircle,
  Arc as KArc,
  Group,
  Text,
  Line,
  Rect,
  Arrow,
} from 'react-konva';
import type Konva from 'konva';
import {
  COLOR_PALETTE,
  badgeAnchor,
  fieldRadiusDeg,
  formatRaHm,
  formatDecDm,
  planCallouts,
  worldToPixel,
  type Reading,
  type Wcs,
} from '@astellum/schema';
import type { Action } from './state.js';
import { Callouts } from './Callouts.js';

/** Round a raw degree step to a "nice" value, aiming for ~12 lines across the field. */
function niceStep(radius: number): number {
  const raw = (2 * radius) / 12;
  const nice = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5];
  return nice.reduce((best, v) => (Math.abs(v - raw) < Math.abs(best - raw) ? v : best), nice[0]!);
}

interface GridLabel {
  x: number;
  y: number;
  text: string;
  /** true → RA label, centered on the vertical line; false → Dec label, beside the left edge. */
  center: boolean;
  /** for RA labels: whether anchored at the top edge (vs bottom). */
  top: boolean;
}

/** RA/Dec debug grid lines + labels, in image-pixel coordinates. */
function buildGrid(w: Wcs): { lines: number[][]; labels: GridLabel[] } {
  const radius = fieldRadiusDeg(w);
  const step = niceStep(radius);
  const cosd = Math.max(0.05, Math.cos((w.dec0_deg * Math.PI) / 180));
  const decMin = w.dec0_deg - radius;
  const decMax = w.dec0_deg + radius;
  const raMin = w.ra0_deg - radius / cosd;
  const raMax = w.ra0_deg + radius / cosd;
  const lines: number[][] = [];
  const labels: GridLabel[] = [];
  const inFrame = (p: [number, number]): boolean =>
    p[0] >= 0 && p[0] <= w.width && p[1] >= 0 && p[1] <= w.height;
  const N = 48;

  // Dec lines (constant δ): label at the left edge (min-x in-frame point).
  for (let dec = Math.ceil(decMin / step) * step; dec <= decMax + 1e-9; dec += step) {
    const pts: number[] = [];
    let label: [number, number] | null = null;
    for (let i = 0; i <= N; i++) {
      const p = worldToPixel(w, raMin + ((raMax - raMin) * i) / N, dec);
      if (p) {
        pts.push(p[0], p[1]);
        if (inFrame(p) && (!label || p[0] < label[0])) label = p;
      }
    }
    if (pts.length >= 4) {
      lines.push(pts);
      if (label) labels.push({ x: label[0], y: label[1], text: `Dec ${formatDecDm(dec)}`, center: false, top: true });
    }
  }
  // RA lines (constant α): label alternately at the top / bottom edge so the
  // labels don't crowd a single edge.
  let raIdx = 0;
  for (let ra = Math.ceil(raMin / step) * step; ra <= raMax + 1e-9; ra += step) {
    const pts: number[] = [];
    let top: [number, number] | null = null; // min-y in-frame point
    let bottom: [number, number] | null = null; // max-y in-frame point
    for (let i = 0; i <= N; i++) {
      const p = worldToPixel(w, ra, decMin + ((decMax - decMin) * i) / N);
      if (p) {
        pts.push(p[0], p[1]);
        if (inFrame(p)) {
          if (!top || p[1] < top[1]) top = p;
          if (!bottom || p[1] > bottom[1]) bottom = p;
        }
      }
    }
    if (pts.length >= 4) {
      lines.push(pts);
      const useTop = raIdx % 2 === 0;
      const lp = useTop ? top : bottom;
      if (lp) {
        labels.push({ x: lp[0], y: lp[1], text: `RA ${formatRaHm(ra)}`, center: true, top: useTop });
      }
      raIdx += 1;
    }
  }
  return { lines, labels };
}

function useImage(src: string): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const image = new window.Image();
    image.onload = () => setImg(image);
    image.src = src;
    return () => {
      image.onload = null;
    };
  }, [src]);
  return img;
}

/**
 * The name plate. A copy of `LABEL_PLATE` in the renderer's overlayLabel.ts,
 * which the browser cannot import — change the two together.
 */
const PLATE = {
  fill: '#080b12',
  opacity: 0.9,
  text: '#f2f5fb',
  padX: 0.4,
  height: 1.5,
  radius: 0.3,
} as const;

let measureCtx: CanvasRenderingContext2D | null = null;
/** Measured here, where the export can only estimate: a browser can ask. */
function textWidth(text: string, fontSize: number): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * fontSize * 0.6;
  measureCtx.font = `700 ${fontSize}px sans-serif`;
  return measureCtx.measureText(text).width;
}

function useSize(): [React.RefObject<HTMLDivElement>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]!.contentRect;
      // Round to avoid sub-pixel feedback loops with the observer.
      setSize((prev) => {
        const w = Math.round(r.width);
        const h = Math.round(r.height);
        return prev.w === w && prev.h === h ? prev : { w, h };
      });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}


/**
 * How far in, and where. `k` multiplies the fit-to-box scale (1 = the whole
 * picture); `x`/`y` are the stage's offset as fractions of the box, so the
 * view means the same thing whatever size the box is. Held by the page, so
 * its buttons and the wheel here move the same view.
 */
export interface View {
  k: number;
  x: number;
  y: number;
}
export const FIT: View = { k: 1, x: 0, y: 0 };
export const MAX_ZOOM = 8;

/** Keep the picture covering the box: no panning off into empty space. */
export function clampView(v: View): View {
  const k = Math.min(MAX_ZOOM, Math.max(1, v.k));
  return {
    k,
    x: Math.min(0, Math.max(1 - k, v.x)),
    y: Math.min(0, Math.max(1 - k, v.y)),
  };
}

/** Zoom by `factor` keeping the point (fx, fy) — fractions of the box — where it is. */
export function zoomAt(v: View, factor: number, fx = 0.5, fy = 0.5): View {
  const k = Math.min(MAX_ZOOM, Math.max(1, v.k * factor));
  const r = k / v.k;
  return clampView({ k, x: fx - (fx - v.x) * r, y: fy - (fy - v.y) * r });
}

interface Props {
  report: Reading;
  selectedId: string | null;
  dispatch: React.Dispatch<Action>;
  imageUrl: string;
  style?: React.CSSProperties;
  gridWcs?: Wcs | null;
  /** Its switch lives in the preview's header, out of the picture. */
  showGrid?: boolean;
  /** The language names are drawn in. */
  lang: 'zh' | 'en';
  view: View;
  onView: React.Dispatch<React.SetStateAction<View>>;
  /** Whether a plain wheel zooms. Where the page itself scrolls (the posters)
   *  only a pinch or ⌘/Ctrl+wheel does, so scrolling the page still works. */
  wheelZooms: boolean;
}

/**
 * Memoised: everything else on the page re-renders on every fold and keystroke
 * in the edit column, and none of that changes the picture — redrawing a
 * multi-megapixel photograph and its insets for it is the cost to avoid.
 */
export const Canvas = memo(function Canvas({
  report,
  selectedId,
  dispatch,
  imageUrl,
  style,
  gridWcs,
  showGrid,
  lang,
  view,
  onView,
  wheelZooms,
}: Props): React.JSX.Element {
  const img = useImage(imageUrl);
  const [ref, { w: containerW, h: containerH }] = useSize();
  const grid = showGrid && gridWcs ? buildGrid(gridWcs) : null;
  const { width, height } = report.image;
  // What the export will draw, drawn here too. Recomputed on every render
  // because the shapes move while a curator works, and an inset pointing at
  // where a pillar used to be is worse than none.
  const callouts = planCallouts(report);
  // Fit the image fully within the container so it never overflows (which
  // would trigger a scrollbar and a ResizeObserver feedback loop).
  const fit = Math.min(containerW / width, containerH / height) || 1;
  const stageW = width * fit;
  const stageH = height * fit;
  // The box stays the fitted picture's size; zooming scales what is inside it.
  const v = clampView(view);
  const scale = fit * v.k;
  const px = (screen: number): number => screen / scale; // screen px -> image px
  // Line weights in image pixels, as annotate.ts draws them, so the canvas
  // shows the weight the export will have rather than a fixed screen hairline.
  const strokeW = Math.max(2, Math.round(Math.min(width, height) / 300));
  const fineW = Math.max(1, Math.round(strokeW * 0.8)); // rims and outlines

  return (
    <div className="canvas" ref={ref} style={style}>
      <Stage
        width={stageW}
        height={stageH}
        scaleX={scale}
        scaleY={scale}
        x={v.x * stageW}
        y={v.y * stageH}
        // Zoomed in, empty sky pans; marks keep their own drag. A click (not a
        // pan) on empty sky still deselects — Konva only calls it a click when
        // the pointer did not move.
        draggable={v.k > 1}
        dragBoundFunc={(p) => {
          const c = clampView({ k: v.k, x: p.x / stageW, y: p.y / stageH });
          return { x: c.x * stageW, y: c.y * stageH };
        }}
        onDragEnd={(e) => {
          if (e.target === e.target.getStage())
            onView({ k: v.k, x: e.target.x() / stageW, y: e.target.y() / stageH });
        }}
        onWheel={(e) => {
          const ev = e.evt;
          // A trackpad pinch arrives as a wheel with ctrlKey set.
          if (!wheelZooms && !ev.ctrlKey && !ev.metaKey) return;
          ev.preventDefault();
          const stage = e.target.getStage();
          const p = stage?.getPointerPosition();
          if (!p) return;
          onView(zoomAt(v, Math.exp(-ev.deltaY * 0.0025), p.x / stageW, p.y / stageH));
        }}
        onClick={(e) => {
          if (e.target === e.target.getStage()) dispatch({ type: 'select', id: null });
        }}
        onTap={(e) => {
          if (e.target === e.target.getStage()) dispatch({ type: 'select', id: null });
        }}
        // Say what can be moved before anyone tries: a pointer that changes
        // over a number, a ring or an inset is the hint that needs no reading.
        onMouseMove={(e) => {
          const n = e.target;
          const stage = n.getStage();
          if (!stage) return;
          const movable = n !== stage && (n.draggable() || !!n.getParent()?.draggable());
          stage.container().style.cursor =
            n.name() === 'resize'
              ? 'nwse-resize'
              : movable
                ? 'move'
                : n === stage && v.k > 1
                  ? 'grab'
                  : 'default';
        }}
      >
        <Layer>{img && <KImage image={img} width={width} height={height} listening={false} />}</Layer>
        {grid && (
          <Layer listening={false}>
            {grid.lines.map((pts, i) => (
              <Line key={i} points={pts} stroke="#6fb1ff" strokeWidth={px(1)} opacity={0.35} />
            ))}
            {grid.labels.map((lb, i) => {
              const fs = px(12);
              const lw = px(78);
              return (
                <Text
                  key={i}
                  text={lb.text}
                  // RA: centered on the vertical line; Dec: beside the left edge.
                  x={lb.center ? lb.x - lw / 2 : lb.x + px(4)}
                  y={lb.center ? (lb.top ? lb.y + px(2) : lb.y - fs - px(2)) : lb.y - fs / 2}
                  width={lb.center ? lw : undefined}
                  align={lb.center ? 'center' : 'left'}
                  fontSize={fs}
                  fill="#9fc6ff"
                  opacity={0.9}
                />
              );
            })}
          </Layer>
        )}
        <Layer>
          {report.features.map((f) => {
            if (f.draw === false) return null; // listed in Facts, not drawn (e.g. coincident shell)
            const color = COLOR_PALETTE[f.color_key];
            const { cx, cy, r } = f.circle;
            const selected = f.id === selectedId;
            // The same origin every renderer uses, so a stored offset puts the
            // number where the export will — a rim rule of our own drew
            // polygons' numbers somewhere the frame never shows them.
            const [anchorX, anchorY] = badgeAnchor(f, f.badge.bubble_r);
            // Keep the whole badge inside the image, even when the circle's edge
            // would push it off-frame (a big circle near an edge).
            const br = f.badge.bubble_r;
            const clamp = (v: number, lo: number, hi: number): number =>
              hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));
            const bx = clamp(anchorX + f.badge.offset_x, br, width - br);
            const by = clamp(anchorY + f.badge.offset_y, br, height - br);
            const fontSize = f.badge.bubble_r * 1.1;

            return (
              <Group key={f.id}>
                {f.shape === 'arc' && f.arc ? (
                  // Class-B ionization front: a curved arc along the nebula rim.
                  // Drawn as a thin ring sector; the badge moves, the arc doesn't.
                  <KArc
                    x={f.arc.cx}
                    y={f.arc.cy}
                    innerRadius={f.arc.r - px(selected ? 4 : 3)}
                    outerRadius={f.arc.r + px(selected ? 4 : 3)}
                    angle={((f.arc.a1 - f.arc.a0) * 180) / Math.PI}
                    rotation={(f.arc.a0 * 180) / Math.PI}
                    fill={color.stroke}
                    opacity={selected ? 1 : 0.85}
                    onClick={() => dispatch({ type: 'select', id: f.id })}
                    onTap={() => dispatch({ type: 'select', id: f.id })}
                  />
                ) : f.shape === 'dot' ? (
                  // Comet nucleus: a small filled dot at centre; its badge anchors
                  // at f.circle.r (the coma radius) so the label clears the coma.
                  <KCircle
                    x={cx}
                    y={cy}
                    radius={px(7)}
                    fill={color.stroke}
                    stroke="#0b0e14"
                    strokeWidth={px(1)}
                    opacity={selected ? 1 : 0.9}
                    onClick={() => dispatch({ type: 'select', id: f.id })}
                    onTap={() => dispatch({ type: 'select', id: f.id })}
                  />
                ) : f.shape === 'arrow' && f.arrow_to ? (
                  // Class-B direction arrow (e.g. ionization front: bright rim
                  // faces this way). Non-draggable for now; the badge moves.
                  <Arrow
                    points={[cx, cy, f.arrow_to[0], f.arrow_to[1]]}
                    stroke={color.stroke}
                    fill={color.stroke}
                    strokeWidth={px(selected ? 4 : 3)}
                    pointerLength={px(16)}
                    pointerWidth={px(13)}
                    opacity={selected ? 1 : 0.85}
                    onClick={() => dispatch({ type: 'select', id: f.id })}
                    onTap={() => dispatch({ type: 'select', id: f.id })}
                  />
                ) : f.shape === 'polyline' && f.polygon ? (
                  // A pillar's bright rim: a thin open line (its own colour/label
                  // distinguishes it from the dashed column outline).
                  <Line
                    points={f.polygon.flatMap((p) => [p[0], p[1]])}
                    stroke={color.stroke}
                    strokeWidth={selected ? fineW * 1.5 : fineW}
                    lineCap="round"
                    lineJoin="round"
                    opacity={selected ? 1 : 0.85}
                    onClick={() => dispatch({ type: 'select', id: f.id })}
                    onTap={() => dispatch({ type: 'select', id: f.id })}
                  />
                ) : f.shape === 'polygon' && f.polygon ? (
                  // Class-B morphology suggestion (pillar): a soft dotted contour,
                  // as fine as a rim line, + the 迎光 illumination arrow.
                  // Dots as annotate.ts makes them: zero-length dashes, round caps.
                  <>
                    <Line
                      points={f.polygon.flatMap((p) => [p[0], p[1]])}
                      closed
                      stroke={color.stroke}
                      strokeWidth={selected ? fineW * 1.5 : fineW}
                      dash={[0.01, fineW * 2.2]}
                      lineCap="round"
                      opacity={selected ? 1 : 0.85}
                      lineJoin="round"
                      onClick={() => dispatch({ type: 'select', id: f.id })}
                      onTap={() => dispatch({ type: 'select', id: f.id })}
                    />
                    {f.arrow_to && (
                      <Arrow
                        points={[cx, cy, f.arrow_to[0], f.arrow_to[1]]}
                        stroke={color.stroke}
                        fill={color.stroke}
                        strokeWidth={px(selected ? 3 : 2)}
                        pointerLength={px(12)}
                        pointerWidth={px(10)}
                        opacity={selected ? 1 : 0.85}
                      />
                    )}
                  </>
                ) : f.shape === 'field' ? null : (
                  // A-class solid ring, or a Class-B shell sample — a small
                  // dotted circle dropped on a point of the shell's rim. Both
                  // draggable + resizable.
                  <KCircle
                    x={cx}
                    y={cy}
                    radius={r}
                    stroke={color.stroke}
                    strokeWidth={(f.shape === 'shell' ? fineW : strokeW) * (selected ? 1.5 : 1)}
                    opacity={selected ? 1 : 0.75}
                    dash={f.shape === 'shell' ? [0.01, fineW * 2.2] : undefined}
                    lineCap="round"
                    draggable
                    onClick={() => dispatch({ type: 'select', id: f.id })}
                    onTap={() => dispatch({ type: 'select', id: f.id })}
                    onDragStart={() => {
                      dispatch({ type: 'select', id: f.id });
                      dispatch({ type: 'beginChange' });
                    }}
                    onDragMove={(e) =>
                      dispatch({
                        type: 'setCircle',
                        id: f.id,
                        circle: { cx: e.target.x(), cy: e.target.y(), r },
                        commit: false,
                      })
                    }
                  />
                )}

                {selected &&
                  f.shape !== 'arrow' &&
                  f.shape !== 'arc' &&
                  f.shape !== 'dot' &&
                  f.shape !== 'field' &&
                  f.shape !== 'polygon' &&
                  f.shape !== 'polyline' && (
                  <KCircle
                    x={cx + r}
                    y={cy}
                    radius={px(6)}
                    fill={color.stroke}
                    stroke="#0b0e14"
                    strokeWidth={px(1)}
                    name="resize"
                    draggable
                    onDragStart={() => dispatch({ type: 'beginChange' })}
                    onDragMove={(e) => {
                      const nr = Math.max(4, Math.hypot(e.target.x() - cx, e.target.y() - cy));
                      dispatch({
                        type: 'setCircle',
                        id: f.id,
                        circle: { cx, cy, r: Math.round(nr) },
                        commit: false,
                      });
                    }}
                  />
                )}

                <Group
                  x={bx}
                  y={by}
                  draggable
                  onClick={() => dispatch({ type: 'select', id: f.id })}
                  onTap={() => dispatch({ type: 'select', id: f.id })}
                  onDragStart={() => {
                    dispatch({ type: 'select', id: f.id });
                    dispatch({ type: 'beginChange' });
                  }}
                  onDragMove={(e: Konva.KonvaEventObject<DragEvent>) =>
                    dispatch({
                      type: 'setBadgeOffset',
                      id: f.id,
                      offset_x: Math.round(e.target.x() - anchorX),
                      offset_y: Math.round(e.target.y() - anchorY),
                      commit: false,
                    })
                  }
                >
                  <KCircle
                    radius={f.badge.bubble_r}
                    fill={color.badge}
                    stroke="#0b0e14"
                    strokeWidth={px(selected ? 2 : 1)}
                  />
                  <Text
                    text={f.badge.num}
                    fontSize={fontSize}
                    fontStyle="700"
                    fill="#0b0e14"
                    width={f.badge.bubble_r * 2}
                    height={f.badge.bubble_r * 2}
                    x={-f.badge.bubble_r}
                    y={-f.badge.bubble_r}
                    align="center"
                    verticalAlign="middle"
                    listening={false}
                  />
                  {/* The name beside the number, on the plate `overlayLabel`
                      writes into the export, sized and sided the same way, so
                      the studio shows what the frame will carry. In the page's
                      language, which is the one the export is asked for. */}
                  {(() => {
                    const name = f.label[lang].trim();
                    if (!name) return null;
                    const fs = Math.round(br * 0.95);
                    const gap = br * 1.5;
                    const onLeft = bx > width * 0.66;
                    const w = textWidth(name, fs) + PLATE.padX * 2 * fs;
                    const h = PLATE.height * fs;
                    return (
                      <Group x={onLeft ? -gap - w : gap} y={-h / 2} listening={false}>
                        <Rect
                          width={w}
                          height={h}
                          cornerRadius={fs * PLATE.radius}
                          fill={PLATE.fill}
                          opacity={PLATE.opacity}
                        />
                        <Text
                          text={name}
                          fontSize={fs}
                          fontFamily="sans-serif"
                          fontStyle="700"
                          fill={PLATE.text}
                          width={w}
                          height={h}
                          align="center"
                          verticalAlign="middle"
                          wrap="none"
                        />
                      </Group>
                    );
                  })()}
                </Group>
              </Group>
            );
          })}
        </Layer>
        {/* Over the marks: an inset is a panel laid on the picture, and a mark
            drawn across one would read as part of what it shows. */}
        <Layer>
          <Callouts report={report} callouts={callouts} image={img} px={px} dispatch={dispatch} />
        </Layer>
      </Stage>
    </div>
  );
});
