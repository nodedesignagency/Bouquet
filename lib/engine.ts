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
import { rand, randSigned } from "./rng";
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
 * middle of the mass are compressed some, offsets below are compressed hard.
 * That is what a collar does to a real bouquet — the mass domes up and out but
 * is cut flat where the wrap holds it, instead of hanging down past the tie.
 *
 * Both are well under 1 so the head mass ends up wider than it is tall, the way
 * a hand-tie looks from the front. Left near 1, the spiral threw single stems
 * far above the rest and buried others behind the collar.
 */
const DOME_SQUASH_UP = 0.72;
const DOME_SQUASH_DOWN = 0.34;

/**
 * The downward drop also tapers toward the sides, so the bottom of the flower
 * mass is a smile rather than an arc bulging down.
 *
 * This is not decoration — it is the shape of the collar's rim. The paper's
 * mouth sits lowest in the middle and rises to a point at each side, so a
 * uniform radial drop puts the two curves on a collision course: a flower that
 * is both low and off to one side lands underneath a rising point and vanishes
 * behind the paper. Weighting the drop by `1 - u²` (u being how far across the
 * mass the stem sits) gives the mass a floor of the same family as the rim,
 * `2t(1-t)`, so the two never cross. Flowers at the sides ride up over the
 * points where they belong, and the ones that come forward and low are the
 * central ones — which is where they sit in a photograph.
 */
function domeFloorTaper(dx: number, maxRadius: number): number {
  if (maxRadius <= 0) return 1;
  const u = Math.min(1, Math.abs(dx) / maxRadius);
  return 1 - u * u;
}

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
 * How far a stem may lean out from vertical is set per band, in
 * `CATEGORY_BAND` — a flower that leans like a frond looks like it has fallen
 * over, and a frond that leans like a flower does not frame anything.
 *
 * A placeholder circle is rotationally symmetric, so this was hidden entirely
 * at first: the arrangement was rotating outer stems 70 degrees and it still
 * read as a dome. A photograph of a flower at 70 degrees reads as a flower
 * lying on its side.
 */

/** Where a band's first stem sits, in pixels from the tie point. */
function bandStartPx(band: CategoryBand, focalRadius: number, ringSpacingPx: number): number {
  return Math.max(focalRadius * band.bandStart, ringSpacingPx * band.bandStartMin);
}

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

/**
 * How far out a green must sit before it may be drawn in front of the flowers,
 * as a fraction of the arrangement's reach. Foliage drapes over the edge of a
 * bouquet; it does not lie across the middle of one.
 */
const FRONT_GREEN_REACH = 0.55;

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

/**
 * Scale multiplier for a ring: 12% smaller for each ring outward.
 *
 * Multiplied out rather than raised with `Math.pow`, whose result for
 * non-integer cases is implementation-defined — Node and the browser can
 * disagree in the last bit, which is enough to make the server and client
 * render different numbers and trip a hydration mismatch. IEEE multiplication
 * is exactly specified, so a loop gives the same answer everywhere.
 */
export function scaleForRing(ring: number): number {
  let scale = 1;
  for (let i = 0; i < ring; i += 1) scale *= 1 - RING_SCALE_FALLOFF;
  return scale;
}

/**
 * Rounds a coordinate before it reaches the DOM.
 *
 * The transcendental functions the placement maths leans on (sin, cos, atan2,
 * hypot) are also implementation-defined in their last bits, so raw results
 * are trimmed on the way out. Two decimal places is far finer than a pixel and
 * makes server and client agree exactly.
 */
