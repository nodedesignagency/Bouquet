"use client";

import { useMemo } from "react";

import { CANVAS_HEIGHT, CANVAS_WIDTH, SVG_ROOT_ID } from "@/lib/canvas";
import {
  computeLayout,
  depthRuns,
  placeStems,
  px,
  spriteWidthPx,
  type Layout,
  type PlacedStem,
} from "@/lib/engine";
import { rand, randSigned } from "@/lib/rng";
import {
  LAYER_ORDER,
  rowDepth,
  type BouquetState,
  type LayerName,
} from "@/lib/types";
import { buildWrap, type WrapShape } from "@/lib/wrap";
import { StemSprite } from "./StemSprite";

const STEM_WIDTH_MM = 6;

/** The groups made of stems, which are the ones the wrap's foot cuts off. */
const CUT_BY_THE_WRAP: ReadonlySet<LayerName> = new Set<LayerName>(["stems", "stem-bundle"]);

interface Props {
  state: BouquetState;
  className?: string;
  /** Draws the spiral the engine used. Never included in an export. */
  showGuides?: boolean;
}

/**
 * The whole bouquet, drawn back to front.
 *
 * The stems are drawn in one pass, deepest first, and depth alone decides which
 * lands over which — the arrangement's rows painted back to front, with the
 * foliage and filler in among them at whatever depth they stand. Drawing them
 * as separate layers instead put every green and every stem of gypsophila
 * behind every flower, which made the foliage a backdrop hung behind the
 * bouquet rather than part of it.
 *
 * Each depth band is one <g> carrying its share of the treatment that pushes it
 * back — a shared filter per band rather than hand-tuned opacity per sprite.
 */
export function BouquetCanvas({ state, className, showGuides = false }: Props) {
  const { layout, placed, runs, wrap } = useMemo(() => {
    const nextLayout = computeLayout(CANVAS_WIDTH, CANVAS_HEIGHT, state);
    const nextPlaced = placeStems(state, nextLayout);
    return {
      layout: nextLayout,
      placed: nextPlaced,
      runs: depthRuns(nextPlaced),
      wrap: buildWrap(state, nextLayout, nextPlaced),
    };
  }, [state]);

  // How deep the arrangement goes, which is what the depth treatment is
  // measured against: the back row of a two-row posy is not as far away as the
  // back row of a bouquet of thirty.
  const deepest = runs.reduce((back, run) => Math.max(back, run.band), 0);
  const bands = [...new Set(runs.map((run) => run.band))].sort((a, b) => a - b);

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
        {/* The stage lives inside the SVG, so an export looks like the screen. */}
        <radialGradient id="stage-ground" cx="50%" cy="8%" r="78%">
          <stop offset="0%" stopColor="#2e2621" />
          <stop offset="48%" stopColor="#201b18" />
          <stop offset="100%" stopColor="#171310" />
        </radialGradient>

        {/*
          The back of the arrangement gets brightness 0.94 and a 1px blur, and
          the rows in front of it get their share — one filter per band. Both
          are expressed in canvas units, so they hold at any display size and in
          the export.
        */}
        {bands
          .filter((band) => band > 0)
          .map((band) => {
            const { brightness, blur } = rowDepth(band, deepest);
            return (
              <filter
                key={band}
                id={`depth-${band}`}
                x="-25%"
                y="-25%"
                width="150%"
                height="150%"
              >
                <feComponentTransfer>
                  <feFuncR type="linear" slope={px(brightness)} />
                  <feFuncG type="linear" slope={px(brightness)} />
                  <feFuncB type="linear" slope={px(brightness)} />
                </feComponentTransfer>
                <feGaussianBlur stdDeviation={px(blur)} />
              </filter>
            );
          })}

        {/*
          Nothing is drawn below the wrap's foot. A sprite slides down its own
          axis to put its bloom where the spiral asked, which buries the cut end
          inside the wrap — but a long stem can slide far enough to come out
          under the base, and a stem poking out beneath the paper is not
          something a bouquet does.
        */}
        <clipPath id="above-foot">
          <rect x={0} y={0} width={CANVAS_WIDTH} height={wrap.baseBottomY ?? CANVAS_HEIGHT} />
        </clipPath>

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

      <rect
        data-part="stage"
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        fill="url(#stage-ground)"
      />

      {LAYER_ORDER.map((layer) => (
        <g
          key={layer}
          data-layer={layer}
          filter={layer === "wrap-back" && deepest > 0 ? `url(#depth-${deepest})` : undefined}
          clipPath={CUT_BY_THE_WRAP.has(layer) ? "url(#above-foot)" : undefined}
        >
          {layer === "stems"
            ? runs.map((run, i) => (
                <g
                  key={i}
                  data-depth={run.band}
                  filter={run.band > 0 ? `url(#depth-${run.band})` : undefined}
                >
                  {run.stems.map((stem) => (
                    <StemSprite
                      key={stem.key}
                      placed={stem}
                      layout={layout}
                      seed={state.seed}
                    />
                  ))}
                </g>
              ))
            : renderLayer(layer, placed, state, layout, wrap)}
        </g>
      ))}

      {showGuides ? <Guides placed={placed} layout={layout} /> : null}
    </svg>
  );
}

