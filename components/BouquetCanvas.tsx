"use client";

import { useMemo } from "react";

import { CANVAS_HEIGHT, CANVAS_WIDTH, SVG_ROOT_ID } from "@/lib/canvas";
import {
  computeLayout,
  groupByLayer,
  placeStems,
  spriteWidthPx,
  type Layout,
  type PlacedStem,
} from "@/lib/engine";
import { rand, randSigned } from "@/lib/rng";
import {
  BACK_BLUR_PX,
  BACK_BRIGHTNESS,
  BACK_LAYERS,
  LAYER_ORDER,
  type BouquetState,
  type LayerName,
} from "@/lib/types";
import { buildWrap, type WrapShape } from "@/lib/wrap";
import { StemSprite } from "./StemSprite";

const STEM_WIDTH_MM = 6;

interface Props {
  state: BouquetState;
  className?: string;
  /** Draws the spiral the engine used. Never included in an export. */
  showGuides?: boolean;
}

/**
 * The whole bouquet, drawn back to front.
 *
 * Paint order is `LAYER_ORDER` and nothing else decides it: each layer is one
 * <g>, emitted in that sequence. Layers behind the focal flowers are pushed
 * back visually with a shared filter rather than by hand-tuning opacity per
 * sprite.
 */
export function BouquetCanvas({ state, className, showGuides = false }: Props) {
  const { layout, placed, byLayer, wrap } = useMemo(() => {
    const nextLayout = computeLayout(CANVAS_WIDTH, CANVAS_HEIGHT, state);
    const nextPlaced = placeStems(state, nextLayout);
    return {
      layout: nextLayout,
      placed: nextPlaced,
      byLayer: groupByLayer(nextPlaced),
      wrap: buildWrap(state, nextLayout, nextPlaced),
    };
  }, [state]);

  return (
    <svg
      id={SVG_ROOT_ID}
      viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={`Bouquet of ${state.stems.length} stems`}
    >
      <defs>
        {/*
          Back layers get brightness 0.94 and a 1px blur. Both are expressed in
          canvas units, so they hold at any display size and in the export.
        */}
        <filter id="depth-back" x="-25%" y="-25%" width="150%" height="150%">
          <feComponentTransfer>
            <feFuncR type="linear" slope={BACK_BRIGHTNESS} />
            <feFuncG type="linear" slope={BACK_BRIGHTNESS} />
            <feFuncB type="linear" slope={BACK_BRIGHTNESS} />
          </feComponentTransfer>
          <feGaussianBlur stdDeviation={BACK_BLUR_PX} />
        </filter>

        {wrap.gradients.map((gradient) => (
          <linearGradient
            key={gradient.id}
            id={gradient.id}
            gradientUnits="userSpaceOnUse"
            x1={gradient.x1}
            y1={gradient.y1}
            x2={gradient.x2}
            y2={gradient.y2}
          >
            {gradient.stops.map((stop) => (
              <stop
                key={stop.offset}
                offset={stop.offset}
                stopColor={stop.color}
                stopOpacity={stop.opacity}
              />
            ))}
          </linearGradient>
        ))}
      </defs>

      {LAYER_ORDER.map((layer) => (
        <g
          key={layer}
          data-layer={layer}
          filter={BACK_LAYERS.has(layer) ? "url(#depth-back)" : undefined}
        >
          {renderLayer(layer, byLayer.get(layer) ?? [], placed, state, layout, wrap)}
        </g>
      ))}

      {showGuides ? <Guides placed={placed} layout={layout} /> : null}
    </svg>
  );
}

function renderLayer(
  layer: LayerName,
  stems: PlacedStem[],
  allStems: PlacedStem[],
  state: BouquetState,
  layout: Layout,
  wrap: ReturnType<typeof buildWrap>,
) {
  switch (layer) {
    case "greens":
    case "filler":
    case "focal":
    case "front-greens":
      return stems.map((placed) => (
        <StemSprite key={placed.key} placed={placed} layout={layout} seed={state.seed} />
      ));
    case "stem-bundle":
      return (
        <StemBundle
          placed={allStems}
          state={state}
          layout={layout}
          cutOffY={wrap.baseBottomY}
        />
      );
    case "wrap-back":
      return <Shapes shapes={wrap.back} />;
    case "wrap-front":
      return <Shapes shapes={wrap.front} />;
    case "tape":
      return <Shapes shapes={wrap.tape} />;
    case "ribbon":
      return <Shapes shapes={wrap.ribbon} />;
    default:
      return null;
  }
}