export function px(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Placement order, which is not the same as the order stems were added.
 *
 * Focals take the middle, filler sits around them, greens land on the outside —
 * the way a florist actually builds up a hand-tie. Within a category the user's
 * own order is preserved, so the sort is stable and adding a stem never
 * reshuffles the ones already placed.
 */
const CATEGORY_RANK: Record<CatalogItem["category"], number> = {
  focal: 0,
  filler: 1,
  green: 2,
};

/**
 * How each kind of stem is placed, which is not a matter of degree.
 *
 * Look at a real hand-tie and the three roles do different jobs. The flowers
 * pack a dense disc in the middle. Filler threads through the gaps between them
 * and carries a little past the edge. Greenery is not in the mass at all — it
 * radiates out and up well beyond it, sparse and reaching, and it is what gives
 * a bouquet its outline.
 *
 * Running all three down one spiral could only ever make greens "the outermost
 * flowers": a ring or two further out, the same height, leaning the same
 * amount, packed at the same density. So each category gets its own band
 * instead — where it starts, how tightly it packs, how high it carries, how far
 * it may splay, and how much the collar's floor pulls it down.
 *
 * `bandStart` is a multiple of the flower mass's own radius, so the greenery
 * follows the flowers outward as more are added rather than being pinned to a
 * fixed distance.
 */
interface CategoryBand {
  /** Where this band's first stem sits, as a multiple of the flower radius. */
  bandStart: number;
  /** Floor for that, in ring spacings, for bouquets with few or no flowers. */
  bandStartMin: number;
  /** How tightly this category packs, relative to the flowers. */
  spacing: number;
  /** How high it carries its heads, relative to its cut length. */
  rise: number;
  /** How far it may lean out from vertical, in degrees. */
  maxLean: number;
  /** How much the collar's floor drags it down; greens keep their height. */
  floor: number;
}

const CATEGORY_BAND: Record<CatalogItem["category"], CategoryBand> = {
  // The mass. A dense phyllotaxis disc, upright, sitting in the collar.
  focal: { bandStart: 0, bandStartMin: 0, spacing: 1, rise: 1, maxLean: 42, floor: 1 },
  // Threaded through the flowers rather than ringed around them: filler starts
  // inside the disc and carries a little past its edge, which is where
  // gypsophila actually sits — in the gaps, peeking between the blooms. It
  // paints behind the focals, so what shows is exactly the part in the gaps.
  filler: { bandStart: 0.4, bandStartMin: 0.5, spacing: 1.2, rise: 1.02, maxLean: 54, floor: 0.7 },
  // Rooted among the flowers, reaching past them. The tips of a frond end up
  // outside the mass, but that is its LENGTH doing the reaching, not its
  // position: a spray is foliage all the way down its stem, so placing it out
  // where its tips belong strands the whole thing in empty space with a bare
  // stem trailing back. Started just inside the flowers' edge instead, so the
  // spray overlaps the mass and only its far end carries beyond.
  green: { bandStart: 0.6, bandStartMin: 0.9, spacing: 0.9, rise: 1.12, maxLean: 48, floor: 0.45 },
};

export interface PlacementSlot {
  /** Index into `state.stems`. */
  stemIndex: number;
  /** Ordinal across the whole bouquet — what sets the golden angle. */
  n: number;
  /** Ordinal within this stem's own category — what sets its radius and ring. */
  bandIndex: number;
  category: CatalogItem["category"];
}

/**
 * Every stem's place in the running order, and its place within its own band.
 *
 * The angle stays global: stem n sits at `n * 137.5°` across the whole bouquet,
 * so no two stems anywhere point the same way. Only the radius and ring come
 * from the band, which is what separates the greenery from the flowers without
 * disturbing the phyllotaxis.
 */
export function placementSlots(stems: Stem[]): PlacementSlot[] {
  const counts: Record<CatalogItem["category"], number> = { focal: 0, filler: 0, green: 0 };

  return stems
    .map((stem, i) => ({ i, category: getItemOrFallback(stem.itemId).category }))
    .sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] || a.i - b.i)
    .map((entry, n) => ({
      stemIndex: entry.i,
      n,
      bandIndex: counts[entry.category]++,
      category: entry.category,
    }));
}

export function placementOrder(stems: Stem[]): number[] {
  return placementSlots(stems).map((slot) => slot.stemIndex);
}

/**
 * Ring spacing adapts to what is actually in the bouquet: a fistful of
 * sunflowers needs more room between positions than a posy of lavender.
 * Still a pure function of state, so determinism holds.
 *
 * Measured over the flowers alone, since they are the mass whose density this
 * sets — and so that adding greenery, which sits in its own band further out,
 * does not reflow the flowers in the middle. A bouquet of nothing but foliage
 * falls back to measuring whatever it has.
 */
function ringSpacingMm(stems: Stem[]): number {
  const focals = stems.filter((stem) => getItemOrFallback(stem.itemId).category === "focal");
  const measured = focals.length > 0 ? focals : stems;
  if (measured.length === 0) return RING_SPACING_MIN_MM;

  const meanSquare =
    measured.reduce((sum, stem) => {
      const w = getItemOrFallback(stem.itemId).realWidthMm;
      return sum + w * w;
    }, 0) / measured.length;
  const spacing = (Math.sqrt(meanSquare) / 2) * RING_SPACING_FACTOR;
  return Math.min(RING_SPACING_MAX_MM, Math.max(RING_SPACING_MIN_MM, spacing));
}

