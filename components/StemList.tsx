"use client";

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@/lib/canvas";
import { computeLayout, placeStems } from "@/lib/engine";
import { MAX_DEPTH } from "@/lib/state";
import type { BouquetState } from "@/lib/types";
import { Panel } from "./ui";

interface Props {
  state: BouquetState;
  onRemove: (stemIndex: number) => void;
  onCycleVariant: (stemIndex: number) => void;
  onNudgeDepth: (stemIndex: number, by: number) => void;
}

const ROW = "grid grid-cols-[1.3rem_1fr_1.5rem_3.2rem_1.4rem] items-center gap-2";

/**
 * What the engine decided, listed in the order it placed things.
 *
 * This is the arrangement's working — which stem took the middle, which ring
 * each one landed in — and the only place to act on one specific stem: remove
 * it, turn it to face another way, or move it through the stack.
 */
export function StemList({ state, onRemove, onCycleVariant, onNudgeDepth }: Props) {
  const layout = computeLayout(CANVAS_WIDTH, CANVAS_HEIGHT, state);
  const placed = placeStems(state, layout);

  return (
    <Panel title="Placement" hint={placed.length > 0 ? `${placed.length} placed` : undefined}>
      {placed.length === 0 ? (
        <p className="text-sm text-bench-300">
          No stems yet. Add one from the catalog and it takes the middle of the spiral.
        </p>
      ) : (
        <>
          <ul className="space-y-px">
            <li className={`${ROW} rule-label px-1 pb-1 text-bench-400`}>
              <span>n</span>
              <span>Stem</span>
              <span className="text-right">Rg</span>
              <span className="text-center">Depth</span>
              <span />
            </li>
            {placed.map((stem) => {
              const depth = stem.stem.depth;
              return (
                <li key={stem.key} className={`${ROW} rounded px-1 py-1 hover:bg-bench-700`}>
                  <span className="font-mono text-[11px] tabular-nums text-bench-400">
                    {stem.n}
                  </span>
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
                  <span className="flex items-center justify-center gap-0.5">
                    <DepthButton
                      label={`Send ${stem.item.name} at position ${stem.n} back`}
                      disabled={depth <= -MAX_DEPTH}
                      onClick={() => onNudgeDepth(stem.stemIndex, -1)}
                    >
                      &darr;
                    </DepthButton>
                    <span
                      className={`w-3 text-center font-mono text-[10px] tabular-nums ${
                        depth === 0 ? "text-bench-500" : "text-kraft-soft"
                      }`}
                      title="0 leaves this stem where the engine put it"
                    >
                      {depth === 0 ? "·" : depth > 0 ? `+${depth}` : depth}
                    </span>
                    <DepthButton
                      label={`Bring ${stem.item.name} at position ${stem.n} forward`}
                      disabled={depth >= MAX_DEPTH}
                      onClick={() => onNudgeDepth(stem.stemIndex, 1)}
                    >
                      &uarr;
                    </DepthButton>
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
              );
            })}
          </ul>
          <p className="mt-3 text-[11px] leading-snug text-bench-400">
            Depth moves a stem through the stack without moving it in the arrangement. Click a
            name to turn the flower.
          </p>
        </>
      )}
    </Panel>
  );
}

function DepthButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="h-4 w-4 rounded text-[10px] leading-none text-bench-400 transition-colors hover:bg-bench-600 hover:text-bench-100 disabled:cursor-not-allowed disabled:text-bench-600 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
