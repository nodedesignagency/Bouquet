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
import type { BouquetState, CatalogItem, LayerName, Stem, StemCategory } from "./types";

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

/** Scale drops 12% per level toward the back. */
export const RING_SCALE_FALLOFF = 0.12;

/**
 * Ring spacing is derived from the root-mean-square head width rather than the
 * plain mean, because RMS leans toward the big heads — and the big heads are
 * the ones in the middle deciding how much room the arrangement needs. For a
 * bouquet of one flower type the two agree exactly; for a mixed one, RMS stops
 * three lilies from being spaced as if they were lavender.
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
const MIN_RISE_FIT = 0.45;

/**
 * How much of its own width a sprite must keep inside the frame, by category.
 * A focal flower cut in half by the edge looks like a mistake; a sprig of
 * eucalyptus running out of frame is just how these photographs are cropped.
 */
const FIT_SPRITE_MARGIN: Record<StemCategory, number> = {
  focal: 0.45,
  filler: 0.24,
  green: 0.15,
};

/**
 * How far out a green must stand before it may be drawn in front of the
 * flowers, as a fraction of the width of the flowers themselves.
 *
 * Just about a whole flower mass, which is to say: a green may come forward
 * only when it is standing beyond the flowers entirely. Foliage drapes over the
 * edge of a bouquet; it does not lie across the middle of one, and measured any
 * more loosely than this a fern in the front row is a fern painted over the
 * face of the arrangement.
 */
const FRONT_GREEN_REACH = 1;

/** A sprig is drawn as a cluster of florets when its bloom is much smaller. */
const CLUSTER_THRESHOLD = 0.8;
const CLUSTER_MIN = 3;
const CLUSTER_MAX = 18;
const CLUSTER_DENSITY = 1.6;

const DEG = Math.PI / 180;

/* -------------------------------------------------------------------------- */
/* Levels                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A bouquet is built in rows, not in a cloud.
 *
 * Front to back, a hand-tie is a small number of distinct courses. The front
 * row sits down on the rim of the wrap and hides everything behind it. Each row
 * back sits a little higher, a little smaller, and is partly covered by the row
 * in front. That is the whole illusion, and it is the one thing a continuous
 * dome of jittered positions could never quite produce: with every stem at its
 * own arbitrary depth, "in front" and "lower down" kept disagreeing, and two
 * flowers at nearly the same depth would land on top of each other with no
 * reason for one to be over the other.
 *
 * So depth is discrete here. A stem's LEVEL is a whole number, 0 is the front
 * row, and it decides three things together:
 *
 *   - paint order   — level 0 is painted last, over everything behind it
 *   - height        — level 0 sits lowest, right at the wrap's rim, and each
 *                     level back carries its heads higher
 *   - size          — 12% smaller per level back, which is what perspective does
 *
 * Because one number drives all three, they cannot contradict each other. A
 * flower drawn in front is always the lower one; a flower that shows above the
 * others is always behind them. Moving a stem forward with the depth control
 * moves it DOWN and toward the rim as well as over its neighbours, which is
 * what happens when a florist actually pulls a stem forward in the bunch.
 */
const MAX_LEVELS = 4;

/**
 * How many rows a course of `count` stems is built in.
 *
 * Roughly square: 4 stems make two rows of two, 9 make three rows of three.
 * Computed with integer multiplication rather than `Math.sqrt` because the
 * result decides the whole structure, and this runs on the server and in the
 * browser and the two have to agree exactly.
 */
export function levelCount(count: number): number {
  if (count <= 1) return 1;
  let levels = 1;
  while (levels * levels < count && levels < MAX_LEVELS) levels += 1;
  return levels;
}

/**
 * Scale multiplier for a level: 12% smaller for each level toward the back.
 *
 * Multiplied out rather than raised with `Math.pow`, whose result for
 * non-integer cases is implementation-defined — Node and the browser can
 * disagree in the last bit, which is enough to make the server and client
 * render different numbers and trip a hydration mismatch. IEEE multiplication
 * is exactly specified, so a loop gives the same answer everywhere.
 */
export function scaleForLevel(level: number): number {
  let scale = 1;
  for (let i = 0; i < level; i += 1) scale *= 1 - RING_SCALE_FALLOFF;
  return scale;
}

/** How much narrower the back row is than the front one. */
const LEVEL_NARROW = 0.16;

/**
 * How far past its own minimum a capped category may still spread when there
 * are barely any flowers to measure against, in `spreadMin` units. Without it a
 * bouquet of two roses and eight ferns caps the ferns to the width of the two
 * roses and stacks them all in one place.
 */
const SPREAD_CEILING_FLOOR = 1.6;

/**
 * How far each row back stands above the one in front, in ring spacings.
 *
 * This is the single number that decides whether a bouquet reads as a bouquet.
 * A head is `2 / RING_SPACING_FACTOR` ring spacings across, so 1.15 shows a
 * little over half of every flower above the row in front of it — which is
 * what every reference photograph does. Too little and the rows collapse into
 * one plane, where a small flower ends up entirely behind a big one and is
 * simply wasted; too much and the bouquet becomes a staircase.
 */
