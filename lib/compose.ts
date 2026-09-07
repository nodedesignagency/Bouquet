/**
 * Composition — where every stem actually goes.
 *
 * The arrangement engine settles the STRUCTURE of a bouquet: which row each
 * stem stands in, how deep the bouquet is, how big each head is drawn. This
 * module settles the picture. They are different problems, and running them
 * together is what made the old arrangement read as an arrangement rather than
 * as a bouquet: every stem went to the one position its row had left for it, on
 * an even pitch, and no position was ever compared against another.
 *
 * A florist does not do that. They put the biggest bloom down slightly off
 * centre, gather the next few around it, leave a space, fill the space with
 * something small, and stand back — repeatedly. What they are doing is
 * generating a position and JUDGING it, against everything already in their
 * hand. That is what this does: for each stem in turn, sample a spread of
 * candidate positions and score every one of them against the arrangement so
 * far, then take the best.
 *
 * The scoring is the whole design, and every term in it is a thing a bouquet
 * either has or lacks — a useful gap filled, a cluster supported, a believable
 * overlap, a silhouette held, an accidental mirror avoided. The weights are
 * named constants at the top so they can be tuned against a render rather than
 * argued about.
 *
 * Pure and seeded, like everything else here: candidates come from
 * `rand(seed, ...)` and scores are quantised before they are compared, so the
 * same bouquet composes to the same picture on the server and in the browser.
 */

import { rand, randSigned } from "./rng";
import type { StemCategory } from "./types";

const DEG = Math.PI / 180;

/* -------------------------------------------------------------------------- */
/* Weights                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * How much each judgement counts. Every term is written to land in about
 * -1..1 before it is weighted, so these read as relative importance.
 */
export const WEIGHTS = {
  /** Heads should touch and overlap a little. Both halves of that matter. */
  overlap: 2.2,
  crowding: 6,
  /** Two or three near neighbours reads as a bunch; none reads as a stray. */
  cluster: 1.5,
  isolation: 2.6,
  /** Fill the holes, and keep the outline. */
  gap: 1.1,
  silhouette: 2.8,
  /** Full in the middle and up, thinning outward. */
  density: 2.6,
  /** Balanced but never mirrored, and never evenly spaced. */
  balance: 2.4,
  symmetry: 1.1,
  uniformity: 2.0,
  /** A flat top edge is the giveaway of a machine-made bouquet. */
  flatTop: 1.0,
  /** Big blooms belong in the body of the bouquet, not out at the rim. */
  edgeSize: 2.6,
  /** Gather round the flower the bouquet is built around, and never bury it. */
  gathers: 2.0,
  blocksAnchor: 3.0,
  /** Nothing sinks into the wrap, and nothing lies on its side. */
  floor: 6,
  lean: 6,
} as const;

export type ScoreTerms = Partial<Record<keyof typeof WEIGHTS, number>>;

/** How many positions are tried for each stem. */
const CANDIDATES = 64;

/**
 * How much of its own width a head should overlap its nearest neighbour.
 *
 * The point of the band is that BOTH ends are wrong. Below it the bouquet is a
 * handful of separate flowers with daylight between them; above it one flower
 * is eating another. The middle is what a photograph of a hand-tie looks like.
 */
const OVERLAP_MIN = 0.06;
const OVERLAP_BEST = 0.2;
/** How far a candidate may stray from the stem's own preference. */
const OVERLAP_SLACK = 0.09;
const OVERLAP_MAX = 0.32;
/** Past this, a head is being swallowed rather than overlapped. */
const OVERLAP_RUIN = 0.34;

/** How many near neighbours read as a cluster rather than a stray or a crowd. */
const CLUSTER_NEAR = 2.3;
const CLUSTER_WANT = 3;

/** A neighbour further than this, in head widths, leaves a hole. */
const ISOLATED_AT = 1.7;

/** How far off centre the bouquet is allowed to sit, as a share of its width. */
const OFF_CENTRE = 0.1;

/** Two heads closer than this to being mirror images of each other, in head widths. */
const MIRROR_NEAR = 0.55;

/** How flat two tops have to be before they read as a cut edge, in head widths. */
const FLAT_WITHIN = 0.12;

/**
 * How crowded the heart of the bouquet should be against its edge, counted in
 * overlapping neighbours. Full and up in the middle, thinning outward.
 */