/** Paints a list of shapes the wrap module worked out. */
function Shapes({ shapes }: { shapes: WrapShape[] }) {
  return (
    <>
      {shapes.map((shape, i) => (
        <path
          key={i}
          d={shape.d}
          fill={shape.fill}
          opacity={shape.opacity}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          strokeDasharray={shape.strokeDasharray}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </>
  );
}

/**
 * The gathered stems below the tie point.
 *
 * In a spiral hand-tie every stem crosses the bind, so a head leaning right
 * has its cut end kicking left. That mirroring is what stops the bundle
 * reading as a bunch of parallel sticks.
 */
export function StemBundle({
  placed,
  state,
  layout,
  cutOffY,
}: {
  placed: PlacedStem[];
  state: BouquetState;
  layout: Layout;
  /** Where the wrap ends. Stems stop short of it rather than poking through. */
  cutOffY: number | null;
}) {
  if (placed.length === 0) return null;

  const wrapped = cutOffY !== null;
  const available = wrapped
    ? (cutOffY - layout.tieY) * 0.88
    : (layout.height - layout.tieY) * 0.92;
  const dropPx = Math.max(0, available);
  // Wrapped stems are held together by the paper; bare ones are free to fan.
  const spread = wrapped ? 0.3 : 1;

  return (
    <g data-part="stem-bundle">
      {placed.map((stem) => {
        const width = spriteWidthPx(STEM_WIDTH_MM, layout.width, stem.scale);
        const lean =
          (-stem.rotationDeg * 0.32 + randSigned(state.seed, stem.n, "bundle") * 6) * spread;
        const length = dropPx * (0.82 + rand(state.seed, stem.n, "bundle-length") * 0.18);
        return (
          <line
            key={stem.key}
            x1={0}
            y1={0}
            x2={0}
            y2={length}
            stroke={stem.item.stemColor}
            strokeWidth={width}
            strokeLinecap="round"
            transform={`translate(${layout.tieX.toFixed(2)} ${layout.tieY.toFixed(
              2,
            )}) rotate(${lean.toFixed(2)})`}
          />
        );
      })}
    </g>
  );
}

/**
 * The engine, made visible: the tie point, the ring boundaries, and the path
 * the golden angle walks from stem to stem. Marked `data-guides` so the PNG
 * export can drop it without knowing anything else about the drawing.
 */
function Guides({ placed, layout }: { placed: PlacedStem[]; layout: Layout }) {
  // Ring radii are read back off the placed stems rather than recomputed, so
  // the guides follow the spiral after the fit pass has reined it in.
  const ringRadii = new Map<number, number>();
  for (const stem of placed) {
    if (stem.ring === 0) continue;
    const current = ringRadii.get(stem.ring);
    if (current === undefined || stem.radiusPx < current) ringRadii.set(stem.ring, stem.radiusPx);
  }

  const spiral = placed
    .map((s, i) => `${i === 0 ? "M" : "L"} ${s.headX.toFixed(1)} ${s.headY.toFixed(1)}`)
    .join(" ");

  return (
    <g data-guides="true" pointerEvents="none">
      {[...ringRadii].map(([ring, radius]) => (
        <circle
          key={ring}
          cx={layout.tieX}
          cy={layout.tieY}
          r={radius}
          fill="none"
          stroke="#93a983"
          strokeWidth={1}
          strokeDasharray="4 6"
          opacity={0.35}
        />
      ))}
      {placed.length > 1 ? (
        <path d={spiral} fill="none" stroke="#d7a05a" strokeWidth={1.5} opacity={0.55} />
      ) : null}
      {placed.map((s) => (
        <circle key={s.key} cx={s.headX} cy={s.headY} r={3} fill="#d7a05a" opacity={0.8} />
      ))}
      <g stroke="#d7a05a" strokeWidth={1.5}>
        <line x1={layout.tieX - 14} y1={layout.tieY} x2={layout.tieX + 14} y2={layout.tieY} />
        <line x1={layout.tieX} y1={layout.tieY - 14} x2={layout.tieX} y2={layout.tieY + 14} />
      </g>
      <text
        x={layout.tieX + 20}
        y={layout.tieY + 4}
        fill="#d7a05a"
        fontSize={13}
        fontFamily="var(--font-mono), monospace"
      >
        tie 50% / 72%
      </text>
    </g>
  );
}
