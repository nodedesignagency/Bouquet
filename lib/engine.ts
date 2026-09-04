/**
 * The arrangement engine.
 *
 * Turns a `BouquetState` into pure geometry. It knows nothing about React, SVG,
 * images or the DOM — it hands back numbers, and the renderer draws them. That
 * separation is what lets step 5 swap placeholder circles for real PNG sprites
 * without touching a single line of arrangement maths.
 *
 * Everything here is a pure function of (state, canvas size). No `Math.random`,
 * no `Date`, no module-level mutable state.
 */

import { getItemOrFallback } from "./catalog";
import { rand, randChance, randSigned } from "./rng";
import type { BouquetState, CatalogItem, LayerName, Stem } from "./types";

/* -------------------------------------------------------------------------- */
/* Constants                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The canvas is treated as a window onto 400mm of real world across its width.
 * Every millimetre figure in the catalog converts through this one number,
 * which is what makes a 180mm sunflower reliably 2.4x a 75mm rose on screen.
 */
export const CANVAS_WIDTH_MM = 400;

/** Phyllotaxis. The angle sunflower seeds actually use. */
export const GOLDEN_ANGLE_DEG = 137.5;

/** Seeded jitter, per the brief. */
export const ANGLE_JITTER_DEG = 8;
export const RADIUS_JITTER = 0.06;

/** Scale drops 12% per ring outward. */
export const RING_SCALE_FALLOFF = 0.12;

/**
 * The head plane is squashed vertically, and asymmetrically: offsets above the
 * middle of the mass are left nearly intact, offsets below are compressed hard.
 * That is what a collar does to a real bouquet — the mass domes up and out but
 * is cut flat where the wrap holds it, instead of hanging down past the tie.
 */
const DOME_SQUASH_UP = 0.94;
const DOME_SQUASH_DOWN = 0.5;

/**
 * Ring spacing is derived from the root-mean-square head width rather than the
 * plain mean, because RMS leans toward the big heads — and the big heads are
 * the ones in the middle deciding how much room the spiral needs. For a bouquet
 * of one flower type the two agree exactly; for a mixed one, RMS stops three
 * lilies from being spaced as if they were lavender.
 *
 * At 0.9 of the RMS half-width, neighbouring heads overlap by about a tenth of
 * their width, which is roughly how tightly a florist actually packs them.
 */
const RING_SPACING_FACTOR = 0.9;
const RING_SPACING_MIN_MM = 18;
const RING_SPACING_MAX_MM = 90;

/**
 * How much of the canvas the arrangement may fill before it is reined in.
 * Sprites are allowed to overhang the limit by part of their own width — a
 * sprig of eucalyptus running off the edge of the frame is what florists'
 * product shots actually look like, and holding the full bounding box inside
 * the canvas would shrink the whole bouquet to fit its airiest stem.
 */
const FIT_HALF_WIDTH = 0.5;
const FIT_TOP_MARGIN = 0.03;

/**
 * How much of its own width a sprite must keep inside the frame, by category.
 * A focal flower cut in half by the edge looks like a mistake; a sprig of
 * eucalyptus running out of frame is just how these photographs are cropped.
 */
const FIT_SPRITE_MARGIN: Record<CatalogItem["category"], number> = {
  focal: 0.45,
  filler: 0.24,
  green: 0.15,
};

/** Share of greens promoted in front of the focal flowers. */
const FRONT_GREEN_CHANCE = 0.3;

/** A sprig is drawn as a cluster of florets when its bloom is much smaller. */
const CLUSTER_THRESHOLD = 0.8;
const CLUSTER_MIN = 3;
const CLUSTER_MAX = 18;
const CLUSTER_DENSITY = 1.6;

const DEG = Math.PI / 180;

/* -------------------------------------------------------------------------- */
/* Layout                                                                       */
/* -------------------------------------------------------------------------- */

export interface Layout {
  width: number;
  height: number;
  /** Tie point in canvas pixels. */
  tieX: number;
  tieY: number;
  /** Pixels per real millimetre, at scale 1. */
  mmToPx: number;
  /** Spiral ring spacing in pixels. */
  ringSpacingPx: number;
}

