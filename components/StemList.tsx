"use client";

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@/lib/canvas";
import { computeLayout, placeStems } from "@/lib/engine";
import type { BouquetState } from "@/lib/types";
import { Panel } from "./ui";

interface Props {
  state: BouquetState;
  onRemove: (stemIndex: number) => void;
  onCycleVariant: (stemIndex: number) => void;
}

/**
 * What the engine decided, listed in the order it placed things.
 *
 * This is the arrangement's working: which stem took the middle, which ring
 * each one landed in, what angle the golden spiral gave it. It is also the only
 * place to remove one specific stem rather than "one of these".
 */
export function StemList({ state, onRemove, onCycleVariant }: Props) {
  const layout = computeLayout(CANVAS_WIDTH, CANVAS_HEIGHT, state);
  const placed = placeStems(state, layout);

  return (
    <Panel title="Placement" hint={placed.length > 0 ? `${placed.length} placed` : undefined}>
      {placed.length === 0 ? (
        <p className="text-sm text-bench-300">
          No stems yet. Add one from the catalog and it takes the middle of the spiral.
        </p>
      ) : (
        <ul className="space-y-px">
          <li className="rule-label grid grid-cols-[1.6rem_1fr_2.6rem_3.4rem_1.75rem] items-center gap-2 px-1 pb-1 text-bench-400">
            <span>n</span>
            <span>Stem</span>
            <span className="text-right">Ring</span>
            <span className="text-right">Angle</span>
            <span />
          </li>
          {placed.map((stem) => (
            <li
              key={stem.key}
              className="grid grid-cols-[1.6rem_1fr_2.6rem_3.4rem_1.75rem] items-center gap-2 rounded px-1 py-1 hover:bg-bench-700"
            >
              <span className="font-mono text-[11px] tabular-nums text-bench-400">{stem.n}</span>
              <button
                type="button"
                onClick={() => onCycleVariant(stem.stemIndex)}
                title={`Facing: ${stem.variant.facing}. Click to change.`}
                className="flex min-w-0 items-center gap-2 text-left"
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: stem.item.headColor }}
                />
                <span className="truncate text-xs text-bench-200">{stem.item.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-bench-400">
                  {stem.variant.facing}
                </span>
              </button>
              <span className="text-right font-mono text-[11px] tabular-nums text-bench-300">
                {stem.ring}
              </span>
              <span className="text-right font-mono text-[11px] tabular-nums text-bench-400">
                {Math.round(((stem.angleDeg % 360) + 360) % 360)}&deg;
              </span>
              <button
                type="button"
                onClick={() => onRemove(stem.stemIndex)}
                aria-label={`Remove ${stem.item.name} at position ${stem.n}`}
                className="justify-self-end rounded px-1.5 text-bench-400 transition-colors hover:bg-bench-600 hover:text-bench-100"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
