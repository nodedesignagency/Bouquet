"use client";

import { CANVAS_WIDTH_MM } from "@/lib/engine";
import type { BouquetState } from "@/lib/types";
import { BouquetCanvas } from "./BouquetCanvas";

interface Props {
  state: BouquetState;
  showGuides: boolean;
}

/**
 * The bouquet on its paper, with a ruler under it.
 *
 * The ruler is not decoration: the canvas is exactly 400mm wide by definition,
 * so the scale under the stage is the true one, and a 180mm sunflower can be
 * measured against it.
 */
export function Stage({ state, showGuides }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-xl border border-bench-600">
        <BouquetCanvas state={state} showGuides={showGuides} className="h-auto w-full" />
      </div>
      <Ruler />
    </div>
  );
}

function Ruler() {
  const majorEvery = 100;
  const minorEvery = 25;
  const ticks = Array.from(
    { length: CANVAS_WIDTH_MM / minorEvery + 1 },
    (_, i) => i * minorEvery,
  );

  // The viewBox keeps its aspect ratio so one unit across is one real
  // millimetre, matching the canvas above tick for tick.
  return (
    <svg viewBox={`0 0 ${CANVAS_WIDTH_MM} 15`} className="h-auto w-full" aria-hidden>
      <line x1={0} y1={0.5} x2={CANVAS_WIDTH_MM} y2={0.5} stroke="#3a312b" strokeWidth={0.5} />
      {ticks.map((mm) => {
        const major = mm % majorEvery === 0;
        return (
          <line
            key={mm}
            x1={mm}
            x2={mm}
            y1={0.5}
            y2={major ? 5 : 3}
            stroke={major ? "#93a983" : "#3a312b"}
            strokeWidth={0.6}
          />
        );
      })}
      {[0, 100, 200, 300, 400].map((mm) => (
        <text
          key={mm}
          x={mm === 0 ? 1 : mm === CANVAS_WIDTH_MM ? mm - 1 : mm}
          y={13}
          textAnchor={mm === 0 ? "start" : mm === CANVAS_WIDTH_MM ? "end" : "middle"}
          fill="#6b5f56"
          fontSize={7}
          fontFamily="var(--font-mono), monospace"
        >
          {mm === CANVAS_WIDTH_MM ? "400 mm" : mm}
        </text>
      ))}
    </svg>
  );
}