const DENSITY_HEART = 2.4;
const DENSITY_FALLOFF = 0.92;

/** How far a stem may stand off its row's line, as a share of the row step. */
const ROW_DRIFT = 0.28;

/**
 * How closely each stem wants to sit to its neighbour — drawn per STEM, not per
 * candidate.
 *
 * Sampling the band per candidate and then scoring every one of them against
 * the same ideal collapses the variation right back out again: five identical
 * roses all want exactly the same gap, all get it, and the row is a picket
 * fence. Giving each stem its own preference inside the band is what makes the
 * gaps actually differ — which is the difference between a bunch of flowers and
 * a diagram of one.
 */
function wants(seed: number, id: number): number {
  return OVERLAP_MIN + rand(seed, id, "want") * (OVERLAP_MAX - OVERLAP_MIN);
}

/** How much closer a stem sits to its own group than to the rest of the bouquet. */
const CLUSTER_TIGHTEN = 1.45;

/** How many candidates are generated beside something already in the bouquet. */
const BESIDE_SHARE = 0.6;

/** How far an anchor's pull reaches, in the two heads' own widths. */
const GATHER_SPAN = 1.3;

/** How many times a candidate may be nudged clear of what it landed on. */
const RELAX_STEPS = 4;

/** How finely the band is walked when every candidate has been struck out. */
const SWEEP_ACROSS = 96;
const SWEEP_HEIGHTS = 5;

/* -------------------------------------------------------------------------- */
/* Types                                                                        */
/* -------------------------------------------------------------------------- */

export interface ComposeStem {
  /** The stem's ordinal across the bouquet, which is what seeds its candidates. */
  id: number;
  category: StemCategory;
  /** Which row it stands in, 0 being the front. */
  level: number;
  levels: number;
  /** Half the width of the head as it will be drawn, in pixels. */
  radius: number;
  /** How far above the tie this stem carries its head, from its own cut length. */
  rise: number;
  /** One of the flowers the bouquet is built around. */
  isAnchor: boolean;
  /**
   * Which group of the bouquet this stem belongs to.
   *
   * A florist does not spread flowers evenly, and a bouquet that spreads them
   * evenly looks like it was measured out. They go down in small groups — two
   * or three heads pressed together — with room left between the groups, and
   * the groups gather round the flowers the bouquet is built around. So each
   * flower belongs to one, it looks for its neighbours in its own first, and it
   * sits closer to them than the groups sit to each other.
   */
  cluster: number;
}

export interface Frame {
  /** Half-width of the face of the bouquet, in pixels. */
  massHalf: number;
  /** How far above the tie the middle of the face sits. */
  massTop: number;
  /** How far apart the rows stand. */
  rowStep: number;
  /** How far the front row sinks toward the mouth of the wrap. */
  rimDrop: number;
  /**
   * How far the bottom of the bouquet sweeps back UP toward its sides.
   *
   * Every bouquet does this and it is not decoration: the collar is drawn
   * around the flowers, its mouth is lowest in the middle and rises to a point
   * at each side, and it can only be drawn at all if every head clears that
   * curve. A stem far out to one side and low is under a rising side point, and
   * no collar can be drawn that both holds the bouquet and does not swallow it.
   */
  edgeRise: number;
  /** How much of the rim's dip each role takes. */
  floor: Record<StemCategory, number>;
  /** How far out each role may reach, as a multiple of the face's half-width. */
  spread: Record<StemCategory, number>;
  /** How much of the middle each role leaves alone, as a share of its own reach. */
  clear: Record<StemCategory, number>;
  /** How far each role may lean out from vertical, in degrees. */
  maxLean: Record<StemCategory, number>;
  /** The mean head radius of the flowers, so "a big bloom" means the same all through. */
  meanHead: number;
  /** Rows crowd together toward the sides, as a dome does seen head-on. */
  stepTaper: number;
}

export interface Spot {
  x: number;
  y: number;
  /**
   * The lowest this stem may sit at that point across the bouquet — the front
   * row's own line, which is shaped like the mouth of the wrap. Carried out of
   * the composition because the vertical fit has to respect it: shrinking a
   * bouquet toward the tie point must not push its front row into the paper.
   */
  floor: number;
  score: number;
  /** True when every candidate was struck out and the best of a bad lot was used. */
  struck?: boolean;
  terms: ScoreTerms;
  /** Every position that was considered, for the debug overlay. */
  tried: Array<{ x: number; y: number; score: number }>;
}

