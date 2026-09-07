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
import { composeStems, type ComposeStem, type Frame, type Spot } from "./compose";
import { rand, randSigned } from "./rng";
import type { BouquetState, CatalogItem, Stem, StemCategory, StemLayer } from "./types";

/* -------------------------------------------------------------------------- */
/* Constants                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The canvas is treated as a window onto 400mm of real world across its width.
 * Every millimetre figure in the catalog converts through this one number,
 * which is what makes a 180mm sunflower reliably 2.4x a 75mm rose on screen.
 */
export const CANVAS_WIDTH_MM = 400;

/**
 * ...but a bouquet bigger than that pulls the window back rather than being
 * crushed into it.
 *
 * Eleven sunflowers make a bouquet about 600mm across. Held to a 400mm window
 * it does not become a smaller bouquet — it becomes eleven full-sized
 * sunflowers piled on top of each other, because the positions can be squeezed
 * and the heads cannot. Every millimetre still converts through ONE number, so
 * a 180mm sunflower is still 2.4x a 75mm rose whatever the window is; the
 * window is just far enough back to see the whole thing.
 */
function worldWidthMm(requiredHalfMm: number): number {
  return Math.max(CANVAS_WIDTH_MM, requiredHalfMm * 2);
}

/** Phyllotaxis. The angle sunflower seeds actually use. */
export const GOLDEN_ANGLE_DEG = 137.5;

/** Seeded jitter, per the brief. */
export const ANGLE_JITTER_DEG = 8;
export const RADIUS_JITTER = 0.06;

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
const REACH_SAFETY = 0.97;
/** How far the arrangement may be enlarged to fill the frame. */
const ZOOM_MAX = 1.8;
/** How much of a sprite's reach above its head may run off the top of the frame. */
const TOP_OVERHANG = 0.12;
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
 * How much bigger or smaller a stem is drawn for the row it stands in.
 *
 * Perspective across the depth of a bouquet is a SUBTLE thing — a back-row
 * flower is a hand's breadth further away, not across the room. A steep falloff
 * shrinks the back of the arrangement into a different bouquet behind the front
 * of it, which is the opposite of depth: what you notice is the size, not the
 * distance.
 *
 * So the range is narrow and it straddles 1: the front row is drawn a little
 * over life size and the back a little under, with the anchors — the flowers
 * the bouquet is built around — a touch larger again, because a dominant bloom
 * is dominant partly by being bigger than its neighbours.
 *
 * Multiplied and added rather than raised with `Math.pow`, whose result for
 * non-integer cases is implementation-defined: Node and the browser can
 * disagree in the last bit, which is enough to make the server and client
 * render different numbers and trip a hydration mismatch.
 */
export const DEPTH_SCALE_FRONT = 1.06;
export const DEPTH_SCALE_BACK = 0.92;
/** A row of identical flowers all drawn identically is a row of identical flowers. */
export const DEPTH_SCALE_VARY = 0.035;
/** How much larger the flowers the bouquet is built around are drawn. */
export const ANCHOR_SCALE = 1.05;

export function scaleForLevel(level: number, levels: number): number {
  // A bouquet one row deep sits a little forward of the middle of the range
  // rather than at the very front of it, so it is not drawn oversized.
  const t = levels > 1 ? Math.min(1, Math.max(0, level / (levels - 1))) : 0.35;
  return DEPTH_SCALE_FRONT + (DEPTH_SCALE_BACK - DEPTH_SCALE_FRONT) * t;
}



/**
 * How far each row back stands above the one in front, as a share of how wide
 * the heads in the bouquet actually are.
 *
 * This is the single number that decides whether a bouquet reads as a bouquet,
 * and it has to be measured against the FLOWERS. Measured in ring spacings — an
 * RMS that a few small heads drag down — a bouquet of roses and carnations
 * stepped its rows further apart than a rose is wide, so no row overlapped the
 * one behind it and the middle of every arrangement came out hollow.
 *
 * At 0.55 a little under half of every flower shows above the row in front of
 * it. Too little and the rows collapse into one plane; too much and the bouquet
 * becomes a staircase with daylight through it.
 */
const ROW_STEP_OF_HEAD = 0.6;

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
 * How far the bottom of the bouquet sweeps up toward its sides, as a share of
 * the face's half-width — and so, like the collar it has to clear, growing with
 * the bouquet rather than fixed. Held to a constant instead, a wide bouquet
 * grew a collar whose side points rose faster than its own outline and swallowed
 * the foliage at its edges.
 */
const EDGE_RISE_OF_HALF = 0.28;

/**
 * How filler sits in a gap, in shares of a row step: a touch proud of the seam
 * so its florets carry over the shoulders of the flowers either side, stacked a
 * little higher again when there is more of it than there are gaps, and allowed
 * to wander inside the gap so several stems do not line up.
 */
const FILLER_PEEK = 0.18;
const FILLER_STACK = 0.55;
const FILLER_WANDER = 0.22;

/**
 * A sprig of gypsophila is broken to fit the gap it goes into.
 *
 * A whole cut stem's spray is half again as wide as a rose head, and a florist
 * filling a bouquet does not push the whole thing in — they break off what the
 * space will take. Left whole, and now that filler is drawn at its own depth
 * rather than hidden behind everything, six sprigs of it smother twelve roses.
 *
 * This is a scale, which is the term the sizing rule already leaves free (it is
 * where the 12%-per-row falloff lives too), so the sprig is still sized from its
 * real millimetres — just less of a sprig.
 */