/** How far the flower mass itself reaches, which is where the other bands start from. */
function focalRadiusPx(stems: Stem[], ringSpacingPx: number): number {
  const focals = stems.reduce(
    (n, stem) => n + (getItemOrFallback(stem.itemId).category === "focal" ? 1 : 0),
    0,
  );
  return ringSpacingPx * Math.sqrt(Math.max(0, focals - 1));
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
  /** Spiral ordinal across the whole bouquet — what sets the golden angle. */
  n: number;
  /** Ordinal within this stem's own category band — what sets its radius and ring. */
  bandIndex: number;
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
  /** How far above the tie point this stem carries its head, before the spiral. */
  risePx: number;
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
  const order = placementSlots(state.stems);

  // The spiral is laid out at its natural spacing first, then reined in so the
  // whole mass stays inside the frame. Both corrections are single scalars
  // solved in closed form from the first pass, so the shape of the arrangement
  // is untouched — it just breathes in. Adding a thirtieth stem tightens the
  // bouquet instead of pushing flowers off the edge of the canvas.
  const natural = layoutPass(state, layout, order, 1, 1);
  const spiralFit = Math.min(
    solveHorizontalFit(natural, layout),
    solveLeanFit(natural, layout),
  );
  const widened = spiralFit === 1 ? natural : layoutPass(state, layout, order, spiralFit, 1);
  const riseFit = solveVerticalFit(widened, layout);
  if (riseFit === 1) return widened;
  return layoutPass(state, layout, order, spiralFit, riseFit);
}

/**
 * Largest uniform shrink of the spiral radius that keeps every stem's lean
 * within `MAX_LEAN_DEG`.
 *
 * A stem leans by `atan(dx / rise)`, and shrinking the spiral scales both the
 * sideways offset and the part of the vertical offset the spiral contributes,
 * so the constraint solves directly:
 *
 *   |dx|·s <= tan(θ) · (rise - dy·s)   →   s <= tan(θ)·rise / (|dx| + tan(θ)·dy)
 *
 * Narrowing the bouquet rather than capping the angle keeps the spiral's
 * relative spacing intact — every stem still sits where phyllotaxis put it,
 * just closer in.
 */
function solveLeanFit(placed: PlacedStem[], layout: Layout): number {
  let fit = 1;

  for (const stem of placed) {
    const tan = Math.tan(CATEGORY_BAND[stem.item.category].maxLean * DEG);
    const dx = Math.abs(stem.headX - layout.tieX);
    // Split the vertical offset back into the stem's own rise and the spiral's
    // contribution, since only the latter shrinks with the fit.
    const rise = stem.risePx;
    const dy = rise - (layout.tieY - stem.headY);
    const denominator = dx + tan * dy;
    if (denominator <= 0) continue;
    fit = Math.min(fit, (tan * rise) / denominator);
  }

  return Math.max(0, Math.min(1, fit));
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
  order: PlacementSlot[],
  spiralFit: number,
  riseFit: number,
): PlacedStem[] {
  const focalRadius = focalRadiusPx(state.stems, layout.ringSpacingPx);

  // The widest any band can reach on this pass, in closed form: the outermost
  // stem of the band that goes furthest, at its largest jitter. The dome's
  // floor is measured against it, so the taper is relative to the mass rather
  // than to the canvas.
  const maxRadius =
    order.reduce((widest, slot) => {
      const band = CATEGORY_BAND[slot.category];
      const reach =
        bandStartPx(band, focalRadius, layout.ringSpacingPx) +
        band.spacing * layout.ringSpacingPx * Math.sqrt(slot.bandIndex);
      return Math.max(widest, reach);
    }, 0) *
    spiralFit *
    (1 + RADIUS_JITTER);

  return order.map(({ stemIndex, n, bandIndex, category }) => {
    const stem = state.stems[stemIndex];
    const item = getItemOrFallback(stem.itemId);

    const band = CATEGORY_BAND[category];
    // Ring, and so scale, counts within the band. Greenery in an outer band is
    // not a shrunken flower — the 12% falloff is about depth inside a mass, and
    // each band is its own mass.
    const ring = ringForIndex(bandIndex);
    const scale = scaleForRing(ring);

    // Golden angle on the global ordinal, so no two stems in the bouquet point
    // the same way whatever band they are in.
    const angleDeg =
      n * GOLDEN_ANGLE_DEG + randSigned(state.seed, n, "angle") * ANGLE_JITTER_DEG;

    // sqrt spiral within the band, offset to where the band begins, plus +/-6%
    // of seeded jitter.
    const radiusPx =
      (bandStartPx(band, focalRadius, layout.ringSpacingPx) +
        band.spacing * layout.ringSpacingPx * Math.sqrt(bandIndex)) *
      spiralFit *
      (1 + randSigned(state.seed, n, "radius") * RADIUS_JITTER);

    // How far above the tie point this stem carries its head.
    //
    // Deliberately NOT scaled by the ring. In a spiral hand-tie every stem is
    // the same length from the bind, so an outer flower sits lower because it
    // leans out, not because it is shorter. Shrinking the rise as well as the
    // sprite made outer stems both small and steep, which compounded into
    // flowers lying on their sides. The ring scale governs size, as the brief
    // says, and nothing else.
    const risePx = item.stemLengthMm * band.rise * layout.mmToPx * riseFit;

    const angleRad = angleDeg * DEG;
    const dx = Math.sin(angleRad) * radiusPx;
    const dyRaw = -Math.cos(angleRad) * radiusPx;
    const dy =
      dyRaw < 0
        ? dyRaw * DOME_SQUASH_UP
        : dyRaw * DOME_SQUASH_DOWN * band.floor * domeFloorTaper(dx, maxRadius);

    // The variant is settled only once the stem's side is known, because an
    // arching frond has to arc away from the bouquet rather than back into it.
    const variant = poseFor(item, stem.variant, dx);
    // A pose may be a different real size from the item — a bud is not as wide
    // as the flower it becomes, and an arching stem spans more than an upright.
    const widthMm = variant.widthMm ?? item.realWidthMm;

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
      bandIndex,
      ring,
      scale,
      angleDeg,
      radiusPx,
      headX,
      headY,
      rotationDeg,
      axisLengthPx,
      risePx,
      widthPx: spriteWidthPx(widthMm, layout.width, scale),
      bloomPx: spriteWidthPx(Math.min(item.bloomWidthMm, widthMm), layout.width, scale),
      layer: layerFor(item, dyRaw > 0, maxRadius > 0 ? Math.abs(dx) / maxRadius : 0),
    };
  });
}

