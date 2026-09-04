/**
 * Share links.
 *
 * A bouquet is fully described by its state, and its state is small, so the
 * link carries the whole thing rather than an id pointing at a database. The
 * encoding is deliberately readable — you can see the flowers in the URL — and
 * runs of identical stems collapse, which keeps a thirty-stem bouquet inside a
 * couple of hundred characters:
 *
 *   ?b=b1.8412.round.kraft-brown.satin-cream.1.lily-white:0*3,rose-red:1*5
 *
 * A stem that has been pulled forward or pushed back carries a third field,
 * `itemId:variant:depth`; the common case of depth 0 leaves it off entirely.
 *
 * Decoding is defensive: anything unrecognised falls back to a default rather
 * than throwing, so a link from an older build still opens.
 */

import { getItem } from "./catalog";
import { addStem, DEFAULT_STATE, MAX_DEPTH, MAX_STEMS, normalizeState } from "./state";
import type { BouquetState, WrapStyle } from "./types";
import { getMaterial, getRibbon, getWrapStyle } from "./wrap";

export const SHARE_PARAM = "b";
const VERSION = "b1";
const FIELD = ".";
const RUN = ",";
const COUNT = "*";
const VARIANT = ":";

export function encodeState(state: BouquetState): string {
  const runs: string[] = [];
  for (const stem of state.stems) {
    const token =
      stem.depth === 0
        ? `${stem.itemId}${VARIANT}${stem.variant}`
        : `${stem.itemId}${VARIANT}${stem.variant}${VARIANT}${stem.depth}`;
    const last = runs[runs.length - 1];
    if (last?.startsWith(`${token}${COUNT}`)) {
      const count = Number(last.slice(token.length + 1));
      runs[runs.length - 1] = `${token}${COUNT}${count + 1}`;
    } else if (last === token) {
      runs[runs.length - 1] = `${token}${COUNT}2`;
    } else {
      runs.push(token);
    }
  }

  return [
    VERSION,
    state.seed,
    state.wrapStyle,
    state.wrapMaterial,
    state.ribbon,
    state.hasTape ? "1" : "0",
    runs.join(RUN),
  ].join(FIELD);
}

export function decodeState(encoded: string): BouquetState | null {
  const parts = encoded.split(FIELD);
  if (parts[0] !== VERSION) return null;

  const [, rawSeed, rawStyle, rawMaterial, rawRibbon, rawTape, rawStems = ""] = parts;

  const seed = Number.parseInt(rawSeed, 10);
  let state: BouquetState = {
    ...DEFAULT_STATE,
    seed: Number.isFinite(seed) ? seed : DEFAULT_STATE.seed,
    // Each lookup falls back to the first option, so an unknown paper or ribbon
    // still opens as a valid bouquet.
    wrapStyle: getWrapStyle(rawStyle as WrapStyle).id,
    wrapMaterial: getMaterial(rawMaterial).id,
    ribbon: getRibbon(rawRibbon).id,
    hasTape: rawTape !== "0",
    stems: [],
  };

  for (const run of rawStems.split(RUN)) {
    if (run === "") continue;
    const [token, rawCount] = run.split(COUNT);
    const [itemId, rawVariant, rawDepth] = token.split(VARIANT);
    const item = getItem(itemId);
    if (!item) continue;

    const count = Math.min(MAX_STEMS, Math.max(1, Number.parseInt(rawCount ?? "1", 10) || 1));
    const variantIndex = Number.parseInt(rawVariant ?? "0", 10);
    const variant =
      Number.isFinite(variantIndex) && variantIndex >= 0 && variantIndex < item.variants.length
        ? variantIndex
        : 0;

    const parsedDepth = Number.parseInt(rawDepth ?? "0", 10);
    const depth = Number.isFinite(parsedDepth)
      ? Math.max(-MAX_DEPTH, Math.min(MAX_DEPTH, parsedDepth))
      : 0;

    for (let i = 0; i < count; i += 1) {
      const next = addStem(state, item.id);
      if (next === state) break; // Hit the stem limit.
      const stems = next.stems.slice();
      stems[stems.length - 1] = { ...stems[stems.length - 1], variant, depth };
      state = { ...next, stems };
    }
  }

  return normalizeState(state);
}

/** The full link for a bouquet, based on where the page is being served from. */
export function shareUrl(state: BouquetState, base: string): string {
  const url = new URL(base);
  url.search = "";
  url.hash = "";
  url.searchParams.set(SHARE_PARAM, encodeState(state));
  return url.toString();
}

/** Reads a bouquet out of the current address, if there is one in it. */
export function stateFromLocation(search: string): BouquetState | null {
  const encoded = new URLSearchParams(search).get(SHARE_PARAM);
  return encoded ? decodeState(encoded) : null;
}
