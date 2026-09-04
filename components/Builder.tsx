"use client";

import { useState } from "react";

import { makeSeed } from "@/lib/rng";
import {
  addStem,
  cycleVariant,
  removeStemAt,
  removeStemOfItem,
  starterBouquet,
} from "@/lib/state";
import type { BouquetState } from "@/lib/types";
import { CatalogPanel } from "./CatalogPanel";
import { SeedBar } from "./SeedBar";
import { Stage } from "./Stage";
import { WrapPanel } from "./WrapPanel";
import { StemList } from "./StemList";

export function Builder() {
  const [state, setState] = useState<BouquetState>(starterBouquet);
  const [showGuides, setShowGuides] = useState(false);

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-8 lg:py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-bench-600 pb-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-bench-100">
            Bouquet
          </h1>
          <p className="mt-1 max-w-md text-sm text-bench-300">
            A hand-tie built one stem at a time. Every flower is drawn at its real size, so
            what you arrange here is the size it arrives.
          </p>
        </div>
        <SeedBar
          seed={state.seed}
          showGuides={showGuides}
          onSeed={(seed) => setState((prev) => ({ ...prev, seed }))}
          onShuffle={() => setState((prev) => ({ ...prev, seed: makeSeed() }))}
          onToggleGuides={() => setShowGuides((prev) => !prev)}
        />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="mx-auto w-full max-w-[34rem] lg:sticky lg:top-6">
          <Stage state={state} showGuides={showGuides} />
        </div>

        <div className="space-y-4">
          <CatalogPanel
            state={state}
            onAdd={(itemId) => setState((prev) => addStem(prev, itemId))}
            onRemove={(itemId) => setState((prev) => removeStemOfItem(prev, itemId))}
          />
          <WrapPanel
            state={state}
            onChange={(patch) => setState((prev) => ({ ...prev, ...patch }))}
          />
          <StemList
            state={state}
            onRemove={(i) => setState((prev) => removeStemAt(prev, i))}
            onCycleVariant={(i) => setState((prev) => cycleVariant(prev, i))}
          />
        </div>
      </div>
    </main>
  );
}
