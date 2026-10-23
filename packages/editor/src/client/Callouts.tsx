import type * as React from 'react';
import { Arc as KArc, Circle as KCircle, Group, Image as KImage, Line, Rect, Text } from 'react-konva';
import {
  COLOR_PALETTE,
  insetEdgePoint,
  type Callout,
  type Feature,
  type Reading,
} from '@astellum/schema';

/**
 * The magnified insets, on the canvas the curator is working on.
 *
 * They are a property of the exported picture, not of the editing session — but
 * a curator who cannot see them until they export has to export to find out
 * whether an inset landed on the thing they were framing. Drawing them here
 * costs one layer and removes that round trip.
 *
 * Where they go is decided by `planCallouts` in the schema, the same call the
 * exporter makes, so what is on screen is what comes out. Nothing here is
 * interactive: an inset is not an annotation, and a click on one should fall
 * through to whatever it is covering.
 */

/** Just the contour, for drawing a second time inside an inset. */
function Contour({ f, strokeW }: { f: Feature; strokeW: number }): React.JSX.Element | null {
  const color = COLOR_PALETTE[f.color_key];
  if (f.shape === 'arc' && f.arc) {
    return (
      <KArc
        x={f.arc.cx}
        y={f.arc.cy}
        innerRadius={f.arc.r - strokeW}
        outerRadius={f.arc.r + strokeW}
        angle={((f.arc.a1 - f.arc.a0) * 180) / Math.PI}
        rotation={(f.arc.a0 * 180) / Math.PI}
        fill={color.stroke}
      />
    );
  }
  if (!f.polygon?.length) return null;
  const points = f.polygon.flatMap((p) => [p[0], p[1]]);
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
}: {
  report: Reading;
  callouts: Callout[];
  image: HTMLImageElement | null;
  /** Screen pixels → image pixels, so the frame holds its weight at any zoom. */
  px: (screen: number) => number;
}): React.JSX.Element | null {
  if (!callouts.length) return null;
  const { width, height } = report.image;

  return (
    <>
      {callouts.map((c) => {
        const f = report.features.find((x) => x.id === c.id);
        if (!f) return null;
        const color = COLOR_PALETTE[f.color_key];
        const e = insetEdgePoint(c.inset, c.anchor);
        const br = Math.min(c.inset.w, c.inset.h) * 0.09;
        return (
          <Group key={`callout-${c.id}`} listening={false}>
            <Line
              points={[c.anchor.x, c.anchor.y, e.x, e.y]}
              stroke={color.stroke}
              strokeWidth={px(1.5)}
              dash={[px(7), px(5)]}
              opacity={0.75}
            />
            {/* Konva clips in the group's own coordinates, so the crop is
                positioned by offsetting the full image rather than slicing it:
                one node, and the same arithmetic the SVG path uses. */}
            <Group
              clipX={c.inset.x}
              clipY={c.inset.y}
              clipWidth={c.inset.w}
              clipHeight={c.inset.h}
            >
              <Group
                x={c.inset.x}
                y={c.inset.y}
                scaleX={c.scale}
                scaleY={c.scale}
                offsetX={c.crop.x}
                offsetY={c.crop.y}
              >
                {image && <KImage image={image} width={width} height={height} />}
                <Contour f={f} strokeW={px(2) / c.scale} />
              </Group>
            </Group>
            <Rect
              x={c.inset.x}
              y={c.inset.y}
              width={c.inset.w}
              height={c.inset.h}
              cornerRadius={px(6)}
              stroke={color.stroke}
              strokeWidth={px(2)}
            />
            <KCircle
              x={c.inset.x + br * 1.4}
              y={c.inset.y + br * 1.4}
              radius={br}
              fill={color.badge}
              stroke="#0b0e14"
              strokeWidth={px(1)}
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
            />
          </Group>
        );
      })}
    </>
  );
}
