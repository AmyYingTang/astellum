import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Group, Image as KImage, Line, Circle, Text } from 'react-konva';
import type Konva from 'konva';
import type { GeometryType } from '../atlas.js';

export interface Shape {
  id: string;
  type: GeometryType;
  verticesPx: [number, number][];
  color: string;
  closed: boolean;
  label: string;
}

interface CanvasProps {
  imageSrc: string;
  imgWidth: number;
  imgHeight: number;
  /** Drawing = clicks place vertices; not drawing = drag to pan. Wheel zooms in both. */
  drawing: boolean;
  /** Show the on-shape × delete handles (edit mode only, not in read-only preview). */
  allowDelete: boolean;
  /** Committed shapes (already-added annotations), in image px. */
  shapes: Shape[];
  /** In-progress shape being drawn. */
  draft: { verticesPx: [number, number][]; type: GeometryType; color: string } | null;
  /** Id of the shape currently open for geometry editing (drag vertices / whole shape),
   *  or null. Selection is driven from the annotation list, not canvas clicks, so it
   *  can't be confused with pan or draw. */
  editShapeId?: string | null;
  onAddPoint: (x: number, y: number) => void;
  onDeleteShape: (id: string) => void;
  /** Commit a geometry edit: the shape's full new vertex list, in image px. */
  onEditShape?: (id: string, verticesPx: [number, number][]) => void;
}

function useHtmlImage(src: string): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const im = new window.Image();
    im.crossOrigin = 'anonymous';
    im.src = src;
    const done = (): void => setImg(im);
    im.addEventListener('load', done);
    return () => im.removeEventListener('load', done);
  }, [src]);
  return img;
}

const flat = (pts: [number, number][]): number[] => pts.flatMap(([x, y]) => [x, y]);