const ROW_STEP_RINGS = 1.15;

/**
 * How much shallower the step is at the sides than in the middle. Rows fan out
 * as well as up, so at the edge of the arrangement they crowd together — which
 * is what a dome does when you look at it straight on.
 */
const ROW_STEP_TAPER = 0.25;

/**
 * How far the front row sinks toward the rim of the wrap, in ring spacings.
 *
 * Weighted by `1 - u²` across the width of the flowers, which is not decoration
 * — it is the shape of the collar's rim. The paper's mouth sits lowest in the
 * middle and rises to a point at each side, so a uniform drop puts the two
 * curves on a collision course: a flower both low and off to one side lands
 * underneath a rising point and vanishes behind the paper. `1 - u²` is the same
 * family as the rim's own `2t(1-t)`, so the two never cross. The front row
 * follows the mouth of the wrap, which is exactly where a florist rests it.
 */
const DOME_DROP_RINGS = 0.9;

/**
 * The tallest the back row may stand above the tie, as a fraction of the room
 * there is above it.
 *
 * The row step is a fixed distance, so a tall stack of big flowers would walk
 * straight out of the frame. Capping the total here rather than leaving it to
 * the vertical fit matters: the fit shortens the STEMS, and shortening the
 * stems of a bouquet whose rows are too tall gives you short stems and a bouquet
 * that is still too tall.
 */
const DOME_LIFT_CAP = 0.4;

/**
 * How far a stem may stand proud of its own row, as a share of the row step.
 * Under a half, so no stem is ever nearer the next row's line than its own.
 */
const ROW_WOBBLE = 0.22;

/**
 * Row sizes. The front row carries a few more stems than the back one, because
 * it is the row you actually see; a category pushed to the back (`backBias`)
 * inverts that and stacks up behind the flowers instead.
 */
const LEVEL_FACE_WEIGHT = 0.6;
const LEVEL_BACK_BASE = 0.2;
const LEVEL_BACK_SLOPE = 1.6;

/**
 * How much say the spiral has over which row a stem stands in, against the size
 * of its head.
 *
 * Which row a bloom belongs in is settled by how big it is, and this is not a
 * matter of taste — it is the only thing that keeps every flower visible. A head
 * in a back row shows the crescent of itself that clears the head in front, and
 * that crescent is `rowStep + radiusBack - radiusFront` tall. Put a big bloom in
 * front of a small one and the crescent goes to nothing: a rose bud standing
 * behind an open lily is a flower you have paid for and cannot see. Ordering the
 * rows small to large makes the crescent at least a full row step, always. It is
 * also how a hand-tie is actually built — the statement blooms sit up and back,
 * the buds and small heads face out over the rim.
 *
 * The golden-angle spiral still has a say, but only among heads of a similar
 * size: at 0.25, roughly, it may reorder blooms within a quarter of the mean
 * head width of each other, so a row of eight roses is not sorted by millimetre.
 */
const SPIRAL_DEPTH = 0.25;

/**
 * How each kind of stem is arranged, which is not a matter of degree.
 *
 * Look at a real hand-tie and the three roles do different jobs. The flowers
 * are the rows: they fill the face of the bouquet from the front row back.
 * Filler threads between them, half a place off the flowers' own pitch so it
 * lands in the gaps rather than behind the blooms, and carries a little higher
 * so its airy tips show over the top. Greenery is not in the face at all — it
 * stacks up behind, spread wider than the flowers and kept clear of the middle,
 * so it reads as the background the bouquet sits against. Only foliage that
 * ends up in the front row at the very edge is allowed over the flowers, which
 * is a frond draping over the rim.
 *
 * Every measurement here is relative to the flower mass, so greenery follows
 * the flowers outward as more are added rather than being pinned to a distance.
 */
