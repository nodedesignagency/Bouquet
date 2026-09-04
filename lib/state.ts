/**
 * Bouquet state: construction, normalisation and the handful of mutations the
 * UI needs. Every function here is pure and returns a new state object.
 */

import { getItemOrFallback } from "./catalog";
import { placementOrder, ringForIndex } from "./engine";
import { rand } from "./rng";
import type { BouquetState, Stem } from "./types";

/** Fixed by the brief: 50% across, 72% down. */
export const TIE_POINT: [number, number] = [0.5, 0.72];

export const MAX_STEMS = 36;

export const DEFAULT_STATE: BouquetState = {
  seed: 8412,
  tiePoint: TIE_POINT,
  stems: [],
  wrapStyle: "round",
  wrapMaterial: "kraft-brown",
  ribbon: "satin-cream",
  hasTape: true,
};

/**
 * Recompute each stem's spiral ordinal and ring.
 *
 * The array keeps the order stems were added — that is what the stem list in
 * the UI shows — while `index`/`ring` record where the engine will actually
 * place each one. Running this after every mutation keeps the persisted state
 * consistent with what the engine computes, so a state round-tripped through a
 * share link renders identically without needing a repair pass.
 */
export function normalizeStems(stems: Stem[]): Stem[] {
  const order = placementOrder(stems);
  const next = stems.slice();
  order.forEach((stemIndex, n) => {
    next[stemIndex] = { ...next[stemIndex], index: n, ring: ringForIndex(n) };
  });
  return next;
}

export function normalizeState(state: BouquetState): BouquetState {
  return { ...state, tiePoint: TIE_POINT, stems: normalizeStems(state.stems) };
}

/**
 * Pick a facing for a newly added stem. Seeded on the stem count so a bouquet
 * built by the same clicks in the same order always gets the same facings —
 * and so `Math.random` stays out of the app entirely.
 */
function pickVariant(seed: number, ordinal: number, variantCount: number): number {
  if (variantCount <= 1) return 0;
  return Math.min(variantCount - 1, Math.floor(rand(seed, ordinal, "variant") * variantCount));
}

export function addStem(state: BouquetState, itemId: string): BouquetState {
  if (state.stems.length >= MAX_STEMS) return state;
  const item = getItemOrFallback(itemId);
  const stem: Stem = {
    itemId: item.id,
    variant: pickVariant(state.seed, state.stems.length, item.variants.length),
    ring: 0,
    index: state.stems.length,
  };
  return { ...state, stems: normalizeStems([...state.stems, stem]) };
}

export function removeStemAt(state: BouquetState, stemIndex: number): BouquetState {
  if (stemIndex < 0 || stemIndex >= state.stems.length) return state;
  const stems = state.stems.filter((_, i) => i !== stemIndex);
  return { ...state, stems: normalizeStems(stems) };
}

/** Remove the most recently added stem of a given item. Powers the catalog's minus button. */
export function removeStemOfItem(state: BouquetState, itemId: string): BouquetState {
  for (let i = state.stems.length - 1; i >= 0; i -= 1) {
    if (state.stems[i].itemId === itemId) return removeStemAt(state, i);
  }
  return state;
}

export function clearStems(state: BouquetState): BouquetState {
  return { ...state, stems: [] };
}

export function countOfItem(state: BouquetState, itemId: string): number {
  return state.stems.reduce((n, stem) => n + (stem.itemId === itemId ? 1 : 0), 0);
}

/** Cycle a single stem through its facings, without disturbing the arrangement. */
export function cycleVariant(state: BouquetState, stemIndex: number): BouquetState {
  const stem = state.stems[stemIndex];
  if (!stem) return state;
  const item = getItemOrFallback(stem.itemId);
  const stems = state.stems.slice();
  stems[stemIndex] = { ...stem, variant: (stem.variant + 1) % item.variants.length };
  return { ...state, stems };
}

/**
 * A starter bouquet, so the first paint shows the engine doing something.
 * Built through the ordinary mutations, so it is nothing a user could not
 * have clicked together themselves.
 */
export function starterBouquet(): BouquetState {
  const recipe: Array<[string, number]> = [
    ["lily-pink", 3],
    ["rose-pink", 5],
    ["babys-breath", 4],
    ["eucalyptus", 3],
  ];
  let state = DEFAULT_STATE;
  for (const [itemId, count] of recipe) {
    for (let i = 0; i < count; i += 1) state = addStem(state, itemId);
  }
  return state;
}