/**
 * The pose a stem is actually drawn in.
 *
 * Usually just the stored variant. The exception is the mirrored foliage poses:
 * a frond that arches left belongs on the left of the bouquet, where it sweeps
 * outward, and the same sprite on the right arcs back over the flowers instead.
 * Which side a stem lands on is not known when it is added, so the choice is
 * made here, from the sign of its offset — the stored variant still decides
 * that this stem is an arching one rather than an upright or a sprig.
 */
function poseFor(item: CatalogItem, variantIndex: number, dx: number) {
  const variant = item.variants[variantIndex] ?? item.variants[0];
  const wanted =
    variant.facing === "arch-left" || variant.facing === "arch-right"
      ? dx < 0
        ? "arch-left"
        : "arch-right"
      : null;
  if (!wanted || variant.facing === wanted) return variant;
  return item.variants.find((candidate) => candidate.facing === wanted) ?? variant;
}

/**
 * Which layer a stem paints into.
 *
 * Greens are split, but not by a coin toss. Foliage that comes forward is
 * foliage on the near side of the dome, out toward the edge — a frond draping
 * over the rim of the bouquet. A blind chance promoted whichever green it
 * happened to land on, and a near-upright fern in the middle of the
 * arrangement, painted over every flower, is not foliage in front of a bouquet.
 * It is a fern lying on top of one.
 */
function layerFor(
  item: CatalogItem,
  nearSide: boolean,
  outFromCentre: number,
): LayerName {
  if (item.category === "focal") return "focal";
  if (item.category === "filler") return "filler";
  return nearSide && outFromCentre > FRONT_GREEN_REACH ? "front-greens" : "greens";
}

/**
 * Paint order within a layer: highest head first, so it ends up furthest back.
 *
 * Height and depth are the same axis in a bouquet. The head mass is a dome seen
 * from the front, so a flower on the far side of it projects high in the frame
 * and is partly hidden by everything in front; one on the near side projects low
 * and overlaps its neighbours. Sorting by `headY` makes that true by
 * construction — a flower cannot be drawn in front of another while sitting
 * above it.
 *
 * Ordering by ring instead, as this used to, broke the illusion: a small flower
 * flung high by the spiral would be painted over the big ones sitting below it,
 * and the mass stopped reading as a dome at all.
 *
 * A stem moved by hand takes precedence over both.
 */
export function sortWithinLayer(stems: PlacedStem[]): PlacedStem[] {
  return [...stems].sort(
    (a, b) => a.stem.depth - b.stem.depth || a.headY - b.headY || a.n - b.n,
  );
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