interface CategoryLevels {
  /** Half-width of this category's rows, as a multiple of the flower mass's. */
  spread: number;
  /** Floor for that, in ring spacings, for bouquets with few or no flowers. */
  spreadMin: number;
  /**
   * Ceiling for it, as a multiple of the flower mass. Absent means none.
   *
   * A row widens to hold whatever stands in it, which is right for the flowers
   * — they must not crowd — and wrong for everything else. Twelve stems of
   * eucalyptus given all the room they ask for fan out into a peacock's tail
   * five times the width of the flowers they are supposed to be standing behind.
   * Past the ceiling, foliage overlaps itself instead of spreading, which is
   * what a thicket of foliage does.
   */
  spreadMax?: number;
  /**
   * How much neighbouring stems in a row may overlap, as a fraction of their
   * own width — which is a different number for each role, not a global taste
   * setting. Two flowers overlapping by half means one of them was a waste of
   * money. Two fronds overlapping by half is what foliage looks like.
   */
  overlap: number;
  /**
   * How much of the middle of a row this category leaves empty, as a fraction
   * of its half-width. Flowers fill the middle; foliage stays out of it.
   */
  centreClear: number;
  /**
   * Fraction of a row's pitch the whole row is shifted by, flipping direction
   * level by level so the bouquet stays balanced.
   *
   * At a quarter, neighbouring rows come out half a pitch apart — a brick bond,
   * so every flower in a back row stands in the gap between two in front of it
   * and shows itself. Laid out on the same positions row after row, the rows
   * become columns and the back ones might as well not be there.
   */
  stagger: number;
  /** How high it carries its heads, relative to its cut length. */
  rise: number;
  /** Pull toward the back rows. 0 fills the front row first, 1 the back. */
  backBias: number;
  /** How far it may lean out from vertical, in degrees. */
  maxLean: number;
  /** How much of the dome's drop it takes; greenery keeps its height. */
  floor: number;
}

const CATEGORY_LEVELS: Record<StemCategory, CategoryLevels> = {
  // The face of the bouquet. Fills its rows from the middle outward, brick-bonded
  // row to row so nothing is hidden behind the flower in front of it.
  focal: {
    spread: 1,
    spreadMin: 0.6,
    overlap: 0.22,
    centreClear: 0,
    stagger: 0.25,
    rise: 1,
    backBias: 0,
    maxLean: 42,
    floor: 1,
  },
  // In the gaps, not behind the blooms. Half a pitch off the flowers' rows and
  // a touch wider, carried slightly higher and drawn behind the focals — so
  // what shows of a stem of gypsophila is exactly the part in a gap.
  filler: {
    spread: 1.12,
    spreadMin: 1.1,
    spreadMax: 1.5,
    overlap: 0.45,
    centreClear: 0.18,
    stagger: 0.5,
    rise: 1.02,
    backBias: 0.45,
    maxLean: 54,
    floor: 0.8,
  },
  // The background. Wider than the flowers, weighted to the back rows and held
  // out of the middle, where a frond painted across the face of a bouquet is
  // not foliage behind it — it is a fern lying on top of one. Free to overlap
  // itself, because a thicket of foliage is a thicket.
  green: {
    spread: 1.3,
    spreadMin: 1.5,
    spreadMax: 1.9,
    overlap: 0.55,
    centreClear: 0.45,
    stagger: 0.32,
    rise: 1.05,
    backBias: 0.62,
    maxLean: 48,
    floor: 0.55,
  },
};

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
  /** Spacing between neighbouring heads' positions, in pixels. */
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

/**
 * Rounds a coordinate before it reaches the DOM.
 *
 * The transcendental functions the placement maths leans on (sin, cos, atan2,
 * hypot) are implementation-defined in their last bits, so raw results are
 * trimmed on the way out. Two decimal places is far finer than a pixel and
 * makes server and client agree exactly.
 */