export function Canvas({
  imageSrc,
  imgWidth,
  imgHeight,
  drawing,
  allowDelete,
  shapes,
  draft,
  editShapeId,
  onAddPoint,
  onDeleteShape,
  onEditShape,
}: CanvasProps): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<Konva.Group>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  // While a vertex is being dragged, mirror the edited shape's points so the
  // outline follows the handle live. Cleared on drag end (kept minimal to avoid
  // a prop/state sync loop). Whole-shape drags need no mirror — the Konva group
  // moves its children together.
  const [livePx, setLivePx] = useState<[number, number][] | null>(null);
  const img = useHtmlImage(imageSrc);

  // Track container size. Bail out when the measured size is unchanged so a
  // ResizeObserver → setState → re-render → observe cycle can't self-sustain
  // (that feedback loop is what makes the canvas flash). rAF-defer the callback
  // to avoid "ResizeObserver loop" warnings.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let raf = 0;
    const measure = (): void => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      // ±1px tolerance: sub-pixel/scrollbar rounding must not re-trigger a redraw
      // (that residual jitter shows as a thin flickering band).
      setSize((prev) => (Math.abs(prev.w - w) <= 1 && Math.abs(prev.h - h) <= 1 ? prev : { w, h }));
    };
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(el);
    measure();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // Fit the image into the container whenever either changes.
  useEffect(() => {
    if (!imgWidth || !imgHeight || !size.w || !size.h) return;
    const s = Math.min(size.w / imgWidth, size.h / imgHeight);
    setScale(s);
    setPos({ x: (size.w - imgWidth * s) / 2, y: (size.h - imgHeight * s) / 2 });
  }, [imgWidth, imgHeight, size.w, size.h]);

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>): void => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const by = 1.08;
    const next = e.evt.deltaY > 0 ? scale / by : scale * by;
    const mouseTo = { x: (pointer.x - pos.x) / scale, y: (pointer.y - pos.y) / scale };
    setScale(next);
    setPos({ x: pointer.x - mouseTo.x * next, y: pointer.y - mouseTo.y * next });
  };

  const onClick = (): void => {
    if (!drawing) return;
    const g = groupRef.current;
    if (!g) return;
    const p = g.getRelativePointerPosition();
    if (!p) return;
    if (p.x < 0 || p.y < 0 || p.x > imgWidth || p.y > imgHeight) return;
    onAddPoint(p.x, p.y);
  };

  const vertexR = 4 / scale;
  const badgeR = 9 / scale;
  const fontPx = 15 / scale;
  const handleR = 6 / scale;

  const renderShape = (s: Shape): JSX.Element => {
    const editing = !!editShapeId && s.id === editShapeId && !!onEditShape;
    const pts = editing && livePx ? livePx : s.verticesPx;
    const [ax, ay] = pts[0];
    const strokeW = (editing ? 3 : 2) / scale;

    // Whole-shape move: the body group is draggable; on release we shift every
    // vertex by the drag delta and reset the group back to origin (the fresh
    // props then re-render the children at their new home).
    const bodyDrag = editing
      ? {
          draggable: true,
          onDragEnd: (e: Konva.KonvaEventObject<DragEvent>): void => {
            // Konva drag events bubble, so a vertex-handle drag also reaches this
            // handler with the handle as target. Only act when the body group
            // itself was the thing dragged (target === the node we're attached to).
            if (e.target !== e.currentTarget) return;
            const dx = e.target.x();
            const dy = e.target.y();
            e.target.position({ x: 0, y: 0 });
            if (dx || dy) onEditShape!(s.id, s.verticesPx.map(([x, y]) => [x + dx, y + dy]));
          },
        }
      : {};

    return (
      <Group key={s.id} {...bodyDrag}>
        {s.type === 'point' ? (
          <Circle x={ax} y={ay} radius={6 / scale} stroke={s.color} strokeWidth={strokeW} />
        ) : (
          <Line
            points={flat(pts)}
            stroke={s.color}
            strokeWidth={strokeW}
            closed={s.closed}
            fill={s.closed ? `${s.color}${editing ? '33' : '22'}` : undefined}
          />
        )}
        {/* Name label in the shape's own colour, with a dark halo so it reads
            over both bright and dark nebulosity. */}
        <Text
          x={ax + badgeR * 1.6}
          y={ay - fontPx}
          text={s.label}
          fontSize={fontPx}
          fontStyle="bold"
          fill={s.color}
          stroke="#0d1017"
          strokeWidth={2.4 / scale}
          fillAfterStrokeEnabled
          listening={false}
        />

        {editing ? (
          // Draggable vertex handles. A handle sits above the body, so grabbing
          // one drags the vertex; grabbing the line/fill drags the whole shape.
          pts.map(([x, y], i) => (
            <Circle
              key={i}
              x={x}
              y={y}
              radius={handleR}
              fill="#fff"
              stroke={s.color}
              strokeWidth={2 / scale}
              hitStrokeWidth={20 / scale}
              draggable
              onDragStart={() => setLivePx(s.verticesPx.map((p) => [p[0], p[1]]))}
              onDragMove={(e) =>
                setLivePx((prev) => {
                  const base = prev ?? s.verticesPx.map((p) => [p[0], p[1]] as [number, number]);
                  const next = base.slice() as [number, number][];
                  next[i] = [e.target.x(), e.target.y()];
                  return next;
                })
              }
              onDragEnd={(e) => {
                const next = (livePx ?? s.verticesPx.map((p) => [p[0], p[1]] as [number, number])).slice() as [
                  number,
                  number,
                ][];
                next[i] = [e.target.x(), e.target.y()];
                setLivePx(null);
                onEditShape!(s.id, next);
              }}
            />
          ))
        ) : (
          allowDelete && (
            <Group onClick={() => onDeleteShape(s.id)} onTap={() => onDeleteShape(s.id)}>
              <Circle x={ax} y={ay} radius={badgeR} fill="#e0555a" />
              <Text
                x={ax}
                y={ay}
                text="×"
                fontSize={badgeR * 1.7}
                fill="#fff"
                offsetX={badgeR * 0.45}
                offsetY={badgeR * 0.72}
                listening={false}
              />
            </Group>
          )
        )}
      </Group>
    );
  };

  return (
    <div ref={wrapRef} className="canvas-wrap">
      <Stage
        width={size.w}
        height={size.h}
        onWheel={onWheel}
        style={{ cursor: drawing ? 'crosshair' : 'grab' }}
      >
        <Layer>
          <Group
            ref={groupRef}
            x={pos.x}
            y={pos.y}
            scaleX={scale}
            scaleY={scale}
            draggable={!drawing}
            onClick={onClick}
            onTap={onClick}
            onDragEnd={(e) => {
              // Only the pan group itself moving counts as a pan — ignore bubbled
              // drag ends from vertex/shape handles.
              if (e.target === groupRef.current) setPos({ x: e.target.x(), y: e.target.y() });
            }}
          >
            {img && <KImage image={img} width={imgWidth} height={imgHeight} />}

            {shapes.map(renderShape)}

            {draft && draft.verticesPx.length > 0 && (
              <>
                {draft.type !== 'point' && (
                  <Line
                    points={flat(draft.verticesPx)}
                    stroke={draft.color}
                    strokeWidth={2 / scale}
                    dash={[6 / scale, 4 / scale]}
                    closed={false}
                  />
                )}
                {draft.verticesPx.map(([x, y], i) => (
                  <Circle key={i} x={x} y={y} radius={vertexR} fill={draft.color} />
                ))}
              </>
            )}
          </Group>
        </Layer>
      </Stage>
    </div>
  );
}
