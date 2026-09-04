"use client";

import { BouquetCanvas } from "@/components/BouquetCanvas";
import { starterBouquet } from "@/lib/state";

/**
 * Step 1: the arrangement engine on its own.
 *
 * No catalog panel, no controls — just the golden-angle spiral rendered as
 * placeholder circles, so the geometry can be judged before anything is
 * layered on top of it.
 */
export default function Page() {
  const state = starterBouquet();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center gap-6 p-8">
      <h1 className="text-lg font-medium tracking-tight text-ink-200">Arrangement engine</h1>
      <div className="canvas-stage w-full max-w-xl overflow-hidden rounded-2xl border border-ink-700">
        <BouquetCanvas state={state} className="h-auto w-full" />
      </div>
      <p className="text-xs text-ink-400">
        seed {state.seed} · {state.stems.length} stems
      </p>
    </main>
  );
}
