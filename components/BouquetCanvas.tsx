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
import { StemSprite } from "./StemSprite";

const STEM_WIDTH_MM = 6;

interface Props {
  state: BouquetState;
  className?: string;
}

/**
 * The whole bouquet, drawn back to front.
 *
 * Paint order is `LAYER_ORDER` and nothing else decides it: each layer is one
 * <g>, emitted in that sequence. Layers behind the focal flowers are pushed
 * back visually with a shared filter rather than by hand-tuning opacity per
 * sprite.
 */
export function BouquetCanvas({ state, className }: Props) {
  const { layout, placed, byLayer } = useMemo(() => {
    const nextLayout = computeLayout(CANVAS_WIDTH, CANVAS_HEIGHT, state);
    const nextPlaced = placeStems(state, nextLayout);
    return { layout: nextLayout, placed: nextPlaced, byLayer: groupByLayer(nextPlaced) };
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
      </defs>

      {LAYER_ORDER.map((layer) => (
        <g
          key={layer}
          data-layer={layer}
          filter={BACK_LAYERS.has(layer) ? "url(#depth-back)" : undefined}
        >
          {renderLayer(layer, byLayer.get(layer) ?? [], placed, state, layout)}
        </g>
      ))}
    </svg>
  );
}

function renderLayer(
  layer: LayerName,
  stems: PlacedStem[],
  allStems: PlacedStem[],
  state: BouquetState,
  layout: Layout,
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
      return <StemBundle placed={allStems} state={state} layout={layout} />;
    default:
      // wrap-back, wrap-front, tape and ribbon arrive in step 3.
      return null;
  }
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
}: {
  placed: PlacedStem[];
  state: BouquetState;
  layout: Layout;
}) {
  if (placed.length === 0) return null;

  const dropPx = (layout.height - layout.tieY) * 0.92;

  return (
    <g data-part="stem-bundle">
      {placed.map((stem) => {
        const width = spriteWidthPx(STEM_WIDTH_MM, layout.width, stem.scale);
        const lean = -stem.rotationDeg * 0.32 + randSigned(state.seed, stem.n, "bundle") * 6;
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