interface Settled extends ComposeStem {
  x: number;
  y: number;
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Compose a bouquet, one stem at a time.
 *
 * Order matters and is not the order stems were added: the flowers the bouquet
 * is built around go down first and everything else is judged against them,
 * which is the difference between a composition and a pile. Anchors, then the
 * rest of the flowers largest first, then the greenery that frames them. Filler
 * is not here at all — it goes into the gaps the flowers leave, which is a
 * different question, answered once these are settled.
 */
export function composeStems(
  seed: number,
  stems: ComposeStem[],
  frame: Frame,
): Map<number, Spot> {
  const order = [...stems].sort(
    (a, b) =>
      Number(b.isAnchor) - Number(a.isAnchor) ||
      rank(a.category) - rank(b.category) ||
      b.radius - a.radius ||
      a.id - b.id,
  );

  // Where the bouquet's weight should end up. Deliberately not the middle: a
  // hand-tie carried in one hand is never symmetrical, and a composition
  // balanced exactly about its axis reads as a diagram of a bouquet.
  const lean = randSigned(seed, 0, "lean") * OFF_CENTRE * frame.massHalf;

  const settled: Settled[] = [];
  const spots = new Map<number, Spot>();

  for (const stem of order) {
    const want = wants(seed, stem.id);
    const tried: Array<{ x: number; y: number; score: number }> = [];
    let best: Spot | null = null;

    let fallback: Spot | null = null;

    for (let k = 0; k < CANDIDATES; k += 1) {
      const at = candidate(seed, stem, settled, frame, lean, want, k);
      const terms = judge(at, stem, settled, frame, lean, want);
      const score = total(terms);
      tried.push({ x: at.x, y: at.y, score });
      const spot = { x: at.x, y: at.y, floor: floorAt(stem, frame, at.x), score, terms, tried };
      // Quantised before comparing: a score is a float, and the last bit of a
      // float can differ between Node and a browser, which here would not be a
      // rounding difference — it would be a different flower in a different
      // place, and a hydration mismatch.
      if (!fallback || quantise(score) > quantise(fallback.score)) fallback = spot;
      // Two things are not trade-offs, however good the rest of a position is:
      // a head sunk into the mouth of the wrap, and a head swallowed whole by
      // one of its neighbours. Those candidates are not scored against the
      // others, they are struck out — and only if every one of them is struck
      // out does the best of a bad lot get used.
      if ((terms.floor ?? 0) < 0 || (terms.lean ?? 0) < 0 || (terms.crowding ?? 0) <= -1) continue;
      if (!best || quantise(score) > quantise(best.score)) best = spot;
    }

    const chosen: Spot = best ?? sweep(seed, stem, settled, frame, lean, tried);
    chosen.tried = tried;
    spots.set(stem.id, chosen);
    settled.push({ ...stem, x: chosen.x, y: chosen.y });
  }

  return spots;
}

/**
 * The emptiest place there is, swept for rather than sampled.
 *
 * When every candidate has been struck out — which happens to about one stem in
 * six in a full bouquet — taking the best of the struck ones is the worst
 * possible answer: they were struck for being ruinous, and the least ruinous
 * ruinous position is still a flower swallowed whole. So the band is walked end
 * to end instead, at every height the row allows, and the position that hides
 * the least of anything wins. It is not a composition, it is a place to put a
 * stem that has to go somewhere — but it is the emptiest one, which is what a
 * florist reaches for at the same point.
 */
function sweep(
  seed: number,
  stem: ComposeStem,
  settled: Settled[],
  frame: Frame,
  lean: number,
  tried: Array<{ x: number; y: number; score: number }>,
): Spot {
  const reach = frame.massHalf * frame.spread[stem.category];
  const clear = frame.massHalf * frame.clear[stem.category];

  let best: Spot | null = null;
  let least = Infinity;
  for (let i = 0; i <= SWEEP_ACROSS; i += 1) {
    const x = inBand(-reach + (2 * reach * i) / SWEEP_ACROSS, lean, reach, clear);
    for (let j = 0; j < SWEEP_HEIGHTS; j += 1) {
      const drift = -ROW_DRIFT + (2 * ROW_DRIFT * j) / Math.max(1, SWEEP_HEIGHTS - 1);
      const at = { x, y: rowY(stem, frame, x, drift), r: stem.radius };
      const terms = judge(at, stem, settled, frame, lean, wants(seed, stem.id));
      if ((terms.floor ?? 0) < 0 || (terms.lean ?? 0) < 0) continue;
      // Ranked on how much it buries, then on everything else — the opposite
      // way round from the scoring, because at this point the only question
      // left is where there is room.
      const buries = -(terms.crowding ?? 0);
      const rank = quantise(buries) * 1e3 - quantise(total(terms));
      if (rank < least) {
        least = rank;
        best = { x, y: at.y, floor: floorAt(stem, frame, x), score: total(terms), terms, tried, struck: true };
      }
    }
  }

  return (
    best ?? {
      x: lean,
      y: rowY(stem, frame, lean, 0),
      floor: floorAt(stem, frame, lean),
      score: 0,
      terms: {},
      tried,
      struck: true,
    }
  );
}

function rank(category: StemCategory): number {
  return category === "focal" ? 0 : category === "filler" ? 1 : 2;
}

function quantise(value: number): number {
  return Math.round(value * 1e6);
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * One position to consider.
 *
 * Most candidates are generated BESIDE something already in the bouquet, at a
 * distance chosen to land inside the overlap band — which is how a florist
 * works, and it is the difference between a sampler that finds a good position
 * and one that does not. Sampling the whole face evenly, a late stem in a full
 * bouquet has only a sliver of the face left that is any good, and forty even
 * samples miss it; every one comes back ruinous and the best of a bad lot gets
 * used. Sampling next to a neighbour at a chosen overlap gets it right by
 * construction, and leaves the scoring to judge WHICH neighbour and which side
 * — which is the interesting question anyway.
 *
 * The rest are sampled free across the role's band, because a bouquet also
 * needs stems that start a new group rather than joining one, and because the
 * first stem down has no neighbour to sit beside.
 */
function candidate(
  seed: number,
  stem: ComposeStem,
  settled: Settled[],
  frame: Frame,
  lean: number,
  wanted: number,
  k: number,
) {
  const reach = frame.massHalf * frame.spread[stem.category];
  // Measured against the FLOWERS, not against this role's own reach: "stay out
  // of the middle" means out of the middle of the bouquet, and a role that
  // reaches further would otherwise clear a proportionally bigger hole and end
  // up ringing the flowers instead of standing among them.
  //
  // And only the FRONT of the bouquet is kept clear. A frond across the face of
  // an arrangement is a fern lying on top of one; a frond behind it is the
  // backdrop the flowers are seen against, and a bouquet without one has a hole
  // behind its tallest bloom. So the clearance fades away toward the back rows,
  // where foliage belongs everywhere.
  const t = stem.levels > 1 ? stem.level / (stem.levels - 1) : 0.5;
  const clear = frame.massHalf * frame.clear[stem.category] * (1 - t);

  // The height always comes from the row, so that a stem reads as belonging to
  // the row it was assigned and the depth of the bouquet stays legible. The
  // question a candidate answers is only where ACROSS the bouquet it goes.
  const drift = randSigned(seed, stem.id, "cand-y", k) * ROW_DRIFT;

  const beside = settled.length > 0 && rand(seed, stem.id, "cand-mode", k) < BESIDE_SHARE;
  if (beside) {
    // Next to a neighbour, at a distance that lands in the overlap band. The
    // row has already decided the height, so the distance is spent on what is
    // left of it: solve for the sideways offset that makes up the rest.
    // From its own row or the ones either side of it. Picking any stem at all
    // means most candidates are worked out beside something two rows away,
    // where the height difference eats the whole distance and the sideways
    // offset it solves for is meaningless — so the candidate lands on top of a
    // neighbour it never looked at, and forty of them in a row get struck out.
    // Its own group first, then its own row and the ones either side of it.
    // Picking any stem at all means most candidates are worked out beside
    // something two rows away, where the height difference eats the whole
    // distance and the sideways offset it solves for is meaningless — so the
    // candidate lands on top of a neighbour it never looked at.
    const kin = settled.filter(
      (other) => other.cluster === stem.cluster && Math.abs(other.level - stem.level) <= 1,
    );
    const local =
      kin.length > 0 ? kin : settled.filter((other) => Math.abs(other.level - stem.level) <= 1);
    const from = local.length > 0 ? local : settled;
    const pick =
      from[Math.min(from.length - 1, Math.floor(rand(seed, stem.id, "cand-pick", k) * from.length))];
    // Around this stem's own preference, not around the middle of the band.
    const overlap = clamp(
      (wanted + randSigned(seed, stem.id, "cand-ov", k) * OVERLAP_SLACK) *
        (pick.cluster === stem.cluster ? CLUSTER_TIGHTEN : 1 / CLUSTER_TIGHTEN),
      OVERLAP_MIN * 0.5,
      OVERLAP_MAX,
    );
    const apart = stem.radius + pick.radius - overlap * 2 * Math.min(stem.radius, pick.radius);
    const rise = rowY(stem, frame, pick.x, drift) - pick.y;
    // Never straight above or below: that is not a stem beside another, it is a
    // stem hiding behind one.
    const across = Math.max(apart * 0.4, Math.sqrt(Math.max(0, apart * apart - rise * rise)));
    const side = rand(seed, stem.id, "cand-side", k) < 0.5 ? -1 : 1;
    return settle(pick.x + side * across, stem, settled, frame, lean, reach, clear, drift, wanted);
  }

  const side = rand(seed, stem.id, "cand-side", k) < 0.5 ? -1 : 1;
  const along = rand(seed, stem.id, "cand-x", k);
  const free = lean + side * (clear + along * Math.max(0, reach - clear));
  return settle(free, stem, settled, frame, lean, reach, clear, drift, wanted);
}

/**
 * Slide a candidate clear of whatever it has landed on top of.
 *
 * Sampling alone leaves a lot on the table. In a full bouquet most positions
 * are nearly right — a head that would swallow one neighbour is usually a
 * finger's width from a position that would not — and simply throwing those
 * away meant one stem in six had every one of its candidates struck out and
 * fell back on the worst kind of position there is. Nudging instead is also
 * what a florist does with a stem that does not sit: they move it, they do not
 * put it back in the bucket.
 *
 * Sideways only. The height belongs to the row, and a stem that solved its
 * crowding by rising out of its row would be solving it by leaving the bouquet.
 */
function settle(
  from: number,
  stem: ComposeStem,
  settled: Settled[],
  frame: Frame,
  lean: number,
  reach: number,
  clear: number,
  drift: number,
  wanted: number,
) {
  let x = inBand(from, lean, reach, clear);

  for (let step = 0; step < RELAX_STEPS; step += 1) {
    const y = rowY(stem, frame, x, drift);
    let worst: Settled | null = null;
    let worstOverlap = OVERLAP_MAX;
    for (const other of settled) {
      const d = Math.hypot(other.x - x, other.y - y);
      const behindMe = other.level > stem.level || (other.level === stem.level && other.y < y);
      const buries = behindMe
        ? hidden(other.radius, stem.radius, d)
        : hidden(stem.radius, other.radius, d);
      if (buries > worstOverlap) {
        worstOverlap = buries;
        worst = other;
      }
    }
    if (!worst) break;

    // How far apart they would have to be to sit at a comfortable overlap, and
    // how much of that is left once the row's own height difference is spent.
    const apart =
      stem.radius + worst.radius - wanted * 2 * Math.min(stem.radius, worst.radius);
    const rise = y - worst.y;
    const across = Math.max(apart * 0.4, Math.sqrt(Math.max(0, apart * apart - rise * rise)));
    const side = x >= worst.x ? 1 : -1;
    const moved = inBand(worst.x + side * across, lean, reach, clear);
    if (Math.abs(moved - x) < 1e-9) break;
    x = moved;
  }

  return { x, y: rowY(stem, frame, x, drift), r: stem.radius };
}

/**
 * Holds a position inside the band its role is allowed.
 *
 * The band is not a nicety. A candidate worked out beside a neighbour is a
 * neighbour's position plus an offset, and nothing in that says it lands
 * anywhere near the bouquet — one stem of eucalyptus reached twice as far as
 * the foliage was allowed, and because the fit pass shrinks the WHOLE
 * arrangement to bring a stray back inside the frame, that single stem pulled
 * every flower in the bouquet 42% closer to the middle.
 */
function inBand(x: number, lean: number, reach: number, clear: number): number {
  const off = x - lean;
  const side = off < 0 ? -1 : 1;
  const held = Math.max(Math.min(clear, reach), Math.min(reach, Math.abs(off)));
  // Held against the middle of the CANVAS as well as against the lean, because
  // the reach is how far the frame will take this role and the lean would
  // otherwise carry a stem that far again past it.
  const at = lean + side * held;
  return Math.max(-reach, Math.min(reach, at));
}

/** Where a row's line sits at a given point across the bouquet. */
function rowY(stem: ComposeStem, frame: Frame, x: number, drift: number): number {
  const t = stem.levels > 1 ? stem.level / (stem.levels - 1) : 0.5;
  const u = frame.massHalf > 0 ? Math.min(1, Math.abs(x) / frame.massHalf) : 0;
  return (
    -stem.rise +
    frame.rimDrop * (1 - t) * (1 - u * u) * frame.floor[stem.category] -
    frame.edgeRise * (1 - t) * u * u -
    frame.rowStep * (stem.level + drift) * (1 - frame.stepTaper * u * u)
  );
}

/** The lowest a head may sit at a point across the bouquet: the front row's own line. */
function floorAt(stem: ComposeStem, frame: Frame, x: number): number {
  return rowY({ ...stem, level: 0 }, frame, x, 0);
}

function total(terms: ScoreTerms): number {
  let sum = 0;
  for (const key of Object.keys(terms) as Array<keyof typeof WEIGHTS>) {
    sum += WEIGHTS[key] * (terms[key] ?? 0);
  }
  return sum;
}

/* -------------------------------------------------------------------------- */
/* Judgement                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Score one candidate against the arrangement so far.
 *
 * Every term answers a question you could ask about a photograph of a bouquet,
 * and returns roughly -1 (badly) to 1 (well). Nothing here is a collision test:
 * a bouquet with no collisions and nothing else going for it is exactly the
 * sparse, even, mirror-imaged thing this replaced.
 */
function judge(
  at: { x: number; y: number; r: number },
  stem: ComposeStem,
  settled: Settled[],
  frame: Frame,
  lean: number,
  wanted: number,
): ScoreTerms {
  const terms: ScoreTerms = {};

  // --- the wrap ------------------------------------------------------------
  // Hard: nothing sinks below the front row's line into the mouth of the paper.
  const floor = floorAt(stem, frame, at.x);
  terms.floor = at.y > floor ? -(at.y - floor) / Math.max(1, frame.rowStep) : 0;

  // Hard: every stem comes out of the same bind, so how far out a head sits is
  // how far its stem leans — and a flower leaning past about forty degrees does
  // not read as a flower reaching out, it reads as one that has fallen over.
  //
  // This has to be judged HERE and not left to the fit pass afterwards. The fit
  // brings a lean back by narrowing the whole arrangement, and narrowing moves
  // positions without touching head sizes: one carnation composed at 54 degrees
  // pulled every flower in the bouquet a third of the way to the middle, and
  // every overlap the composition had carefully chosen closed up with it.
  const above = -at.y;
  const leansBy = above > 1 ? Math.atan(Math.abs(at.x) / above) / DEG : 90;
  const mayLean = frame.maxLean[stem.category];
  terms.lean = leansBy <= mayLean ? 0 : -(leansBy - mayLean) / Math.max(1, 90 - mayLean);

  // --- the silhouette ------------------------------------------------------
  // The face of the bouquet is a dome, wider than it is tall. A head is meant
  // to be inside it, with the flowers well inside and the foliage allowed to
  // carry past — that is what gives a bouquet an outline rather than an edge.
  const reach = frame.massHalf * frame.spread[stem.category];
  const top = frame.massTop * frame.spread[stem.category];
  const ex = reach > 0 ? at.x / reach : 0;
  const ey = top > 0 ? (at.y + stem.rise) / top : 0;
  const outside = Math.sqrt(ex * ex + ey * ey);
  terms.silhouette = outside <= 1 ? 1 - outside * 0.4 : -(outside - 1) * 2.5;

  // --- big blooms belong in the body ---------------------------------------
  // A sunflower hung off the edge of a bouquet looks like it fell out of one.
  // Measured against the whole bouquet, not against what happens to be down
  // already: judged against the stems settled so far, the second flower placed
  // is always "average size" and the rule says nothing until the bouquet is
  // half built.
  const big = frame.meanHead > 0 ? at.r / frame.meanHead : 1;
  const out = frame.massHalf > 0 ? Math.abs(at.x - lean) / frame.massHalf : 0;
  terms.edgeSize = stem.category === "focal" ? -Math.max(0, (big - 0.9) * out) : 0;

  if (settled.length === 0) {
    // The first stem down has nothing to be judged against, and that is the
    // point of putting the anchor down first: the rest of the bouquet is
    // composed around wherever it landed.
    return terms;
  }

  // --- neighbours ----------------------------------------------------------
  const near = settled
    .map((other) => {
      const d = Math.hypot(other.x - at.x, other.y - at.y);
      const touch = at.r + other.radius;
      // Whichever of the two is further back is the one that loses something.
      const behindMe = other.level > stem.level || (other.level === stem.level && other.y < at.y);
      return {
        other,
        d,
        touch,
        // How firmly the two are attached, which is what "some overlap" means.
        overlap: touch > 0 ? (touch - d) / (2 * Math.min(at.r, other.radius)) : 0,
        // And how much of the one behind is actually lost, which is a different
        // question and the one that matters.
        hides: behindMe ? hidden(other.radius, at.r, d) : hidden(at.r, other.radius, d),
      };
    })
    .sort((a, b) => a.d - b.d);
  const neighbourhood = near.slice(0, 5);
  const closest = neighbourhood[0];

  // Overlap, judged on the closest neighbour: some is wanted, and it is wanted
  // in a band. Below it the bouquet has daylight through it; above it one head
  // is eating another.
  terms.overlap = band(closest.overlap, OVERLAP_MIN, wanted, OVERLAP_MAX);
  terms.crowding = -neighbourhood.reduce(
    (worst, n) => Math.max(worst, Math.max(0, n.hides - OVERLAP_MAX) / (OVERLAP_RUIN - OVERLAP_MAX)),
    0,
  );

  // Clustering: two or three heads of its own group within touching distance
  // reads as a bunch. Counted over the group rather than over whatever happens
  // to be nearby, because a stem surrounded by three flowers from three
  // different groups is not in a group — it is in the way of all of them.
  const grouped = neighbourhood.filter(
    (n) => n.other.cluster === stem.cluster && n.d < n.touch * CLUSTER_NEAR,
  ).length;
  terms.cluster = 1 - Math.abs(grouped - CLUSTER_WANT) / CLUSTER_WANT;

  // Isolation: a stem with its nearest neighbour a head and a half away is not
  // part of the bouquet, it is next to it.
  const gapToNearest = closest.touch > 0 ? closest.d / closest.touch : 0;
  terms.isolation = -Math.max(0, gapToNearest - ISOLATED_AT);

  // Gap filling: how empty this spot was before the stem went into it. Every
  // head within reach shades the spot; a candidate in shadow is filling
  // nothing.
  const shade = settled.reduce((sum, other) => {
    const d = Math.hypot(other.x - at.x, other.y - at.y);
    const span = (at.r + other.radius) * 1.6;
    return sum + (d < span ? 1 - d / span : 0);
  }, 0);
  terms.gap = clamp(1 - shade / 2.2, -1, 1);

  // Density: full in the middle and up, thinning outward.
  //
  // Scored on what the stem WOULD DO to the local density, not on what the
  // density already is. Scored on the latter it says the exact opposite of what
  // it means: an empty middle is the furthest a spot can be from its target, so
  // a flower put there to fill it was the most heavily penalised candidate on
  // the board — and every bouquet came out hollow, with its flowers pushed to
  // the rim and a hole where the heart should be.
  const heartX = frame.massHalf > 0 ? clamp(Math.abs(at.x - lean) / frame.massHalf, 0, 1) : 0;
  const target = DENSITY_HEART * (1 - heartX * heartX * DENSITY_FALLOFF);
  const before = Math.abs(shade - target);
  const after = Math.abs(shade + 1 - target);
  terms.density = clamp((before - after) / Math.max(1, target), -1, 1);

  // Balance: the bouquet's weight should end up near the lean, not wherever the
  // last few stems happened to fall.
  const weight = settled.reduce((sum, s) => sum + s.radius * s.radius, 0) + at.r * at.r;
  const centre =
    (settled.reduce((sum, s) => sum + s.x * s.radius * s.radius, 0) + at.x * at.r * at.r) / weight;
  terms.balance = frame.massHalf > 0 ? -Math.abs(centre - lean) / frame.massHalf : 0;

  // Symmetry: a head sitting where another head's reflection would be. Two or
  // three of those and the bouquet reads as a pattern.
  terms.symmetry = -settled.reduce((worst, other) => {
    const d = Math.hypot(other.x - (2 * lean - at.x), other.y - at.y);
    const touch = at.r + other.radius;
    return Math.max(worst, touch > 0 ? Math.max(0, 1 - d / (touch * MIRROR_NEAR)) : 0);
  }, 0);

  // Uniformity: if this stem's distance to its neighbour matches everyone
  // else's, the bouquet is a grid however organic each step looked.
  const spacings = settled
    .map((s) => {
      const rest = settled.filter((o) => o !== s);
      if (rest.length === 0) return null;
      return Math.min(...rest.map((o) => Math.hypot(o.x - s.x, o.y - s.y)));
    })
    .filter((d): d is number => d !== null);
  if (spacings.length > 1) {
    const meanSpacing = spacings.reduce((sum, d) => sum + d, 0) / spacings.length;
    terms.uniformity = -Math.max(
      0,
      1 - Math.abs(closest.d - meanSpacing) / Math.max(1, meanSpacing * 0.35),
    );
  }

  // A flat top edge is the single clearest tell of a bouquet that was laid out
  // rather than arranged.
  const tops = settled.map((s) => s.y - s.radius);
  const myTop = at.y - at.r;
  terms.flatTop = -tops.reduce(
    (worst, t) => Math.max(worst, Math.max(0, 1 - Math.abs(t - myTop) / (at.r * FLAT_WITHIN * 2))),
    0,
  );

  // Gather round the flowers the bouquet is built around.
  //
  // This is what makes an anchor an anchor. Without it the biggest bloom is
  // just the biggest bloom — it goes down first and then everything else
  // arranges itself with no reference to it, which for one tall flower among
  // small ones leaves it standing alone above the bouquet on a bare stem. The
  // reward falls off over about two head widths, so it pulls a supporting
  // flower into the anchor's neighbourhood without pulling every flower in the
  // bouquet into a heap around it.
  const anchors = settled.filter((other) => other.isAnchor);
  terms.gathers = anchors.length === 0
    ? 0
    : anchors.reduce((best, other) => {
        const d = Math.hypot(other.x - at.x, other.y - at.y);
        const span = (at.r + other.radius) * GATHER_SPAN;
        return Math.max(best, span > 0 ? 1 - Math.min(1, d / span) : 0);
      }, 0);

  // And never cover the flower the bouquet was built around.
  terms.blocksAnchor = -settled.reduce((worst, other) => {
    if (!other.isAnchor || other.level < stem.level) return worst;
    const d = Math.hypot(other.x - at.x, other.y - at.y);
    return Math.max(worst, Math.max(0, 1 - d / Math.max(1, other.radius)));
  }, 0);

  return terms;
}

/**
 * How much of the head BEHIND is lost under the head in front.
 *
 * Not the same as how much the two overlap, and the difference is the whole
 * reason a bouquet can be full at all. A rose tucked under the edge of a lily
 * overlaps it enormously by any symmetric measure — the rose's own centre is
 * well inside the lily's disc — but the rose is in FRONT, and what it costs the
 * lily is the ninth of it the rose is big enough to cover. Judged
 * symmetrically, no small flower could ever be placed near a big one, and every
 * bouquet with a lily in it came out with a hole around the lily.
 *
 * How deeply they interpenetrate, times the most the front one could possibly
 * cover — which is the ratio of their areas. Cheap, monotone in both arguments,
 * and free of the transcendentals an exact lens area would need, which matters
 * because these numbers decide a sort.
 */
function hidden(behind: number, front: number, d: number): number {
  if (behind <= 0) return 0;
  const deep = clamp((front + behind - d) / (2 * Math.min(front, behind)), 0, 1);
  const most = Math.min(1, (front / behind) * (front / behind));
  return deep * most;
}

/**
 * 1 at `best`, 0 at either edge of the band, and negative outside it.
 *
 * Used wherever a measurement is wrong in both directions, which most of them
 * are — the reason a bouquet is hard is that almost nothing about it is a
 * quantity to be maximised.
 */
function band(value: number, low: number, best: number, high: number): number {
  if (value < low) return -Math.min(1, (low - value) / Math.max(1e-6, low));
  if (value > high) return -Math.min(1, (value - high) / Math.max(1e-6, high));
  const half = value < best ? best - low : high - best;
  return half <= 0 ? 1 : 1 - Math.abs(value - best) / half;
}