const GAP_FIT = 1.9;
const GAP_FIT_MIN = 0.4;
/** And never wider than this much of the bloom it is tucked beside. */
const GAP_FIT_OF_BLOOM = 0.8;


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
   * How much of the middle of a row this category leaves empty, as a fraction
   * of its half-width. Flowers fill the middle; foliage stays out of it.
   */
  centreClear: number;
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
  // The face of the bouquet: the composition fills its rows from the middle out.
  focal: {
    spread: 1,
    spreadMin: 0.6,
    centreClear: 0,
    rise: 1,
    backBias: 0,
    maxLean: 42,
    floor: 1,
  },
  // In the gaps the flowers leave, not behind the blooms. Carried slightly
  // higher and drawn behind the focals, so what shows of a stem of gypsophila
  // is exactly the part in a gap. Its band here is only the fallback for a
  // bouquet with no flowers to have gaps.
  filler: {
    spread: 1.12,
    spreadMin: 1.1,
    centreClear: 0.18,
    rise: 1.02,
    backBias: 0.45,
    maxLean: 54,
    floor: 0.8,
  },
  // The background. Wider than the flowers, weighted to the back rows and held
  // out of the middle of the FRONT of them, where a frond painted across the
  // face of a bouquet is not foliage behind it — it is a fern lying on top of
  // one. The clearance fades toward the back, where foliage belongs everywhere.
  green: {
    spread: 1.3,
    spreadMin: 1.5,
    centreClear: 0.45,
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
  /** How much real world the canvas is a window onto, across its width. */
  worldWidthMm: number;
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

/** The same rule, through whatever window this layout settled on. */
export function sizePx(realWidthMm: number, layout: Layout, scale: number): number {
  return realWidthMm * layout.mmToPx * scale;
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

/**
 * How many flowers a bouquet is built around.
 *
 * A composition needs something to be about. One dominant bloom for a posy,
 * two or three for a full bouquet — more than that and nothing is dominant,
 * which is the same as having none.
 */
export function anchorCount(focals: number): number {
  if (focals <= 1) return focals;
  if (focals <= 3) return 1;
  if (focals <= 8) return 2;
  return 3;
}

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
  /**
   * For filler: the gap in the flower packing it is tucked into. Absent when
   * there are no flowers to have gaps.
   */
  gap?: GapAnchor;
  /** One of the flowers the whole composition is built around. */
  isAnchor: boolean;
  /** Which small group of the bouquet this stem belongs to. */
  cluster: number;
}

/**
 * A gap in the flower packing, named rather than measured.
 *
 * Gypsophila does not go on a grid of its own. Look at any of the reference
 * bouquets and it is in the spaces BETWEEN the roses — the little triangular
 * void where two flowers in one row meet one in the row behind, the seam
 * between two neighbours, the ring of it around the outside edge. Placed on its
 * own rows, filler could only ever end up behind blooms as often as between
 * them, and what showed was a haze around the outside rather than a sparkle
 * through the middle.
 *
 * So a gap is named by the seats it lies between and resolved to a position
 * only once the flowers themselves have been laid out. That keeps the plan free
 * of the canvas, and means filler follows the flowers exactly however the fit
 * passes move them.
 */
export interface GapAnchor {
  /**
   * `between` — the void between a seat and its nearest neighbour in the row
   * behind, which is the most open space in the packing.
   * `row` — the seam between two neighbours in the same row.
   * `edge` — just outside the end of a row.
   */
  kind: "between" | "row" | "edge";
  /** The row the gap is measured from. */
  level: number;
  /** The seat in that row. For `row`, the gap is between this seat and the next. */
  slot: number;
  /** Which end, for an `edge` gap. Unused otherwise. */
  side: number;
  /** How many stems are already in this gap, when there are more stems than gaps. */
  repeat: number;
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

  // How deep the bouquet is, decided ONCE for the whole arrangement.
  //
  // Each role used to count its own rows, which quietly meant they were not
  // talking about the same thing: with twelve flowers in four rows and four
  // greens in two, a green in "the back row" stood one step up while the
  // flowers stood three, so the foliage that was supposed to be behind the
  // bouquet was in front of half of it. The roles differ in how they are spread
  // ALONG the depth — flowers weighted to the front, foliage to the back,
  // filler wedged between rows — but the depth itself is one ladder, and every
  // stem's height, size and paint order are rungs on it.
  const counts = { focal: 0, filler: 0, green: 0 };
  for (const entry of spiral) counts[entry.slot.category] += 1;
  // Counted off the FLOWERS, so that adding foliage cannot change how deep the
  // bouquet is and move every flower in it. A bouquet with no flowers at all
  // falls back to measuring whatever it has.
  const levels = levelCount(
    counts.focal > 0 ? counts.focal : Math.max(counts.filler, counts.green),
  );

  const plan: StemPlan[] = [];

  for (const category of ["focal", "filler", "green"] as const) {
    const members = spiral.filter((entry) => entry.slot.category === category);
    if (members.length === 0) continue;

    // Filler is not laid out at all — it is tucked into the gaps the flowers
    // have already left, which is the only place gypsophila is ever seen.
    if (category === "filler") {
      const gaps = gapsIn(plan);
      if (gaps.length > 0) {
        members.forEach((entry, i) => {
          const gap = { ...gaps[i % gaps.length], repeat: Math.floor(i / gaps.length) };
          plan.push({
            ...entry.slot,
            isAnchor: false,
            cluster: gap.level,
            angleDeg: entry.angleDeg,
            // Filler takes the row of the flower whose gap it sits in, so it is
            // painted, sized and shaded as something at that depth.
            level: gap.level,
            levels,
            slot: i,
            slotCount: members.length,
            depthWithin: entry.planZ / Math.max(1, ...members.map((m) => m.planRadius)),
            gap,
          });
        });
        continue;
      }
      // No flowers, so no gaps: fall through and give the filler rows of its own.
    }

    const config = CATEGORY_LEVELS[category];
    const capacities = levelCapacities(members.length, levels, config.backBias);
    const maxPlanRadius = Math.max(1, ...members.map((e) => e.planRadius));

    // Biggest first, with the spiral shuffling the ones that are much of a
    // muchness — because the rows are handed out from the middle of the bouquet
    // outward, and the biggest heads take the middle.
    const widths = members.map((entry) => headWidthMm(state.stems[entry.slot.stemIndex]));
    const meanWidth = Math.max(1, widths.reduce((sum, w) => sum + w, 0) / widths.length);
    const ranked = members
      .map((entry, i) => ({
        entry,
        front: sortKey(widths[i] / meanWidth + SPIRAL_DEPTH * (entry.planZ / maxPlanRadius)),
      }))
      .sort((a, b) => b.front - a.front || a.entry.slot.bandIndex - b.entry.slot.bandIndex);

    // The flowers the composition is built around: the biggest blooms, picked
    // here so that everything else can be judged against where they landed.
    const anchors = new Set<number>();
    if (category === "focal") {
      const biggest = members
        .map((entry, i) => ({ stemIndex: entry.slot.stemIndex, width: widths[i], i }))
        .sort((a, b) => b.width - a.width || a.i - b.i);
      for (const pick of biggest.slice(0, anchorCount(members.length))) {
        anchors.add(pick.stemIndex);
      }
    }

    // The groups the bouquet is built in: one per anchor, with every other
    // flower belonging to one of them. Real bouquets go down in small
    // gatherings with room left between them, not one flower at a time at an
    // even pitch — and the gatherings form round the flowers the arrangement
    // is about.
    const groups = Math.max(1, anchors.size);
    const anchorGroup = new Map<number, number>();
    [...anchors].sort((a, b) => a - b).forEach((stemIndex, i) => anchorGroup.set(stemIndex, i));
    const clusterOf = (stemIndex: number) =>
      anchorGroup.get(stemIndex) ??
      Math.min(groups - 1, Math.floor(rand(state.seed, stemIndex, "cluster") * groups));

    // Fill the rows front to back, then let the depth control move a stem
    // between them. Moving a stem forward is a real move, not a repaint: it
    // changes the row it stands in, so it comes down toward the rim and over
    // its neighbours together, the way pulling a stem forward actually looks.
    const rows: Array<Array<{ entry: (typeof members)[number]; level: number }>> = Array.from(
      { length: levels },
      () => [],
    );
    // The rows are filled from the heart of the bouquet outward, and the
    // biggest heads go first — so a sunflower takes a middle row, low and
    // central, and the smaller flowers ring it above and below.
    //
    // Not smallest-to-the-front, which is what this used to do. That kept every
    // head visible by a simple rule — a head only ever stands behind a smaller
    // one, so it always clears it — but it put the biggest bloom in the bouquet
    // at the very back of it, and a photograph of a hand-tie does the opposite:
    // the statement flower sits in the middle of the face and everything else
    // is arranged around it. What keeps the small heads visible now is that the
    // big ones are held to the middle, so a small head in a back row has the
    // whole of the sides to be seen in.
    // One row at a time rather than one row at a stretch. Filling the most
    // central row to capacity before moving on put every big bloom in the
    // bouquet in the same row, where they had nothing to do but pile up on each
    // other; going round the rows hands the biggest heads out across the middle
    // of the arrangement and works outward from there.
    const order = heartOut(levels);
    const room = [...capacities];
    let assigned = 0;
    while (assigned < ranked.length) {
      let placed = false;
      for (const level of order) {
        if (assigned >= ranked.length) break;
        if (room[level] <= 0) continue;
        room[level] -= 1;
        placed = true;
        const { entry } = ranked[assigned];
        assigned += 1;
        const depth = state.stems[entry.slot.stemIndex]?.depth ?? 0;
        const moved = clamp(level - depth, 0, levels - 1);
        rows[moved].push({ entry, level: moved });
      }
      // Every row full and stems still in hand: the capacities are a share of
      // the count, so this cannot happen — but a loop that could spin forever
      // is not worth the argument.
      if (!placed) {
        for (let i = 0; i < room.length; i += 1) room[i] = ranked.length;
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
          isAnchor: anchors.has(member.entry.slot.stemIndex),
          cluster: clusterOf(member.entry.slot.stemIndex),
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
 * Every gap in the flower packing, most open first.
 *
 * The order is what decides where a single stem of gypsophila goes when there
 * is only one of it: into the biggest void in the front of the bouquet. Then
 * the seams between neighbours, then the outside edge, working front to back
 * and out from the middle of each row — which is roughly the order a florist
 * fills them in.
 */
function gapsIn(focals: StemPlan[]): GapAnchor[] {
  // Dense, with the empty rows counted as empty rather than left as holes: a
  // bouquet whose anchor came forward can leave a row of flowers with nothing
  // in it, and a hole in this array is not the same thing as a zero.
  const deepest = focals.reduce(
    (most, entry) => (entry.category === "focal" ? Math.max(most, entry.level) : most),
    -1,
  );
  if (deepest < 0) return [];
  const rows: number[] = Array.from({ length: deepest + 1 }, () => 0);
  for (const entry of focals) {
    if (entry.category !== "focal") continue;
    rows[entry.level] = Math.max(rows[entry.level], entry.slotCount);
  }

  // Each kind of gap, listed per row: middle of the row first, working outward.
  const between = rows.map((_, level) =>
    level + 1 < rows.length
      ? centreOut(rows[level] ?? 0).map(
          (slot): GapAnchor => ({ kind: "between", level, slot, side: 0, repeat: 0 }),
        )
      : [],
  );
  const seams = rows.map((count, level) =>
    centreOut((count ?? 0) - 1).map(
      (slot): GapAnchor => ({ kind: "row", level, slot, side: 0, repeat: 0 }),
    ),
  );
  // Left and right alternate row by row, so a bouquet with only a couple of
  // stems of filler and no room between its flowers does not put all of it
  // down one side.
  const edges = rows.map((count, level) => {
    if ((count ?? 0) === 0) return [];
    const first = level % 2 === 0 ? -1 : 1;
    return [
      { kind: "edge" as const, level, slot: first < 0 ? 0 : count - 1, side: first, repeat: 0 },
      { kind: "edge" as const, level, slot: first < 0 ? count - 1 : 0, side: -first, repeat: 0 },
    ];
  });

  // Taken a row at a time rather than a row at a stretch, so three stems of
  // gypsophila land at three different depths instead of filling the front row
  // and leaving the rest of the bouquet bare.
  return [...roundRobin(between), ...roundRobin(seams), ...roundRobin(edges)];
}

/** Flattens per-row lists by taking one from each row in turn, front row first. */
function roundRobin<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const longest = lists.reduce((most, list) => Math.max(most, list.length), 0);
  for (let i = 0; i < longest; i += 1) {
    for (const list of lists) if (i < list.length) out.push(list[i]);
  }
  return out;
}

/**
 * The rows, from the heart of the bouquet outward.
 *
 * The heart is not the middle row but a little forward of it: in every
 * reference photograph the statement flowers sit low and central, with the rest
 * of the bouquet rising behind and around them, so the row that reads as the
 * heart of the face is the second one back at most.
 */
function heartOut(levels: number): number[] {
  const heart = (levels - 1) * HEART_ROW;
  return Array.from({ length: levels }, (_, level) => level).sort(
    (a, b) => sortKey(Math.abs(a - heart)) - sortKey(Math.abs(b - heart)) || a - b,
  );
}
const HEART_ROW = 0.38;

/** 0..count-1, middle first and working outward, so a few stems spread instead of clumping left. */
function centreOut(count: number): number[] {
  if (count <= 0) return [];
  const middle = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => sortKey(Math.abs(a - middle)) - sortKey(Math.abs(b - middle)) || a - b,
  );
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
  const world = worldWidthMm(requiredHalfMm(state));
  const mmToPx = width / world;
  return {
    width,
    height,
    tieX: state.tiePoint[0] * width,
    tieY: state.tiePoint[1] * height,
    worldWidthMm: world,
    mmToPx,
    ringSpacingPx: ringSpacingMm(state.stems) * mmToPx,
  };
}

/**
 * How much real world the bouquet needs across half its width, in millimetres.
 *
 * Worked out in millimetres precisely so it does not depend on the window it is
 * about to set. The face is sized from the area of the heads that go on it; each
 * role reaches its own multiple of that; and each is allowed to hang part of its
 * widest head over the edge, because a sprig of eucalyptus running out of frame
 * is what these photographs look like and a focal flower cut in half is not.
 */
function requiredHalfMm(state: Pick<BouquetState, "seed" | "stems">): number {
  const plan = planStems(state);
  if (plan.length === 0) return 0;

  const headMm = (entry: StemPlan) =>
    headWidthMm(state.stems[entry.stemIndex]) *
    scaleForLevel(entry.level, entry.levels) *
    (entry.isAnchor ? ANCHOR_SCALE : 1);

  // Measured over the FLOWERS alone, and the greenery is left to overhang.
  //
  // The window sets the scale of everything, so anything that changes it moves
  // every stem in the bouquet — and a stem of eucalyptus must not move the
  // flowers. Foliage running off the edge of the frame is what these
  // photographs look like anyway; a flower cut in half by it is not.
  const focals = plan.filter((entry) => entry.category === "focal");
  const measured = focals.length > 0 ? focals : plan;
  const faceHalf = faceHalfPx(measured.map((entry) => ({ radius: headMm(entry) / 2 })));
  const widest = measured.reduce((most, entry) => Math.max(most, headMm(entry)), 0);
  return faceHalf + widest * FIT_SPRITE_MARGIN[measured[0].category];
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
  /** One of the flowers the whole composition is built around. */
  isAnchor: boolean;
  /** Which small group of the bouquet this stem belongs to. */
  cluster: number;
  /**
   * What the composition thought of where this stem ended up, and of every
   * other position it considered. Carried for the debug overlay, which is the
   * only way to tune a scoring function honestly.
   */
  composition?: Spot;
  layer: StemLayer;
  /**
   * Where this stem sits in the stack, back to front — the ONE number paint
   * order comes from. Whole numbers are the rows; the fraction is where the
   * stem sits within its row's depth, so a stem of gypsophila tucked between
   * two rows really is drawn in front of the row behind it and behind the row
   * it is tucked into.
   */
  paintDepth: number;
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
export interface Composition {
  frame: Frame;
  spots: Map<number, Spot>;
  scaleOf: Map<StemPlan, number>;
}

/**
 * What the composition was working within — the frame it judged every position
 * against. Only the debug overlay wants this; it is recomputed rather than
 * carried, because it is cheap and nothing else should be reading it.
 */
export function describeComposition(state: BouquetState, layout: Layout): Frame {
  return buildFrame(state, layout, planStems(state)).frame;
}

/** Compose the bouquet: every stem judged into place, before the frame is considered. */
export function composeBouquet(state: BouquetState, layout: Layout, plan: StemPlan[]): Composition {
  const { frame, stems, scaleOf } = buildFrame(state, layout, plan);
  return { frame, spots: composeStems(state.seed, stems, frame), scaleOf };
}

export function placeStems(state: BouquetState, layout: Layout): PlacedStem[] {
  const plan = planStems(state);
  // Composed once, in its own space, and only then reined in. The composition
  // decides the picture; the fits breathe the finished picture in until it fits
  // the frame, which is a different job and must not be allowed to change which
  // flower went where.
  const composed = composeBouquet(state, layout, plan);

  const natural = layoutPass(state, layout, plan, composed, 1, 1, 1);
  const spreadFit = Math.min(
    solveHorizontalFit(natural, layout),
    solveLeanFit(natural, layout),
  );
  const widened =
    spreadFit === 1 ? natural : layoutPass(state, layout, plan, composed, spreadFit, 1, 1);
  const riseFit = solveVerticalFit(widened, layout);
  const fitted =
    riseFit === 1 ? widened : layoutPass(state, layout, plan, composed, spreadFit, riseFit, 1);

  // And then out again to fill the frame.
  //
  // The window is pulled back far enough for the biggest head the bouquet could
  // possibly have at its widest point — which is a worst case, and one the
  // composition rarely reaches, so a bouquet ends up sitting in the middle of
  // the canvas with a quarter of the frame empty around it and a wrap drawn to
  // match. This is a UNIFORM zoom of positions and head sizes together, which
  // is the one operation that leaves every overlap the composition chose
  // exactly as it chose it: it is the camera moving, not the bouquet.
  const zoom = solveFillZoom(fitted, layout);
  if (zoom === 1) return fitted;
  return layoutPass(state, layout, plan, composed, spreadFit, riseFit, zoom);
}

/**
 * How far the sprite reaches ABOVE the head it carries, in pixels.
 *
 * Not half its width. The artwork is framed per flower, so where a bloom sits
 * in its own picture varies enormously — a sunflower seen head-on has its head a
 * third of the way down the sprite, and the same sunflower seen at three
 * quarters has it nearly half way, which is two thirds of the sprite's width
 * standing above the head instead of a third. Sized on width, a bouquet
 * enlarged to fill the frame cut the tops off exactly those flowers.
 */
function spriteTopPx(stem: PlacedStem): number {
  const [imageWidth] = stem.variant.size;
  if (imageWidth <= 0) return stem.widthPx / 2;
  return (stem.widthPx * stem.variant.headY) / imageWidth;
}

/**
 * How much the whole arrangement can be enlarged before something leaves the
 * frame.
 *
 * Every constraint the fit passes enforce is linear in the zoom, because the
 * zoom moves heads and grows them by the same factor — so the largest one that
 * still satisfies all of them solves directly. Lean does not appear: a stem's
 * angle from the bind is unchanged by moving the camera.
 */
function solveFillZoom(placed: PlacedStem[], layout: Layout): number {
  let fill = ZOOM_MAX;
  for (const stem of placed) {
    // Measured over the FLOWERS. The zoom sets the scale of the whole bouquet,
    // so anything that decides it moves every flower in it — and neither a stem
    // of eucalyptus nor a sprig of gypsophila may do that. Both are allowed to
    // run past the edge of the frame, which is what these photographs look like
    // anyway, and both have their reach tied to the flowers' already, so they
    // grow and shrink with them.
    if (stem.item.category !== "focal") continue;
    const margin = FIT_SPRITE_MARGIN[stem.item.category];
    const dx = Math.abs(stem.headX - layout.tieX);
    const wide = dx + stem.widthPx * margin;
    if (wide > 1e-6) fill = Math.min(fill, (layout.width * FIT_HALF_WIDTH) / wide);

    const above = layout.tieY - stem.headY;
    const tall = above + spriteTopPx(stem) * (1 - TOP_OVERHANG);
    if (tall > 1e-6) {
      fill = Math.min(fill, (layout.tieY - layout.height * FIT_TOP_MARGIN) / tall);
    }
  }
  return Math.max(1, Math.min(ZOOM_MAX, fill));
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
    // Foliage is held to the frame on its own, below — it must not be allowed
    // to rein in the flowers, or a stem of eucalyptus moves every one of them.
    if (stem.item.category === "green") continue;
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
    // Foliage is held to the frame on its own, below — it must not be allowed
    // to rein in the flowers, or a stem of eucalyptus moves every one of them.
    if (stem.item.category === "green") continue;
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
    // Foliage is held to the frame on its own, below — it must not be allowed
    // to rein in the flowers, or a stem of eucalyptus moves every one of them.
    if (stem.item.category === "green") continue;
    const above = layout.tieY - stem.headY;
    if (above < 1e-6) continue;
    const allowed = layout.tieY - limit - spriteTopPx(stem) * (1 - TOP_OVERHANG);
    fit = Math.min(fit, Math.max(0, allowed) / above);
  }
  // Never squash the bouquet to nothing. If it is still too tall at this point
  // it is the ROWS that are too tall, and the row step is capped for exactly
  // that; squashing further past here just buries the heads in the wrap.
  return Math.min(1, Math.max(MIN_RISE_FIT, fit));
}

/** How far a role may reach across the canvas, as a multiple of the face's half-width. */
function reachOf(
  state: BouquetState,
  category: StemCategory,
  massHalf: number,
  plan: StemPlan[],
  radiusOf: Map<StemPlan, number>,
  layout: Layout,
): number {
  const wanted = CATEGORY_LEVELS[category].spread;
  // The widest POSE, not the stored one: which way a frond arches is not
  // settled until it knows which side of the bouquet it landed on, and an
  // arching stem spans nearly twice an upright. Capped on the stored width, one
  // mirrored eucalyptus was enough to trip the fit pass and shift the flowers.
  const widest = plan.reduce((most, entry) => {
    if (entry.category !== category) return most;
    const item = getItemOrFallback(state.stems[entry.stemIndex].itemId);
    const pose = item.variants.reduce(
      (w, variant) => Math.max(w, variant.widthMm ?? item.realWidthMm),
      item.realWidthMm,
    );
    const stored = headWidthMm(state.stems[entry.stemIndex]);
    const grown = stored > 0 ? pose / stored : 1;
    return Math.max(most, (radiusOf.get(entry) ?? 0) * grown);
  }, 0);
  if (widest === 0 || massHalf <= 0) return wanted;
  // A shade under what the frame will take, so the reach never lands exactly on
  // the fit pass's limit and leave a rounding error to decide whether the whole
  // bouquet gets narrowed.
  const room =
    (layout.width * FIT_HALF_WIDTH - widest * 2 * FIT_SPRITE_MARGIN[category]) * REACH_SAFETY;
  return Math.min(wanted, Math.max(0.2, room / massHalf));
}

/**
 * How wide the face of the bouquet should be.
 *
 * From the area of the heads that have to fit on it, not from a pitch. A face
 * is roughly an ellipse, and the heads laid on it overlap — so their summed
 * area exceeds the area of the face by a known amount, and inverting that gives
 * the half-width directly. Sizing from a pitch instead is what made the rows
 * even: a pitch IS an even spacing, and every arrangement built on one is a
 * grid however much jitter is sprinkled over it.
 */
function faceHalfPx(heads: Array<{ radius: number }>): number {
  if (heads.length === 0) return 0;
  const area = heads.reduce((sum, head) => sum + Math.PI * head.radius * head.radius, 0);
  const widest = heads.reduce((most, head) => Math.max(most, head.radius), 0);
  return Math.max(widest, Math.sqrt(area / (FACE_FILL * Math.PI * FACE_ASPECT)));
}

/**
 * How much more head area a bouquet carries than the face it is laid on, and
 * how tall that face is against its width.
 *
 * The first is the overlap, stated as a number: at 1.45 the heads cover the
 * face half again over, which is a bouquet you cannot see through. The second
 * is the shape every hand-tie has from the front — wider than it is tall.
 */
const FACE_FILL = 1.2;
const FACE_ASPECT = 0.72;

/**
 * Everything the composition needs to know about the bouquet it is composing.
 *
 * Worked out once, before a single position is chosen, and free of the fit
 * scalars — the composition decides the picture, and the fits only breathe the
 * finished picture in to fit the frame.
 */
function buildFrame(
  state: BouquetState,
  layout: Layout,
  plan: StemPlan[],
): { frame: Frame; stems: ComposeStem[]; scaleOf: Map<StemPlan, number> } {
  const scaleOf = new Map<StemPlan, number>();
  const radiusOf = new Map<StemPlan, number>();
  const riseOf = new Map<StemPlan, number>();

  for (const entry of plan) {
    const stem = state.stems[entry.stemIndex];
    const item = getItemOrFallback(stem.itemId);
    const scale =
      scaleForLevel(entry.level, entry.levels) *
      (entry.isAnchor ? ANCHOR_SCALE : 1) *
      (1 + randSigned(state.seed, entry.n, "scale") * DEPTH_SCALE_VARY);
    scaleOf.set(entry, scale);
    radiusOf.set(entry, sizePx(headWidthMm(stem), layout, scale) / 2);
    riseOf.set(
      entry,
      item.stemLengthMm * CATEGORY_LEVELS[entry.category].rise * layout.mmToPx,
    );
  }

  const focals = plan.filter((entry) => entry.category === "focal");

  // How wide the face is, from the area of the heads that go on it. No cap
  // needed: the window was pulled back far enough for this in `computeLayout`,
  // which is the whole reason it is worked out in millimetres there. Composing
  // wider than the frame and letting a fit pass squeeze the result is not the
  // same thing at all — the fit scales positions and NOT head sizes, so a
  // bouquet composed 30% too wide comes back with every overlap 30% deeper than
  // the composition chose.
  const massHalf = Math.max(
    layout.ringSpacingPx,
    faceHalfPx(focals.map((entry) => ({ radius: radiusOf.get(entry) ?? 0 }))),
  );

  const levels = plan.reduce((most, entry) => Math.max(most, entry.levels), 1);
  const backRow = plan.reduce((deepest, entry) => Math.max(deepest, entry.level), 0);
  const rimDrop = DOME_DROP_RINGS * layout.ringSpacingPx;
  const edgeRise = EDGE_RISE_OF_HALF * massHalf;

  // How far apart the rows stand — and then how far apart the frame will let
  // them, which is the smaller of the two.
  //
  // Stated here rather than left to the vertical fit for the same reason the
  // width is: the fit scales POSITIONS, so a bouquet composed too tall comes
  // back with every carefully chosen overlap closed up. Working out the room
  // there is means the tallest head in the bouquet, plus however much of itself
  // it must keep in frame, plus the sweep at the sides, all inside what is above
  // the tie point.
  let headroom = Infinity;
  for (const entry of plan) {
    // Foliage is allowed to run off the top, and must not be allowed to set the
    // depth of the bouquet: anything that does moves every flower in it.
    if (entry.category === "green") continue;
    const stem = state.stems[entry.stemIndex];
    const item = getItemOrFallback(stem.itemId);
    const rise = riseOf.get(entry) ?? 0;
    const keep =
      sizePx(headWidthMm(stem), layout, scaleOf.get(entry) ?? 1) *
      FIT_SPRITE_MARGIN[entry.category];
    headroom = Math.min(
      headroom,
      layout.tieY - layout.height * FIT_TOP_MARGIN - keep - rise - edgeRise,
    );
    void item;
  }
  // How wide the heads in the bouquet actually are, which is what a row step
  // has to be measured against.
  const heads = focals.length > 0 ? focals : plan;
  const meanHead =
    heads.reduce((sum, entry) => sum + 2 * (radiusOf.get(entry) ?? 0), 0) / Math.max(1, heads.length);
  const wantedStep = ROW_STEP_OF_HEAD * meanHead;
  const rowStep =
    backRow > 0
      ? Math.max(meanHead * 0.25, Math.min(wantedStep, Math.max(0, headroom) / backRow))
      : wantedStep;

  const frame: Frame = {
    massHalf,
    // How tall the face is, measured off the rows that actually make it, so the
    // silhouette the composition is judged against is the one it can produce.
    massTop: rowStep * Math.max(1, levels - 1) + rimDrop + edgeRise,
    rowStep,
    rimDrop,
    edgeRise,
    stepTaper: ROW_STEP_TAPER,
    meanHead: meanHead / 2,
    maxLean: {
      focal: CATEGORY_LEVELS.focal.maxLean,
      filler: CATEGORY_LEVELS.filler.maxLean,
      green: CATEGORY_LEVELS.green.maxLean,
    },
    floor: {
      focal: CATEGORY_LEVELS.focal.floor,
      filler: CATEGORY_LEVELS.filler.floor,
      green: CATEGORY_LEVELS.green.floor,
    },
    // How far each role may reach — its own figure, or as far as the frame will
    // take it, whichever is less. Stated here rather than left to the fit pass
    // because the fit shrinks the WHOLE arrangement: one frond reaching past the
    // edge would otherwise pull every flower in the bouquet in with it.
    spread: {
      focal: reachOf(state, "focal", massHalf, plan, radiusOf, layout),
      filler: reachOf(state, "filler", massHalf, plan, radiusOf, layout),
      green: reachOf(state, "green", massHalf, plan, radiusOf, layout),
    },
    clear: {
      focal: CATEGORY_LEVELS.focal.centreClear,
      filler: CATEGORY_LEVELS.filler.centreClear,
      green: CATEGORY_LEVELS.green.centreClear,
    },
  };

  const stems: ComposeStem[] = plan
    // Filler is not composed — it goes into the gaps the flowers leave, which is
    // settled once they are down.
    .filter((entry) => !entry.gap)
    .map((entry) => ({
      id: entry.n,
      category: entry.category,
      level: entry.level,
      levels: entry.levels,
      radius: radiusOf.get(entry) ?? 0,
      rise: riseOf.get(entry) ?? 0,
      isAnchor: entry.isAnchor,
      cluster: entry.cluster,
    }));

  return { frame, stems, scaleOf };
}

function layoutPass(
  state: BouquetState,
  layout: Layout,
  plan: StemPlan[],
  composed: Composition,
  spreadFit: number,
  riseFit: number,
  zoom: number,
): PlacedStem[] {
  const { frame, spots, scaleOf } = composed;

  const offset = new Map<StemPlan, { x: number; y: number }>();
  for (const entry of plan) {
    const spot = spots.get(entry.n);
    if (!spot) continue;
    // The rise fit shrinks the bouquet toward the tie point — but only the part
    // of it that is above the front row's line. Scaled whole, a bouquet reined
    // in for height pushes its own front row down into the mouth of the wrap,
    // which is the one thing the dome's shape exists to prevent.
    offset.set(entry, {
      x: spot.x * spreadFit * zoom,
      y: Math.min(spot.floor, spot.floor + (spot.y - spot.floor) * riseFit) * zoom,
    });
  }

  // Foliage is kept on the canvas here rather than by the fits, so that adding
  // a stem of it cannot rein the flowers in. It is allowed to run past the edge
  // — that is what these photographs look like — but not to leave altogether.
  for (const entry of plan) {
    if (entry.category !== "green") continue;
    const at = offset.get(entry);
    if (!at) continue;
    const stem = state.stems[entry.stemIndex];
    const item = getItemOrFallback(stem.itemId);
    const pose = poseFor(item, stem.variant, at.x);
    const half = sizePx(pose.widthMm ?? item.realWidthMm, layout, (scaleOf.get(entry) ?? 1) * zoom);
    const room = Math.max(
      layout.ringSpacingPx,
      layout.width * FIT_HALF_WIDTH - half * FIT_SPRITE_MARGIN.green,
    );
    if (Math.abs(at.x) > room) offset.set(entry, { x: Math.sign(at.x) * room, y: at.y });
  }

  // Now the filler, into the gaps the flowers left.
  const gapFit = new Map<StemPlan, number>();
  const naturalWidth = (entry: StemPlan) =>
    sizePx(headWidthMm(state.stems[entry.stemIndex]), layout, (scaleOf.get(entry) ?? 1) * zoom);
  placeInGaps(
    state,
    plan,
    offset,
    gapFit,
    frame.rowStep * riseFit * zoom,
    naturalWidth,
    naturalWidth,
  );

  // How far the flowers actually reach, which is what "outside the flowers"
  // means. Floored by the widest bloom's own half-width: a bouquet with one
  // flower in the middle of it has every head at x = 0, and measured on centres
  // alone that makes every stem of foliage in the bouquet "outside the
  // flowers" — which is how a eucalyptus sprig ended up painted across the face
  // of a sunflower.
  const focalReach = plan.reduce((reach, entry) => {
    if (entry.category !== "focal") return reach;
    const stem = state.stems[entry.stemIndex];
    const half = sizePx(headWidthMm(stem), layout, (scaleOf.get(entry) ?? 1) * zoom) / 2;
    return Math.max(reach, Math.abs(offset.get(entry)?.x ?? 0), half);
  }, 0);

  return plan.map((entry) => {
    const { stemIndex, n, bandIndex, level, levels, slot, slotCount } = entry;
    const stem = state.stems[stemIndex];
    const item = getItemOrFallback(stem.itemId);

    const scale = (scaleOf.get(entry) ?? 1) * (gapFit.get(entry) ?? 1) * zoom;
    const risePx =
      item.stemLengthMm * CATEGORY_LEVELS[entry.category].rise * layout.mmToPx * riseFit * zoom;
    const { x: offsetX, y: offsetY } = offset.get(entry) ?? { x: 0, y: -risePx };
    const layer = layerFor(item, level, focalReach > 0 ? Math.abs(offsetX) / focalReach : 1);

    // The variant is settled only once the stem's side is known, because an
    // arching frond has to arc away from the bouquet rather than back into it.
    const variant = poseFor(item, stem.variant, offsetX);
    // A pose may be a different real size from the item — a bud is not as wide
    // as the flower it becomes, and an arching stem spans more than an upright.
    const widthMm = variant.widthMm ?? item.realWidthMm;

    const headX = layout.tieX + offsetX;
    const headY = layout.tieY + offsetY;

    // Solve the rotation that carries the head from straight-up to where the
    // composition wants it. atan2(x, -y) because 0 degrees points up the screen.
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
      isAnchor: entry.isAnchor,
      cluster: entry.cluster,
      scale,
      angleDeg: entry.angleDeg,
      radiusPx: Math.hypot(offsetX, offsetY + risePx),
      headX,
      headY,
      rotationDeg,
      axisLengthPx,
      risePx: entry.gap ? -offsetY : risePx,
      widthPx: sizePx(widthMm, layout, scale),
      bloomPx: sizePx(Math.min(item.bloomWidthMm, widthMm), layout, scale),
      layer,
      paintDepth:
        level +
        (layer === "filler" && entry.gap?.kind === "between"
          ? PAINT_BETWEEN_ROWS
          : PAINT_WITHIN_ROW[layer]),
      composition: spots.get(n),
    };
  });
}

/**
 * Tuck each stem of filler into the gap the plan named for it.
 *
 * A gap is only a pair of seats until the flowers have been laid out, so this
 * runs after them and reads their finished positions. Everything follows from
 * that: if a fit pass narrowed the bouquet, the gaps narrowed with it and the
 * gypsophila is still in them.
 */
function placeInGaps(
  state: BouquetState,
  plan: StemPlan[],
  offset: Map<StemPlan, { x: number; y: number }>,
  fit: Map<StemPlan, number>,
  stepPx: number,
  naturalWidthPx: (entry: StemPlan) => number,
  seatWidthPx: (entry: StemPlan) => number,
) {
  const seatsByLevel = new Map<number, Array<{ entry: StemPlan; x: number; y: number }>>();
  for (const entry of plan) {
    if (entry.category !== "focal") continue;
    const at = offset.get(entry);
    if (!at) continue;
    const bucket = seatsByLevel.get(entry.level);
    if (bucket) bucket.push({ entry, ...at });
    else seatsByLevel.set(entry.level, [{ entry, ...at }]);
  }
  for (const [, seats] of seatsByLevel) seats.sort((a, b) => a.x - b.x);

  for (const entry of plan) {
    const gap = entry.gap;
    if (!gap) continue;
    const seats = seatsByLevel.get(gap.level);
    if (!seats || seats.length === 0) continue;

    const seat = seats[Math.min(gap.slot, seats.length - 1)];
    // How wide the local space is: how far it is to the nearest flower beside
    // this one. That sets how far outside a row an edge gap sits and how far a
    // stem may wander inside any gap, both measured against the actual packing
    // rather than a constant.
    const room =
      seats.length > 1
        ? Math.min(
            ...seats.filter((other) => other !== seat).map((other) => Math.abs(other.x - seat.x)),
          ) / 2
        : stepPx * 0.6;
    let x = seat.x;
    let y = seat.y;

    if (gap.kind === "row") {
      const next = seats[Math.min(gap.slot + 1, seats.length - 1)];
      x = (seat.x + next.x) / 2;
      y = (seat.y + next.y) / 2;
    } else if (gap.kind === "between") {
      const behind = seatsByLevel.get(gap.level + 1);
      if (behind && behind.length > 0) {
        // Its nearest neighbour in the row behind, which with the brick bond is
        // the flower sitting up between this one and the next: the third corner
        // of the little triangle the filler goes into.
        const near = behind.reduce((best, candidate) =>
          Math.abs(candidate.x - seat.x) < Math.abs(best.x - seat.x) ? candidate : best,
        );
        x = (seat.x + near.x) / 2;
        y = (seat.y + near.y) / 2;
      } else {
        y -= stepPx * 0.5;
      }
    } else {
      x = seat.x + gap.side * room;
    }

    // Sit a touch proud of the gap, so the sprig's florets carry over the
    // shoulders of the flowers either side rather than only through the seam.
    // Not at an edge, though: there is nothing either side to carry over, and
    // lifting it there just floats a puff of gypsophila off the bouquet.
    // Both the lift and the wander are scaled by how much of a gap there
    // actually is. A seam between two flowers all but touching has no room in
    // it, and a stem nudged the usual amount ends up on one of them rather than
    // between the two.
    const slack = Math.min(1, (2 * room) / Math.max(1, stepPx));
    const peek = gap.kind === "edge" ? 0 : FILLER_PEEK;
    y -= stepPx * slack * (peek + gap.repeat * FILLER_STACK);
    // And wander a little within the gap, so several stems of it do not line up.
    x += randSigned(state.seed, entry.n, "gap-x") * room * FILLER_WANDER;
    y += randSigned(state.seed, entry.n, "gap-y") * stepPx * slack * FILLER_WANDER;

    offset.set(entry, { x, y });
    // Broken to fit: the sprig is cut back to roughly what the gap will take,
    // and never left wider than the bloom it is tucked beside. Room alone is
    // not enough — a back row of two flowers has an enormous gap between them,
    // and a sprig sized to fill it covers a whole rose.
    const natural = naturalWidthPx(entry);
    const beside = seat.entry ? seatWidthPx(seat.entry) * GAP_FIT_OF_BLOOM : natural;
    fit.set(
      entry,
      natural > 0
        ? Math.min(1, Math.max(GAP_FIT_MIN, Math.min(room * GAP_FIT, beside) / natural))
        : 1,
    );
  }
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
function layerFor(item: CatalogItem, level: number, outFromMass: number): StemLayer {
  if (item.category === "focal") return "focal";
  if (item.category === "filler") return "filler";
  return level === 0 && outFromMass > FRONT_GREEN_REACH ? "front-greens" : "greens";
}

/**
 * Where each kind of stem sits within its own row's depth.
 *
 * Strictly between -0.5 and 0.5, which is what guarantees the thing that
 * matters: a stem from a further row is NEVER painted over one from a nearer
 * row, whatever the two of them are.
 *
 * Within a row it is the old layer order, and for the same reasons: foliage
 * behind the blooms, filler behind them but nearer, and a frond that drapes
 * over the rim of the bouquet in front of the row it stands in. Filler tucked
 * into the triangle between two rows is the interesting one — it belongs half a
 * row forward, in front of the row behind it and behind the row it is wedged
 * into, which is exactly where a stem of gypsophila is.
 */
const PAINT_WITHIN_ROW: Record<StemLayer, number> = {
  greens: 0.35,
  filler: 0.25,
  focal: 0,
  "front-greens": -0.45,
};
const PAINT_BETWEEN_ROWS = 0.45;

/**
 * Paint order for the whole arrangement, back to front.
 *
 * The row IS the depth, so one sort over every stem does it — there is nothing
 * left for a layer to decide. This used to be four separate layers each sorted
 * on its own, which meant a green in the front row was still painted behind a
 * flower in the back row, and the foliage read as a backdrop hung behind the
 * bouquet rather than as part of it.
 *
 * Height breaks ties at equal depth, because two stems at the same depth read
 * better with the lower one in front.
 */
export function paintOrder(stems: PlacedStem[]): PlacedStem[] {
  return [...stems].sort(
    (a, b) => b.paintDepth - a.paintDepth || a.headY - b.headY || a.n - b.n,
  );
}

/**
 * The stems grouped into the runs that share a depth treatment, back to front.
 *
 * Rounding a depth is monotone, so sorting by depth already puts every stem
 * that shares a band next to its neighbours — the runs fall out of the paint
 * order rather than being imposed on it, and each one can be drawn as a single
 * group with a single filter.
 */
export function depthRuns(stems: PlacedStem[]): Array<{ band: number; stems: PlacedStem[] }> {
  const runs: Array<{ band: number; stems: PlacedStem[] }> = [];
  for (const stem of paintOrder(stems)) {
    const band = Math.max(0, Math.round(stem.paintDepth));
    const last = runs[runs.length - 1];
    if (last && last.band === band) last.stems.push(stem);
    else runs.push({ band, stems: [stem] });
  }
  return runs;
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