export function px(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Quantises a value that is about to be SORTED on.
 *
 * Same problem as `px`, one step earlier and with worse consequences: if the
 * server and the browser disagree in the last bit of a sort key, they do not
 * draw the same picture slightly differently — they put a different flower in
 * the front row. Rounding to a coarse quantum first turns any such difference
 * into an exact tie, and every sort here breaks ties on an integer.
 */
function sortKey(value: number): number {
  return Math.round(value * 1e6);
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Placement order, which is not the same as the order stems were added.
 *
 * Flowers are placed first, then filler, then greens — the way a florist
 * actually builds up a hand-tie. Within a category the user's own order is
 * preserved, so the sort is stable and adding a stem never reshuffles the ones
 * already placed.
 */
const CATEGORY_RANK: Record<StemCategory, number> = { focal: 0, filler: 1, green: 2 };

export interface PlacementSlot {
  /** Index into `state.stems`. */
  stemIndex: number;
  /** Ordinal across the whole bouquet — what sets the golden angle. */
  n: number;
  /** Ordinal within this stem's own category — what sets its place in the plan. */
  bandIndex: number;
  category: StemCategory;
}

/**
 * Every stem's place in the running order, and its place within its own course.
 *
 * The angle stays global: stem n sits at `n * 137.5°` across the whole bouquet,
 * so no two stems anywhere point the same way. Only the plan radius comes from
 * the category, which is what lets the greenery be laid out as its own course
 * without disturbing the flowers.
 */
export function placementSlots(stems: Stem[]): PlacementSlot[] {
  const counts: Record<StemCategory, number> = { focal: 0, filler: 0, green: 0 };

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

/* -------------------------------------------------------------------------- */
/* The plan                                                                     */
/* -------------------------------------------------------------------------- */

export interface StemPlan extends PlacementSlot {
  /** Golden-angle position, after jitter, in degrees. */
  angleDeg: number;
  /** Which row this stem stands in. 0 is the front row. */
  level: number;
  /** How many rows this stem's category is built in. */
  levels: number;
  /** Its place along that row, left to right. */
  slot: number;
  /** How many stems share the row. */
  slotCount: number;
  /**
   * Where the spiral put this stem front to back, -1 to 1, before its row was
   * settled. Rows are otherwise perfectly level, and a bouquet whose every row
   * is a straight line is a hedge; this is what lets a stem sit a little proud
   * of its row or a little back into it without leaving it.
   */
  depthWithin: number;
}

/**
 * Which row every stem stands in, and where along it — the whole discrete
 * structure of the arrangement, before a single pixel is worked out.
 *
 * Deliberately free of the canvas: every quantity that decides a row or an
 * order is measured in ring spacings, which cancel, so the plan is the same
 * whatever size the bouquet is drawn at. That is what lets the stem list and
 * the persisted state name a stem's row without laying out the canvas first.
 */
export function planStems(state: Pick<BouquetState, "seed" | "stems">): StemPlan[] {
  const slots = placementSlots(state.stems);

  // The plan view: the golden-angle spiral seen from above, in ring spacings.
  const spiral = slots.map((slot) => {
    const angleDeg =
      slot.n * GOLDEN_ANGLE_DEG + randSigned(state.seed, slot.n, "angle") * ANGLE_JITTER_DEG;
    const angleRad = angleDeg * DEG;
    const planRadius = Math.sqrt(slot.bandIndex);
    return {
      slot,
      angleDeg,
      planRadius,
      // Across the plan, which is what orders a row left to right.
      planX: Math.sin(angleRad) * planRadius,
      // Toward the viewer, which is what decides the row.
      planZ: -Math.cos(angleRad) * planRadius,
    };
  });

  const plan: StemPlan[] = [];

  for (const category of ["focal", "filler", "green"] as const) {
    const members = spiral.filter((entry) => entry.slot.category === category);
    if (members.length === 0) continue;

    const config = CATEGORY_LEVELS[category];
    const levels = levelCount(members.length);
    const capacities = levelCapacities(members.length, levels, config.backBias);
    const maxPlanRadius = Math.max(1, ...members.map((e) => e.planRadius));

    // Nearest the viewer first: smallest heads face the front, biggest anchor
    // the back, and the spiral shuffles the ones that are much of a muchness.
    const widths = members.map((entry) => headWidthMm(state.stems[entry.slot.stemIndex]));
    const meanWidth = Math.max(1, widths.reduce((sum, w) => sum + w, 0) / widths.length);
    const ranked = members
      .map((entry, i) => ({
        entry,
        front: sortKey(-widths[i] / meanWidth + SPIRAL_DEPTH * (entry.planZ / maxPlanRadius)),
      }))
      .sort((a, b) => b.front - a.front || a.entry.slot.bandIndex - b.entry.slot.bandIndex);

    // Fill the rows front to back, then let the depth control move a stem
    // between them. Moving a stem forward is a real move, not a repaint: it
    // changes the row it stands in, so it comes down toward the rim and over
    // its neighbours together, the way pulling a stem forward actually looks.
    const rows: Array<Array<{ entry: (typeof members)[number]; level: number }>> = Array.from(
      { length: levels },
      () => [],
    );
    let assigned = 0;
    for (let level = 0; level < levels; level += 1) {
      for (let k = 0; k < capacities[level] && assigned < ranked.length; k += 1) {
        const { entry } = ranked[assigned];
        assigned += 1;
        const depth = state.stems[entry.slot.stemIndex]?.depth ?? 0;
        const moved = clamp(level - depth, 0, levels - 1);
        rows[moved].push({ entry, level: moved });
      }
    }

    for (let level = 0; level < levels; level += 1) {
      const row = rows[level].sort(
        (a, b) =>
          sortKey(a.entry.planX) - sortKey(b.entry.planX) ||
          a.entry.slot.bandIndex - b.entry.slot.bandIndex,
      );
      row.forEach((member, slot) => {
        plan.push({
          ...member.entry.slot,
          angleDeg: member.entry.angleDeg,
          level,
          levels,
          slot,
          slotCount: row.length,
          depthWithin: member.entry.planZ / maxPlanRadius,
        });
      });
    }
  }

  return plan.sort((a, b) => a.n - b.n);
}

/**
 * The real width of the pose a stem is stored in.
 *
 * The pose, not the item: a bud is half the flower it will become, and treating
 * it as a full bloom is what put one behind a lily where it could not be seen.
 * The mirrored foliage poses are not settled until a stem knows which side of
 * the bouquet it landed on, but they are within a few millimetres of each other,
 * so the stored one is a good enough answer for spacing and ordering.
 */
function headWidthMm(stem: Stem | undefined): number {
  if (!stem) return 0;
  const item = getItemOrFallback(stem.itemId);
  const variant = item.variants[stem.variant] ?? item.variants[0];
  return variant?.widthMm ?? item.realWidthMm;
}

/**
 * How many stems stand in each row.
 *
 * Largest-remainder over a weight curve, so the count is exact and the split is
 * stable: adding one stem to a course adds it to one row rather than reshuffling
 * all of them. Flowers weight the front row, which is the one being looked at;
 * greenery weights the back, which is the one holding the shape up behind.
 */
function levelCapacities(count: number, levels: number, backBias: number): number[] {
  const weights = Array.from({ length: levels }, (_, level) => {
    const t = levels > 1 ? level / (levels - 1) : 0;
    return (
      (1 - backBias) * (1 + LEVEL_FACE_WEIGHT * (1 - t)) +
      backBias * (LEVEL_BACK_BASE + LEVEL_BACK_SLOPE * t)
    );
  });

  const total = weights.reduce((sum, w) => sum + w, 0);
  const exact = weights.map((w) => (count * w) / total);
  const capacities = exact.map(Math.floor);
  let left = count - capacities.reduce((sum, c) => sum + c, 0);

  const byRemainder = exact
    .map((value, level) => ({ level, remainder: sortKey(value - capacities[level]) }))
    .sort((a, b) => b.remainder - a.remainder || a.level - b.level);
  for (const { level } of byRemainder) {
    if (left <= 0) break;
    capacities[level] += 1;
    left -= 1;
  }

  return capacities;
}

/**
 * Opens an empty band through the middle of a row.
 *
 * `even` runs -1 to 1 across the row; the result runs across the same range with
 * a band of width `clear` taken out of the middle, so a category that has no
 * business in the face of the bouquet is laid out around it rather than through
 * it. A row of one stands at the near edge of that band rather than in the
 * middle of it, on alternating sides row by row — which is how a single frond
 * ends up beside the flowers instead of standing up through them.
 */
function openCentre(even: number, clear: number, level: number): number {
  const side = even === 0 ? rowStaggerSign(level) : even < 0 ? -1 : 1;
  return side * (clear + Math.abs(even) * (1 - clear));
}

/** Which way a row's brick bond is offset. Alternating, so the bouquet stays balanced. */
function rowStaggerSign(level: number): number {
  return level % 2 === 0 ? 1 : -1;
}

/**
 * Ring spacing adapts to what is actually in the bouquet: a fistful of
 * sunflowers needs more room between positions than a posy of lavender.
 * Still a pure function of state, so determinism holds.
 *
 * Measured over the flowers alone, since they are the face whose density this
 * sets — and so that adding greenery, which has its own rows further out, does
 * not reflow the flowers. A bouquet of nothing but foliage falls back to
 * measuring whatever it has.
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
  /** Ordinal within this stem's own category. */
  bandIndex: number;
  /** Which row it stands in. 0 is the front row: lowest, largest, painted last. */
  level: number;
  /** How many rows its category is built in. */
  levels: number;
  /** Its place along the row, left to right. */
  slot: number;
  slotCount: number;
  scale: number;
  /** Golden-angle position, after jitter, in degrees. */
  angleDeg: number;
  /** How far the head sits from the middle of the arrangement, in pixels. */
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
  /** How high above the tie point this stem carries its head, before the dome. */
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
 * length are solved from the head position the rows ask for.
 */
export function placeStems(state: BouquetState, layout: Layout): PlacedStem[] {
  const plan = planStems(state);

  // The rows are laid out at their natural width first, then reined in so the
  // whole arrangement stays inside the frame. Both corrections are single
  // scalars solved in closed form from the first pass, so the structure is
  // untouched — it just breathes in. Adding a thirtieth stem tightens the
  // bouquet instead of pushing flowers off the edge of the canvas.
  const natural = layoutPass(state, layout, plan, 1, 1);
  const spreadFit = Math.min(
    solveHorizontalFit(natural, layout),
    solveLeanFit(natural, layout),
  );
  const widened = spreadFit === 1 ? natural : layoutPass(state, layout, plan, spreadFit, 1);
  const riseFit = solveVerticalFit(widened, layout);
  if (riseFit === 1) return widened;
  return layoutPass(state, layout, plan, spreadFit, riseFit);
}

/**
 * Largest uniform narrowing of the rows that keeps every stem's lean within its
 * category's limit.
 *
 * A stem leans by `atan(dx / above)`, where `above` is how high it carries its
 * head. Narrowing the rows scales `dx` and leaves `above` alone — the dome's
 * drop is a function of where a stem sits ACROSS the row, which narrowing does
 * not change — so the constraint solves directly for each stem.
 *
 * Narrowing rather than capping the angle keeps the rows' relative spacing
 * intact: every stem still stands where the plan put it, just closer in.
 */
function solveLeanFit(placed: PlacedStem[], layout: Layout): number {
  let fit = 1;

  for (const stem of placed) {
    const tan = Math.tan(CATEGORY_LEVELS[stem.item.category].maxLean * DEG);
    const dx = Math.abs(stem.headX - layout.tieX);
    const above = layout.tieY - stem.headY;
    if (dx < 1e-6 || above <= 0) continue;
    fit = Math.min(fit, (tan * above) / dx);
  }

  return Math.max(0, Math.min(1, fit));
}

/**
 * Largest uniform narrowing that keeps every head inside the canvas
 * horizontally. Head widths do not depend on the row's width, so the constraint
 * `|dx| * s + width/2 <= limit` solves directly for each stem.
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

/**
 * The same, vertically: shrink how high stems carry their heads until the
 * tallest fits.
 *
 * A head sits `risePx - dy` above the tie, and only `risePx` responds to the
 * fit — the dome's own rise and fall is fixed by which row the stem stands in.
 * So the fit is solved against the rise alone, with the dome's contribution
 * held back out of it.
 */
function solveVerticalFit(placed: PlacedStem[], layout: Layout): number {
  const limit = layout.height * FIT_TOP_MARGIN;
  let fit = 1;
  for (const stem of placed) {
    if (stem.risePx < 1e-6) continue;
    const above = layout.tieY - stem.headY;
    if (above < 1e-6) continue;
    const allowed = layout.tieY - limit - stem.widthPx * FIT_SPRITE_MARGIN[stem.item.category];
    // headY = tieY - risePx + dy, so dy = risePx - above.
    const dy = stem.risePx - above;
    fit = Math.min(fit, Math.max(0, allowed + dy) / stem.risePx);
  }
  // Never shorten the stems to nothing. If a bouquet is still too tall at this
  // point it is the ROWS that are too tall, and the row step is capped for
  // exactly that; cutting the stems any further past here just buries the heads
  // in the wrap.
  return Math.min(1, Math.max(MIN_RISE_FIT, fit));
}

/**
 * One row of the bouquet, measured.
 *
 * A row is spaced by the widths of the stems ACTUALLY IN IT, pair by pair, not
 * by an average for the whole category. The average was the last place a big
 * bloom and a small one could still collide: a row spaced for the mean of a
 * mixed bouquet leaves an open lily and a rose bud the same gap, which is far
 * too much for one and nowhere near enough for the other.
 */
interface Row {
  seats: Seat[];
  /** Position of each seat along the row, -1 to 1, at the row's natural width. */
  even: number[];
  /** Half the width the row needs to hold its stems at their allowed overlap. */
  naturalHalf: number;
}

interface Seat {
  plan: StemPlan;
  stem: Stem;
  item: CatalogItem;
  scale: number;
  /** The width this stem takes up in its row, on screen. */
  spacingPx: number;
}

function rowKey(category: StemCategory, level: number): string {
  return `${category}:${level}`;
}

/**
 * Lay every row out at its natural width.
 *
 * Neighbours are set `((wa + wb) / 2) * (1 - overlap)` apart, so every pair in
 * the row overlaps by exactly what its category allows whatever sizes the two
 * of them are. That is the guarantee the whole "no piling up" rule rests on,
 * and it cannot be made by any single pitch.
 */
function buildRows(state: BouquetState, layout: Layout, plan: StemPlan[]): Map<string, Row> {
  const rows = new Map<string, Row>();

  for (const entry of plan) {
    const stem = state.stems[entry.stemIndex];
    const item = getItemOrFallback(stem.itemId);
    const scale = scaleForLevel(entry.level);
    const seat: Seat = {
      plan: entry,
      stem,
      item,
      scale,
      spacingPx: spriteWidthPx(headWidthMm(stem), layout.width, scale),
    };
    const key = rowKey(entry.category, entry.level);
    const row = rows.get(key);
    if (row) row.seats.push(seat);
    else rows.set(key, { seats: [seat], even: [], naturalHalf: 0 });
  }

  for (const [, row] of rows) {
    row.seats.sort((a, b) => a.plan.slot - b.plan.slot);
    const overlap = CATEGORY_LEVELS[row.seats[0].plan.category].overlap;

    const along = [0];
    for (let i = 1; i < row.seats.length; i += 1) {
      const gap = ((row.seats[i - 1].spacingPx + row.seats[i].spacingPx) / 2) * (1 - overlap);
      along.push(along[i - 1] + gap);
    }
    // Centre the row on what it LOOKS like, not on where its stems' middles
    // happen to fall. A row that ends in an open lily on one side and a bud on
    // the other has far more of itself on the lily's side, and centring the
    // middles leaves the whole bouquet visibly hanging off to one edge.
    const span = along[along.length - 1];
    const first = row.seats[0].spacingPx;
    const last = row.seats[row.seats.length - 1].spacingPx;
    const centre = (span + (last - first) / 2) / 2;
    // The longer arm, not half the span: the row is normalised against it, so
    // it is also the width the row must be given for its gaps to come out at
    // the spacing they were just worked out to.
    const arm = Math.max(centre, span - centre) || 1;
    row.even = along.map((at) => (at - centre) / arm);
    // The centre band is empty, so the stems have `1 - centreClear` of the row
    // to stand in: widen to compensate rather than let them crowd.
    row.naturalHalf = arm / (1 - CATEGORY_LEVELS[row.seats[0].plan.category].centreClear);
  }

  return rows;
}

/**
 * One spacing per category, for the brick bond to be measured in.
 *
 * The bond has to be the SAME distance in every row of a category and only flip
 * direction, or it does not cancel: rows hold different stems, so a bond
 * measured off each row's own widths shifts a row of lilies further than a row
 * of buds and leaves the whole bouquet hanging to one side.
 */
function categoryPitchPx(rows: Map<string, Row>): Record<StemCategory, number> {
  const totals: Record<StemCategory, { sum: number; count: number }> = {
    focal: { sum: 0, count: 0 },
    filler: { sum: 0, count: 0 },
    green: { sum: 0, count: 0 },
  };
  for (const [, row] of rows) {
    for (const seat of row.seats) {
      totals[seat.plan.category].sum += seat.spacingPx;
      totals[seat.plan.category].count += 1;
    }
  }
  const pitch = {} as Record<StemCategory, number>;
  for (const category of ["focal", "filler", "green"] as const) {
    const { sum, count } = totals[category];
    pitch[category] =
      count > 0 ? (sum / count) * (1 - CATEGORY_LEVELS[category].overlap) : 0;
  }
  return pitch;
}

/** How wide the flower rows are: the widest row of flowers, at its natural width. */
function massHalfPx(rows: Map<string, Row>): number {
  let widest = 0;
  for (const [, row] of rows) {
    if (row.seats[0].plan.category !== "focal") continue;
    widest = Math.max(widest, row.naturalHalf);
  }
  return widest;
}

/** Half-width a row is laid out at: wide enough for its category, never tighter than its own stems need. */
function rowHalfPx(row: Row, massHalf: number, ringSpacingPx: number): number {
  const { category, level, levels } = row.seats[0].plan;
  const config = CATEGORY_LEVELS[category];
  const t = levels > 1 ? level / (levels - 1) : 0.5;
  const wanted =
    Math.max(massHalf * config.spread, ringSpacingPx * config.spreadMin) *
    (1 - LEVEL_NARROW * t);
  const asked = Math.max(wanted, row.naturalHalf);
  if (config.spreadMax === undefined) return asked;
  const ceiling = Math.max(
    massHalf * config.spreadMax,
    ringSpacingPx * config.spreadMin * SPREAD_CEILING_FLOOR,
    wanted,
  );
  return Math.min(asked, ceiling);
}

function layoutPass(
  state: BouquetState,
  layout: Layout,
  plan: StemPlan[],
  spreadFit: number,
  riseFit: number,
): PlacedStem[] {
  const rows = buildRows(state, layout, plan);
  const massHalf = massHalfPx(rows);

  // The dome is one surface over the whole arrangement, so how far across it a
  // stem sits is measured against a single width rather than against its own
  // row — otherwise the greenery, laid out wider, would ride its own curve and
  // the two would not meet.
  //
  // That width is the FLOWERS' width, and deliberately so: it is the last thing
  // in the layout that could have let a category disturb another. Measured
  // across everything, adding a stem of eucalyptus would widen the dome and
  // every flower in the bouquet would shift as a result. Greenery reaching past
  // the flowers simply sits at the edge of the dome, where the curve has
  // levelled off anyway.
  const domeHalf = Math.max(massHalf, layout.ringSpacingPx);

  // How far apart the rows stand, capped so a deep bouquet of big flowers does
  // not walk off the top of the frame.
  const backRow = plan.reduce((deepest, entry) => Math.max(deepest, entry.level), 0);
  const headroom = Math.max(0, layout.tieY - layout.height * FIT_TOP_MARGIN) * DOME_LIFT_CAP;
  const stepPx =
    backRow > 0
      ? Math.min(ROW_STEP_RINGS * layout.ringSpacingPx, headroom / backRow)
      : ROW_STEP_RINGS * layout.ringSpacingPx;
  const dropPx = DOME_DROP_RINGS * layout.ringSpacingPx;

  // Where every stem stands across the canvas, worked out first and on its own,
  // because how far the flowers actually reach is what decides whether a frond
  // is standing outside them or across them.
  const bondPitch = categoryPitchPx(rows);
  const across = new Map<StemPlan, number>();
  for (const [, row] of rows) {
    const config = CATEGORY_LEVELS[row.seats[0].plan.category];
    const half = rowHalfPx(row, massHalf, layout.ringSpacingPx) * spreadFit;
    // The brick bond is a fixed distance — a share of the row's own spacing —
    // not a share of the row's width. Rows hold different numbers of stems, so
    // measured as a share of the width it would shove a row of two half a
    // bouquet sideways and barely move a row of five.
    const bond =
      config.stagger *
      bondPitch[row.seats[0].plan.category] *
      rowStaggerSign(row.seats[0].plan.level) *
      spreadFit;
    row.seats.forEach((seat, i) => {
      // The +/-6% of seeded jitter the brief asks for, so a row is regular
      // without being a picket fence.
      const jitter = 1 + randSigned(state.seed, seat.plan.n, "radius") * RADIUS_JITTER;
      across.set(seat.plan, openCentre(row.even[i], config.centreClear, seat.plan.level) * half * jitter + bond);
    });
  }

  const focalReach = plan.reduce(
    (reach, entry) =>
      entry.category === "focal" ? Math.max(reach, Math.abs(across.get(entry) ?? 0)) : reach,
    0,
  );

  return plan.map((entry) => {
    const { stemIndex, n, bandIndex, category, angleDeg, level, levels, slot, slotCount } = entry;
    const stem = state.stems[stemIndex];
    const item = getItemOrFallback(stem.itemId);
    const config = CATEGORY_LEVELS[category];

    // Size falls off toward the back, which is what perspective does. The 12%
    // counts rows rather than spiral rings, so a whole row is one size and the
    // courses read as courses.
    const scale = scaleForLevel(level);
    const dx = across.get(entry) ?? 0;

    // How far above the tie point this stem carries its head.
    //
    // Deliberately NOT scaled by the row. In a spiral hand-tie every stem is
    // the same length from the bind, so a back-row flower sits where it does
    // because of the dome, not because it is shorter.
    const risePx = item.stemLengthMm * config.rise * layout.mmToPx * riseFit;

    // The dome, which is two separate things added together.
    //
    // Every row back stands a fixed distance higher than the one in front — a
    // little less so out at the sides, where the rows crowd together the way a
    // dome does seen head-on. That is the whole of the depth read, and it does
    // not care which category the stem belongs to: a fern in the third row
    // stands as far back as a rose in the third row.
    //
    // On top of that the FRONT of the arrangement dips toward the mouth of the
    // wrap, most in the middle and not at all at the sides, so the front row
    // settles into the collar instead of hovering over it or diving behind it.
    const tRow = levels > 1 ? level / (levels - 1) : 0.5;
    const u = domeHalf > 0 ? Math.min(1, Math.abs(dx) / (domeHalf * spreadFit)) : 0;
    //
    // And within its row, a stem sits a little proud or a little back according
    // to where the spiral put it, so the rows are courses rather than shelves
    // and the two sides of the bouquet are not mirror images of each other.
    // Well under half a row step, so it never reads as belonging to another row.
    const dy =
      dropPx * (1 - tRow) * (1 - u * u) * config.floor -
      stepPx * (level - ROW_WOBBLE * entry.depthWithin) * (1 - ROW_STEP_TAPER * u * u);

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
    // row wants it. atan2(x, -y) because 0 degrees points up the screen.
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
      level,
      levels,
      slot,
      slotCount,
      scale,
      angleDeg,
      radiusPx: Math.hypot(offsetX, dy),
      headX,
      headY,
      rotationDeg,
      axisLengthPx,
      risePx,
      widthPx: spriteWidthPx(widthMm, layout.width, scale),
      bloomPx: spriteWidthPx(Math.min(item.bloomWidthMm, widthMm), layout.width, scale),
      // Measured against how far the flowers ACTUALLY reach, not the nominal
      // width of their rows: whether a frond stands outside the flowers is the
      // whole question, and jitter and the brick bond both move the answer.
      layer: layerFor(item, level, focalReach > 0 ? Math.abs(dx) / focalReach : 1),
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
 * Greens are split, but not by a coin toss and no longer by a guess at which
 * side of a dome they landed on. Foliage may come forward when it stands in the
 * FRONT ROW, out toward the edge — which is a frond draping over the rim of the
 * bouquet, and the only foliage in a photograph that is genuinely in front of
 * the flowers. Everything else is background, and background is what the greens
 * layer is for.
 */
function layerFor(item: CatalogItem, level: number, outFromMass: number): LayerName {
  if (item.category === "focal") return "focal";
  if (item.category === "filler") return "filler";
  return level === 0 && outFromMass > FRONT_GREEN_REACH ? "front-greens" : "greens";
}

/**
 * Paint order within a layer: back row first, so the front row lands on top.
 *
 * This used to be a guess from the head's height, which was the best a
 * continuous dome could offer and was wrong often enough to notice. Now the row
 * IS the depth, so the paint order and the geometry come from the same number
 * and cannot disagree: a flower drawn in front is always the one sitting lower
 * and nearer the rim.
 *
 * Height still breaks ties within a row, because two stems at the same depth
 * read better with the lower one in front.
 */
export function sortWithinLayer(stems: PlacedStem[]): PlacedStem[] {
  return [...stems].sort((a, b) => b.level - a.level || a.headY - b.headY || a.n - b.n);
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