function renderLayer(
  layer: LayerName,
  allStems: PlacedStem[],
  state: BouquetState,
  layout: Layout,
  wrap: ReturnType<typeof buildWrap>,
) {
  switch (layer) {
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
            y2={px(length)}
            stroke={stem.item.stemColor}
            strokeWidth={px(width)}
            strokeLinecap="round"
            transform={`translate(${px(layout.tieX)} ${px(layout.tieY)}) rotate(${px(lean)})`}
          />
        );
      })}
    </g>
  );
}

/**
 * The engine, made visible: the tie point, the row each stem stands in, and the
 * path the golden angle walks from stem to stem. Marked `data-guides` so the
 * PNG export can drop it without knowing anything else about the drawing.
 */
function Guides({ placed, layout }: { placed: PlacedStem[]; layout: Layout }) {
  // One polyline per row, drawn through the heads that stand in it, so the
  // courses the engine built are visible as courses. Back rows are faint.
  const rows = new Map<number, PlacedStem[]>();
  for (const stem of placed) {
    const bucket = rows.get(stem.level);
    if (bucket) bucket.push(stem);
    else rows.set(stem.level, [stem]);
  }

  const spiral = placed
    .map((s, i) => `${i === 0 ? "M" : "L"} ${px(s.headX)} ${px(s.headY)}`)
    .join(" ");

  return (
    <g data-guides="true" pointerEvents="none">
      {[...rows]
        .sort((a, b) => b[0] - a[0])
        .map(([level, stems]) => {
          const across = [...stems].sort((a, b) => a.headX - b.headX);
          const d = across
            .map((s, i) => `${i === 0 ? "M" : "L"} ${px(s.headX)} ${px(s.headY)}`)
            .join(" ");
          return (
            <g key={level}>
              {across.length > 1 ? (
                <path
                  d={d}
                  fill="none"
                  stroke="#93a983"
                  strokeWidth={1.5}
                  strokeDasharray="4 6"
                  opacity={0.6 - level * 0.12}
                />
              ) : null}
              <text
                x={px(across[0].headX + 8)}
                y={px(across[0].headY - 8)}
                fill="#93a983"
                fontSize={11}
                opacity={0.7 - level * 0.12}
                fontFamily="var(--font-mono), monospace"
              >
                {`L${level}`}
              </text>
            </g>
          );
        })}
      {placed.length > 1 ? (
        <path d={spiral} fill="none" stroke="#d7a05a" strokeWidth={1.5} opacity={0.35} />
      ) : null}
      {placed.map((s) => (
        <circle key={s.key} cx={px(s.headX)} cy={px(s.headY)} r={3} fill="#d7a05a" opacity={0.8} />
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