/**
 * `sprite width on screen = (realWidthMm / 400) * canvasWidth * scale`
 *
 * The one sizing rule in the whole app. Nothing is ever sized from a PNG's
 * pixel dimensions.
 */
export function spriteWidthPx(realWidthMm: number, canvasWidth: number, scale: number): number {
  return (realWidthMm / CANVAS_WIDTH_MM) * canvasWidth * scale;
}

/** Ring index for a spiral ordinal. Ring 0 holds one stem, ring 1 holds three, and so on. */
export function ringForIndex(n: number): number {
  return Math.floor(Math.sqrt(Math.max(0, n)));
}

/** Scale multiplier for a ring: 12% smaller for each ring outward. */
export function scaleForRing(ring: number): number {
  return Math.pow(1 - RING_SCALE_FALLOFF, ring);
}

/**
 * Placement order, which is not the same as the order stems were added.
 *
 * Focals take the middle of the spiral, filler sits around them, greens land on
 * the outside — the way a florist actually builds up a hand-tie. Within a
 * category the user's own order is preserved, so the sort is stable and adding
 * a stem never reshuffles the ones already placed.
 */
const CATEGORY_RANK: Record<CatalogItem["category"], number> = {
  focal: 0,
  filler: 1,
  green: 2,
};

export function placementOrder(stems: Stem[]): number[] {
  return stems
    .map((stem, i) => ({ i, rank: CATEGORY_RANK[getItemOrFallback(stem.itemId).category] }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((entry) => entry.i);
}

/**
 * Ring spacing adapts to what is actually in the bouquet: a fistful of
 * sunflowers needs more room between positions than a posy of lavender.
 * Still a pure function of state, so determinism holds.
 */
function ringSpacingMm(stems: Stem[]): number {
  if (stems.length === 0) return RING_SPACING_MIN_MM;
  const meanSquare =
    stems.reduce((sum, stem) => {
      const w = getItemOrFallback(stem.itemId).realWidthMm;
      return sum + w * w;
    }, 0) / stems.length;
  const spacing = (Math.sqrt(meanSquare) / 2) * RING_SPACING_FACTOR;
  return Math.min(RING_SPACING_MAX_MM, Math.max(RING_SPACING_MIN_MM, spacing));
}

export function computeLayout(width: number, height: number, state: BouquetState): Layout {
  const mmToPx = width / CANVAS_WIDTH_MM;
  return {
    width,
    height,
    tieX: state.tiePoint[0] * width,
    tieY: state.tiePoint[1] * height,
    mmToPx,
    ringSpacingPx: ringSpacingMm(state.stems) * mmToPx,
  };
}

/* -------------------------------------------------------------------------- */
/* Placement                                                                    */
/* -------------------------------------------------------------------------- */

export interface PlacedStem {
  key: string;
  /** Position of this stem in the source `state.stems` array. */
  stemIndex: number;
  stem: Stem;
  item: CatalogItem;
  variant: CatalogItem["variants"][number];
  /** Spiral ordinal (n in the formulas). */
  n: number;
  ring: number;
  scale: number;
  /** Golden-angle position, after jitter, in degrees. */
  angleDeg: number;
  /** Spiral radius in the head plane, after jitter, in pixels. */
  radiusPx: number;
  /** Head centre in canvas pixels. */
  headX: number;
  headY: number;
  /**
   * Rotation of the whole sprite about its anchor, in degrees, 0 = upright.
   * The anchor sits ON the tie point; this angle is what fans the head away.
   */
  rotationDeg: number;
  /** Tie point to head centre, in pixels: how long the stem reads on screen. */
  axisLengthPx: number;
  /** On-screen sprite width, from real millimetres. */
  widthPx: number;
  /** On-screen width of a single bloom within the sprite. */
  bloomPx: number;
  layer: LayerName;
}

/**
 * Place every stem.
 *
 * The transform each stem is drawn with is `translate(tieX, tieY) rotate(θ)`,
 * with the sprite's anchor at the origin of that frame and its head up the
 * negative-y axis at `axisLengthPx`. So the anchor genuinely sits on the tie
 * point and the rotation alone is what fans the head outward — θ and the axis
 * length are solved from the head position the golden-angle spiral asks for.
 */
export function placeStems(state: BouquetState, layout: Layout): PlacedStem[] {
  const order = placementOrder(state.stems);

  // The spiral is laid out at its natural spacing first, then reined in so the
  // whole mass stays inside the frame. Both corrections are single scalars
  // solved in closed form from the first pass, so the shape of the arrangement
  // is untouched — it just breathes in. Adding a thirtieth stem tightens the
  // bouquet instead of pushing flowers off the edge of the canvas.
  const natural = layoutPass(state, layout, order, 1, 1);
  const spiralFit = solveHorizontalFit(natural, layout);
  const widened = spiralFit === 1 ? natural : layoutPass(state, layout, order, spiralFit, 1);
  const riseFit = solveVerticalFit(widened, layout);
  if (riseFit === 1) return widened;
  return layoutPass(state, layout, order, spiralFit, riseFit);
}

/**
 * Largest uniform shrink of the spiral radius that keeps every head inside the
 * canvas horizontally. Head widths do not depend on the radius, so the
 * constraint `|dx| * s + width/2 <= limit` solves directly for each stem.
 */
function solveHorizontalFit(placed: PlacedStem[], layout: Layout): number {
  const limit = layout.width * FIT_HALF_WIDTH;
  let fit = 1;
  for (const stem of placed) {
    const dx = Math.abs(stem.headX - layout.tieX);
    if (dx < 1e-6) continue;
    const keep = stem.widthPx * FIT_SPRITE_MARGIN[stem.item.category];
    fit = Math.min(fit, Math.max(0, limit - keep) / dx);
  }
  return Math.min(1, fit);
}

/** The same, vertically: shrink how high stems carry their heads until the tallest fits. */
function solveVerticalFit(placed: PlacedStem[], layout: Layout): number {
  const limit = layout.height * FIT_TOP_MARGIN;
  let fit = 1;
  for (const stem of placed) {
    const rise = layout.tieY - stem.headY;
    if (rise < 1e-6) continue;
    const allowed = layout.tieY - limit - stem.widthPx * FIT_SPRITE_MARGIN[stem.item.category];
    fit = Math.min(fit, Math.max(0, allowed) / rise);
  }
  return Math.min(1, fit);
}

function layoutPass(
  state: BouquetState,
  layout: Layout,
  order: number[],
  spiralFit: number,
  riseFit: number,
): PlacedStem[] {
  return order.map((stemIndex, n) => {
    const stem = state.stems[stemIndex];
    const item = getItemOrFallback(stem.itemId);
    const variant = item.variants[stem.variant] ?? item.variants[0];

    const ring = ringForIndex(n);
    const scale = scaleForRing(ring);

    // Golden angle, plus +/-8 degrees of seeded jitter.
    const angleDeg =
      n * GOLDEN_ANGLE_DEG + randSigned(state.seed, n, "angle") * ANGLE_JITTER_DEG;

    // sqrt spiral, plus +/-6% of seeded jitter.
    const radiusPx =
      layout.ringSpacingPx *
      spiralFit *
      Math.sqrt(n) *
      (1 + randSigned(state.seed, n, "radius") * RADIUS_JITTER);

    // How far above the tie point this stem carries its head. Longer-stemmed
    // flowers stand taller; outer rings sit lower, which domes the mass.
    const risePx = item.stemLengthMm * layout.mmToPx * scale * riseFit;

    const angleRad = angleDeg * DEG;
    const dx = Math.sin(angleRad) * radiusPx;
    const dyRaw = -Math.cos(angleRad) * radiusPx;
    const dy = dyRaw * (dyRaw < 0 ? DOME_SQUASH_UP : DOME_SQUASH_DOWN);

    const offsetX = dx;
    const offsetY = -risePx + dy;

    const headX = layout.tieX + offsetX;
    const headY = layout.tieY + offsetY;

    // Solve the rotation that carries the head from straight-up to where the
    // spiral wants it. atan2(x, -y) because 0 degrees points up the screen.
    const rotationDeg = Math.atan2(offsetX, -offsetY) / DEG;
    const axisLengthPx = Math.hypot(offsetX, offsetY);

    return {
      key: `${stemIndex}:${stem.itemId}:${stem.variant}`,
      stemIndex,
      stem,
      item,
      variant,
      n,
      ring,
      scale,
      angleDeg,
      radiusPx,
      headX,
      headY,
      rotationDeg,
      axisLengthPx,
      widthPx: spriteWidthPx(item.realWidthMm, layout.width, scale),
      bloomPx: spriteWidthPx(item.bloomWidthMm, layout.width, scale),
      layer: layerFor(item, state.seed, n),
    };
  });
}

/**
 * Which layer a stem paints into. Greens are split: most fall behind the
 * focals, a seeded minority are promoted in front so the arrangement has
 * foliage reading over the top of the flowers, as in the reference bouquets.
 */
function layerFor(item: CatalogItem, seed: number, n: number): LayerName {
  if (item.category === "focal") return "focal";
  if (item.category === "filler") return "filler";
  return randChance(seed, n, "front-green", FRONT_GREEN_CHANCE) ? "front-greens" : "greens";
}

/**
 * Paint order within a layer: outer rings first, so they end up behind the
 * middle of the bouquet.
 */
export function sortWithinLayer(stems: PlacedStem[]): PlacedStem[] {
  return [...stems].sort((a, b) => b.ring - a.ring || a.n - b.n);
}

export function groupByLayer(placed: PlacedStem[]): Map<LayerName, PlacedStem[]> {
  const groups = new Map<LayerName, PlacedStem[]>();
  for (const stem of placed) {
    const bucket = groups.get(stem.layer);
    if (bucket) bucket.push(stem);
    else groups.set(stem.layer, [stem]);
  }
  for (const [layer, bucket] of groups) groups.set(layer, sortWithinLayer(bucket));
  return groups;
}

/* -------------------------------------------------------------------------- */
/* Clusters                                                                     */
/* -------------------------------------------------------------------------- */

export interface Floret {
  /** Offset from the head centre, in pixels. */
  x: number;
  y: number;
  /** Floret radius in pixels. */
  r: number;
}

/**
 * A sprig — baby's breath, eucalyptus, an orchid spray — is one stem carrying
 * many small blooms. Its sprite width comes from the sprig, its bloom width
 * from a single floret, and the count falls out of the ratio between them.
 * The florets are laid out with the same golden-angle spiral as the bouquet,
 * one scale down.
 */
export function clusterFlorets(placed: PlacedStem, seed: number): Floret[] {
  const { item } = placed;
  if (item.bloomWidthMm >= item.realWidthMm * CLUSTER_THRESHOLD) return [];

  const ratio = item.realWidthMm / item.bloomWidthMm;
  const count = Math.min(CLUSTER_MAX, Math.max(CLUSTER_MIN, Math.round(ratio * CLUSTER_DENSITY)));

  const floretR = placed.bloomPx / 2;
  const spread = Math.max(0, placed.widthPx / 2 - floretR);

  return Array.from({ length: count }, (_, k) => {
    const t = count === 1 ? 0 : k / (count - 1);
    const angle =
      (k * GOLDEN_ANGLE_DEG + randSigned(seed, placed.n, "floret-angle", k) * ANGLE_JITTER_DEG) *
      DEG;
    const r = spread * Math.sqrt(t) * (1 + randSigned(seed, placed.n, "floret-radius", k) * 0.12);
    return {
      x: Math.sin(angle) * r,
      // Sprigs read taller than they are wide, so the cluster is stretched
      // along the stem axis rather than kept circular.
      y: -Math.cos(angle) * r * 1.12,
      r: floretR * (0.78 + rand(seed, placed.n, "floret-size", k) * 0.44),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Derived measurements                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Bounding box of the flower mass, in canvas pixels. Used to size the wrap so
 * the collar always sits around the heads rather than at a fixed radius.
 */
export function headMassBounds(placed: PlacedStem[], layout: Layout) {
  if (placed.length === 0) {
    const r = layout.ringSpacingPx;
    return { minX: layout.tieX - r, maxX: layout.tieX + r, minY: layout.tieY - r, maxY: layout.tieY };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const stem of placed) {
    const r = stem.widthPx / 2;
    minX = Math.min(minX, stem.headX - r);
    maxX = Math.max(maxX, stem.headX + r);
    minY = Math.min(minY, stem.headY - r);
    maxY = Math.max(maxY, stem.headY + r);
  }
  return { minX, maxX, minY, maxY };
}
