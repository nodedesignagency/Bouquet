/**
 * Engine checks, run with `npm run verify:engine`.
 *
 * Two kinds of thing are asserted here. The determinism guarantee ("same seed =
 * same bouquet, always") is the kind of property that quietly breaks the moment
 * someone reaches for `Math.random`. The rest are the arrangement rules — and
 * they are written as what a BOUQUET has to look like, never as what the
 * current constants happen to produce, because a check that restates the
 * implementation passes happily while the render is wrong. That has already
 * happened twice on this engine.
 */

import {
  computeLayout,
  levelCount,
  placeStems,
  planStems,
  scaleForLevel,
  paintOrder,
  spriteWidthPx,
  type PlacedStem,
} from "../lib/engine";
import { buildWrap, rimYAt } from "../lib/wrap";
import { addStem, DEFAULT_STATE, nudgeDepth, removeStemAt, starterBouquet } from "../lib/state";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../lib/canvas";
import type { BouquetState, StemCategory } from "../lib/types";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function build(seed: number, recipe: Array<[string, number]>): BouquetState {
  let state: BouquetState = { ...DEFAULT_STATE, seed };
  for (const [itemId, count] of recipe) {
    for (let i = 0; i < count; i += 1) state = addStem(state, itemId);
  }
  return state;
}

function lay(state: BouquetState) {
  const layout = computeLayout(CANVAS_WIDTH, CANVAS_HEIGHT, state);
  return { layout, placed: placeStems(state, layout) };
}

function fingerprint(state: BouquetState): string {
  return lay(state)
    .placed.map((s) =>
      [
        s.item.id,
        s.n,
        s.level,
        s.slot,
        s.headX.toFixed(4),
        s.headY.toFixed(4),
        s.rotationDeg.toFixed(4),
        s.widthPx.toFixed(4),
        s.layer,
      ].join(","),
    )
    .join("|");
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * A spread of bouquets to assert the rules over. One recipe cannot show much:
 * whether two flowers collide depends on where the spiral happened to put them,
 * so the structural rules are checked across shapes and seeds rather than on
 * whichever arrangement happened to be looked at last.
 */
const RECIPES: Array<[string, Array<[string, number]>]> = [
  ["mixed", [["sunflower-small", 1], ["lily-white", 3], ["rose-red", 5], ["carnation-pink", 4]]],
  ["sunflower-heavy", [["sunflower", 3], ["sunflower-small", 2], ["rose-red", 3], ["carnation-pink", 3]]],
  ["lily-heavy", [["lily-white", 6], ["carnation-pink", 4]]],
  ["one-of-each", [["sunflower", 1], ["lily-white", 1], ["rose-red", 1], ["carnation-pink", 1]]],
  [
    "full",
    [
      ["sunflower", 2],
      ["lily-white", 3],
      ["rose-red", 6],
      ["carnation-pink", 3],
      ["babysbreath", 4],
      ["eucalyptus-silver", 4],
      ["fern-leatherleaf", 3],
    ],
  ],
  [
    "green-heavy",
    [["rose-red", 5], ["babysbreath", 2], ["eucalyptus-silver", 6], ["fern-leatherleaf", 6]],
  ],
];
const SEEDS = [8412, 1, 777, 20260906, 65535];

const EVERY: Array<{ name: string; state: BouquetState }> = [];
for (const [name, recipe] of RECIPES) {
  for (const seed of SEEDS) EVERY.push({ name: `${name}/${seed}`, state: build(seed, recipe) });
}
EVERY.push({ name: "starter", state: starterBouquet() });

console.log("\nengine");

/* -------------------------------------------------------------------------- */
/* Determinism                                                                  */
/* -------------------------------------------------------------------------- */

const a = starterBouquet();
check("same state renders identically", fingerprint(a) === fingerprint(starterBouquet()));
check("a different seed moves the stems", fingerprint(a) !== fingerprint({ ...a, seed: a.seed + 1 }));

// Jitter is addressed by ordinal rather than drawn from a stream, so removing
// the last stem must not re-roll anything. The rows do reflow — they have to,
// or a gap would be left standing in mid-air — but every stem that remains has
// to come back with bit-identical jitter.
{
  const trimmed = removeStemAt(a, a.stems.length - 1);
  const before = lay(a).placed;
  const after = lay(trimmed).placed;
  check(
    "removing a stem does not re-roll the others' jitter",
    after.every((s, i) => s.angleDeg === before[i].angleDeg),
  );
}

/* -------------------------------------------------------------------------- */
/* The rules of the arrangement                                                 */
/* -------------------------------------------------------------------------- */

const { layout, placed } = lay(a);

check(
  "tie point is 50% x, 72% y",
  layout.tieX === CANVAS_WIDTH * 0.5 && layout.tieY === CANVAS_HEIGHT * 0.72,
);
check(
  "a course is built in roughly square rows",
  levelCount(1) === 1 && levelCount(4) === 2 && levelCount(9) === 3 && levelCount(30) === 4,
);
check("scale drops 12% per row back", Math.abs(scaleForLevel(2) - 0.7744) < 1e-9);

const RANK: Record<StemCategory, number> = { focal: 0, filler: 1, green: 2 };
check(
  "placement runs focal, then filler, then greens",
  placed.every((s, i) => i === 0 || RANK[placed[i - 1].item.category] <= RANK[s.item.category]),
  placed.map((s) => s.item.category).join(" "),
);

/* -- levels ---------------------------------------------------------------- */

// The whole point of the level model: one number settles a stem's depth, its
// height and its size together, so those three can never disagree. Asserted as
// three separate consequences, because each was wrong at some point.

{
  let broken = "";
  for (const { name, state } of EVERY) {
    const stems = lay(state).placed;
    for (const category of ["focal", "filler", "green"] as StemCategory[]) {
      const of = stems.filter((s) => s.item.category === category);
      if (of.length === 0) continue;
      const rows = [...new Set(of.map((s) => s.level))].sort((x, y) => x - y);
      for (let i = 1; i < rows.length && !broken; i += 1) {
        const front = of.filter((s) => s.level === rows[i - 1]);
        const back = of.filter((s) => s.level === rows[i]);
        if (mean(back.map((s) => s.headY)) >= mean(front.map((s) => s.headY))) {
          broken = `${name} ${category} row ${rows[i]} does not stand above row ${rows[i - 1]}`;
        }
      }
    }
  }
  check("each row back stands above the one in front", broken === "", broken);
}

{
  // One ladder for the whole bouquet. Counted per role, a green in "the back
  // row" of two stood one step up while the flowers stood three, so foliage
  // meant to be behind the bouquet ended up in front of half of it.
  let broken = "";
  for (const { name, state } of EVERY) {
    const stems = lay(state).placed;
    const depths = new Set(stems.map((s) => s.levels));
    if (depths.size > 1) broken = `${name}: rows counted ${[...depths].join(" and ")} ways`;
  }
  check("every role is on the same depth ladder", broken === "", broken);
}

{
  // The user's rule, verbatim: what is drawn in front is what sits lower, and
  // what shows above the rest is what is behind. Paint order comes from the row,
  // and the row comes from the same number as the height, so the two cannot come
  // apart — this asserts they actually don't. Stated over the flowers, which are
  // what "sits lower" is about; foliage and filler have their own heights within
  // a row on purpose.
  let broken = "";
  for (const { name, state } of EVERY) {
    const order = paintOrder(lay(state).placed).filter((s) => s.item.category === "focal");
    for (let i = 1; i < order.length && !broken; i += 1) {
      const behind = order[i - 1];
      const infront = order[i];
      if (infront.level === behind.level) continue;
      if (infront.level > behind.level) broken = `${name}: flowers painted out of row order`;
      else if (infront.headY < behind.headY) {
        broken = `${name}: ${infront.item.id} is painted in front of ${behind.item.id} but sits above it`;
      }
    }
  }
  check("what is painted in front is what sits lower", broken === "", broken);
}

{
  // The reason paint order moved off the layers entirely. Whatever a stem IS,
  // it is drawn where it STANDS: a stem of gypsophila wedged between the front
  // two rows goes over the flowers behind it, and a frond in the third row goes
  // over the fourth. Painting by category instead put every green and every
  // stem of filler behind every flower, which turned the foliage into a backdrop
  // hung behind the bouquet rather than part of it.
  let broken = "";
  let interleaved = 0;
  for (const { name, state } of EVERY) {
    const order = paintOrder(lay(state).placed);
    order.forEach((stem, i) => {
      if (stem.item.category === "focal") return;
      const over = order.slice(i + 1).filter((o) => o.item.category === "focal");
      // Anything in a nearer row than a flower must be painted after it.
      const wrong = over.find((flower) => flower.level > stem.level);
      if (wrong) {
        broken = `${name}: ${stem.item.id} in row ${stem.level} is painted behind ${wrong.item.id} in row ${wrong.level}`;
      }
      if (order.slice(0, i).some((o) => o.item.category === "focal" && o.level > stem.level)) {
        interleaved += 1;
      }
    });
  }
  check("a stem is drawn where it stands, not behind everything of its kind", broken === "", broken);
  check(
    "foliage and filler are in among the flowers, not behind all of them",
    interleaved > 0,
    "nothing but flowers was ever painted over a flower",
  );
}

{
  let broken = "";
  for (const { name, state } of EVERY) {
    for (const stem of lay(state).placed) {
      if (stem.scale > scaleForLevel(stem.level) + 1e-12) broken = `${name} ${stem.item.id}`;
    }
  }
  check("a stem further back is drawn smaller", broken === "", broken);
}

/* -- overlap --------------------------------------------------------------- */

/** How much of `stem`'s head is hidden by the flowers painted in front of it. */
function buriedFraction(stem: PlacedStem, layer: PlacedStem[]): number {
  const order = paintOrder(layer);
  const at = order.indexOf(stem);
  const infront = order.slice(at + 1);
  if (infront.length === 0) return 0;

  const r = stem.widthPx / 2;
  if (r <= 0) return 0;
  const GRID = 12;
  let inside = 0;
  let covered = 0;
  for (let iy = 0; iy < GRID; iy += 1) {
    for (let ix = 0; ix < GRID; ix += 1) {
      const x = stem.headX - r + ((ix + 0.5) * 2 * r) / GRID;
      const y = stem.headY - r + ((iy + 0.5) * 2 * r) / GRID;
      // Heads read as discs, not squares — sampling the square would count
      // corners no petal ever reaches.
      if ((x - stem.headX) ** 2 + (y - stem.headY) ** 2 > r * r) continue;
      inside += 1;
      for (const other of infront) {
        const ro = other.widthPx / 2;
        if ((x - other.headX) ** 2 + (y - other.headY) ** 2 <= ro * ro) {
          covered += 1;
          break;
        }
      }
    }
  }
  return inside === 0 ? 0 : covered / inside;
}

{
  // The failure the level model exists to prevent: a flower placed, paid for,
  // and then completely covered by the one in front of it. Some overlap is the
  // whole idea of a bouquet — this only asks that every flower still shows.
  const MOST_BURIED = 0.7;
  let worst = 0;
  let where = "";
  for (const { name, state } of EVERY) {
    const focals = lay(state).placed.filter((s) => s.layer === "focal");
    for (const stem of focals) {
      const buried = buriedFraction(stem, focals);
      if (buried > worst) {
        worst = buried;
        where = `${name}: ${stem.item.id} in row ${stem.level}`;
      }
    }
  }
  check(
    "no flower is buried behind the ones in front of it",
    worst <= MOST_BURIED,
    `worst ${(worst * 100).toFixed(0)}% hidden — ${where}`,
  );
  console.log(`        worst ${(worst * 100).toFixed(0)}% hidden (limit ${MOST_BURIED * 100}%) — ${where}`);
}

{
  // Neighbours in a row overlap by design, but a row is a row: two flowers side
  // by side must not be stacked on each other.
  const MOST_ROW_OVERLAP = 0.45;
  let worst = 0;
  let where = "";
  for (const { name, state } of EVERY) {
    const focals = lay(state).placed.filter((s) => s.item.category === "focal");
    for (const stem of focals) {
      for (const other of focals) {
        if (other === stem || other.level !== stem.level) continue;
        const gap = Math.abs(other.headX - stem.headX);
        const touching = (stem.widthPx + other.widthPx) / 2;
        const overlap = (touching - gap) / Math.min(stem.widthPx, other.widthPx);
        if (overlap > worst) {
          worst = overlap;
          where = `${name}: ${stem.item.id} and ${other.item.id} in row ${stem.level}`;
        }
      }
    }
  }
  check(
    "flowers standing in the same row do not pile up",
    worst <= MOST_ROW_OVERLAP,
    `worst ${(worst * 100).toFixed(0)}% — ${where}`,
  );
  console.log(`        worst ${(worst * 100).toFixed(0)}% (limit ${MOST_ROW_OVERLAP * 100}%) — ${where}`);
}

/* -- the wrap -------------------------------------------------------------- */

check(
  "every head sits above the tie point",
  EVERY.every(({ state }) => {
    const { layout: l, placed: p } = lay(state);
    return p.every((s) => s.headY < l.tieY);
  }),
);

{
  // The one that actually went wrong: a flower low AND off to one side landing
  // under the collar's rising side point, and vanishing behind the paper. The
  // front row follows the shape of the rim to prevent it, so assert the two
  // curves never cross.
  let buried = 0;
  let checked = 0;
  for (const { state } of EVERY) {
    const { layout: l, placed: p } = lay(state);
    const { rim } = buildWrap(state, l, p);
    if (!rim) continue;
    for (const stem of p) {
      checked += 1;
      // Half a bloom may sit behind the paper — that is a flower resting in the
      // wrap — but the middle of it must not.
      if (stem.headY > rimYAt(rim, stem.headX)) buried += 1;
    }
  }
  check(
    "no flower's centre falls behind the collar rim",
    buried === 0,
    `${buried} of ${checked} heads buried`,
  );
}

/* -- the three roles ------------------------------------------------------- */

{
  const banded = build(4242, [
    ["rose-red", 6],
    ["lily-white", 3],
    ["babysbreath", 4],
    ["eucalyptus-silver", 3],
    ["fern-leatherleaf", 2],
  ]);
  const { layout: l, placed: stems } = lay(banded);
  const of = (category: StemCategory) => stems.filter((s) => s.item.category === category);

  // Measured by reach, not by centre. A spray is foliage all the way down its
  // stem, so it belongs rooted among the flowers with its tips carrying past
  // them — placing its middle out where its tips should be strands the whole
  // thing in empty space, which is precisely what it used to do.
  const reach = (category: StemCategory) =>
    Math.max(...of(category).map((s) => Math.abs(s.headX - l.tieX) + s.widthPx / 2));
  const nearest = (category: StemCategory) =>
    Math.min(...of(category).map((s) => Math.abs(s.headX - l.tieX)));
  const furthest = (category: StemCategory) =>
    Math.max(...of(category).map((s) => Math.abs(s.headX - l.tieX)));

  check(
    "greenery reaches past the flower mass",
    reach("green") > reach("focal"),
    `greens reach ${reach("green").toFixed(0)}px, flowers ${reach("focal").toFixed(0)}px`,
  );
  check(
    "greenery is rooted among the flowers, not stranded outside them",
    nearest("green") < furthest("focal"),
    `nearest green ${nearest("green").toFixed(0)}px vs furthest flower ${furthest("focal").toFixed(0)}px`,
  );
  check(
    "greenery carries higher than the flowers",
    mean(of("green").map((s) => s.headY)) < mean(of("focal").map((s) => s.headY)),
  );
  check(
    "filler threads through the flowers rather than ringing them",
    nearest("filler") < furthest("focal"),
  );
}

{
  // "Baby's breath should be in between gaps of flowers." Filler is not laid
  // out at all — it is tucked into the spaces the flowers left — so the thing
  // to assert is that it is genuinely in one: nearer to two flowers than those
  // two are to each other is what "between" means, and no stem of it is off on
  // its own away from the bouquet.
  let stranded = "";
  let notBetween = "";
  let between = 0;
  for (const { name, state } of EVERY) {
    const stems = lay(state).placed;
    const focals = stems.filter((s) => s.item.category === "focal");
    const plan = planStems(state);
    if (focals.length < 2) continue;
    // How far apart neighbouring flowers stand — the scale of the packing, and
    // so of the gaps in it. Measured rather than assumed, because a bouquet of
    // sunflowers has gaps three times the size of a bouquet of carnations.
    const apartest = Math.max(
      ...focals.map((f) =>
        Math.min(
          ...focals
            .filter((o) => o !== f)
            .map((o) => Math.hypot(o.headX - f.headX, o.headY - f.headY)),
        ),
      ),
    );
    for (const filler of stems.filter((s) => s.item.category === "filler")) {
      const gap = plan.find((e) => e.stemIndex === filler.stemIndex)?.gap;
      if (!gap) continue;
      const near = focals
        .map((f) => ({ f, d: Math.hypot(f.headX - filler.headX, f.headY - filler.headY) }))
        .sort((x, y) => x.d - y.d);
      // Never adrift: a stem of gypsophila is never further from the flowers
      // than the flowers are from each other, whichever gap it went into.
      if (near[0].d > apartest) {
        stranded = `${name}: ${gap.kind} gap is ${near[0].d.toFixed(
          0,
        )}px from the nearest bloom, and the flowers stand at most ${apartest.toFixed(0)}px apart`;
      }
      if (gap.kind === "edge") continue;
      between += 1;
      // And in a seam or a triangle, actually between the two: closer to each
      // of them than they are to each other.
      const apart = Math.hypot(near[0].f.headX - near[1].f.headX, near[0].f.headY - near[1].f.headY);
      if (near[0].d >= apart || near[1].d >= apart) {
        notBetween = `${name}: ${gap.kind} gap sits ${near[0].d.toFixed(0)}/${near[1].d.toFixed(
          0,
        )}px from two blooms that are ${apart.toFixed(0)}px apart`;
      }
    }
  }
  check("no stem of filler is left adrift of the flowers", stranded === "", stranded);
  check(
    "filler in a seam or a triangle really is between the two flowers",
    notBetween === "" && between > 0,
    notBetween || "no filler landed in a seam or a triangle",
  );
}

{
  // Foliage is the background. It may drape over the rim at the edges, but a
  // frond standing up through the middle of the flowers, painted over them, is
  // the thing that made the arrangement look like a hedge.
  let broken = "";
  for (const { name, state } of EVERY) {
    const { layout: l, placed: p } = lay(state);
    const focals = p.filter((s) => s.item.category === "focal");
    if (focals.length === 0) continue;
    const massHalf = Math.max(...focals.map((s) => Math.abs(s.headX - l.tieX)));
    for (const green of p.filter((s) => s.layer === "front-greens")) {
      if (Math.abs(green.headX - l.tieX) <= massHalf) {
        broken = `${name}: ${green.item.id} drawn over the flowers at ${Math.abs(
          green.headX - l.tieX,
        ).toFixed(0)}px, inside the flower mass at ${massHalf.toFixed(0)}px`;
      }
    }
  }
  check("only foliage standing outside the flowers is drawn over them", broken === "", broken);
}

{
  // "It should not disturb each other." Greenery and filler have their own rows,
  // their own widths and their own spacing, and the dome they ride is measured
  // across the FLOWERS — so a bouquet of roses is the same bouquet of roses
  // whether or not there is eucalyptus behind it.
  const bare = build(4242, [["rose-red", 3], ["lily-white", 2]]);
  const dressed = build(4242, [
    ["rose-red", 3],
    ["lily-white", 2],
    ["babysbreath", 3],
    ["eucalyptus-silver", 4],
    ["fern-leatherleaf", 2],
  ]);
  const before = lay(bare).placed.filter((s) => s.item.category === "focal");
  const after = lay(dressed).placed.filter((s) => s.item.category === "focal");
  check(
    "adding greenery and filler leaves the flowers exactly where they were",
    before.length === after.length &&
      before.every(
        (s, i) => Math.abs(s.headX - after[i].headX) < 1e-9 && Math.abs(s.headY - after[i].headY) < 1e-9,
      ),
    before
      .map((s, i) => `${s.item.id} ${(s.headX - after[i].headX).toFixed(2)},${(s.headY - after[i].headY).toFixed(2)}`)
      .join(" "),
  );
}

/* -- the depth control ----------------------------------------------------- */

{
  // "When we move the flower above or below then its position also change."
  // Pulling a stem forward has to be a move, not a repaint: a row nearer the
  // front, lower on the canvas, and painted over more of its neighbours.
  let moved = 0;
  let broken = "";
  for (const { name, state } of EVERY) {
    const start = lay(state).placed;
    const back = [...start]
      .filter((s) => s.item.category === "focal")
      .sort((x, y) => y.level - x.level)[0];
    if (!back || back.level === 0) continue;
    const forward = nudgeDepth(state, back.stemIndex, 1);
    const now = lay(forward).placed.find((s) => s.stemIndex === back.stemIndex);
    if (!now) continue;
    moved += 1;
    if (now.level !== back.level - 1) broken = `${name}: row ${back.level} -> ${now.level}`;
    else if (now.headY <= back.headY) broken = `${name}: came forward without coming down`;
    else if (now.scale <= back.scale) broken = `${name}: came forward without coming closer`;
  }
  check("bringing a stem forward moves it forward, down and closer", broken === "" && moved > 0, broken);

  const sent = nudgeDepth(a, 0, -1);
  const first = lay(a).placed.find((s) => s.stemIndex === 0)!;
  const pushed = lay(sent).placed.find((s) => s.stemIndex === 0)!;
  check(
    "sending a stem back moves it back and up",
    pushed.level > first.level && pushed.headY < first.headY,
    `row ${first.level} -> ${pushed.level}, y ${first.headY.toFixed(0)} -> ${pushed.headY.toFixed(0)}`,
  );
}

/* -- the spiral ------------------------------------------------------------ */

// The golden angle should be recoverable from consecutive stems, to within the
// +/-8 degrees of jitter the brief allows (so a 16 degree window).
const angleGaps = placed.slice(1).map((s, i) => {
  const raw = s.angleDeg - placed[i].angleDeg;
  return ((raw % 360) + 360) % 360;
});
check(
  "consecutive stems are a golden angle apart (+/-16 deg)",
  angleGaps.every((gap) => Math.abs(gap - 137.5) <= 16),
  angleGaps.map((g) => g.toFixed(1)).join(" "),
);

/* -------------------------------------------------------------------------- */
/* Sizing                                                                       */
/* -------------------------------------------------------------------------- */

check(
  "sizing comes from real millimetres",
  spriteWidthPx(180, 900, 1) === 405 && spriteWidthPx(75, 900, 1) === 168.75,
);
{
  const sunflower = lay(addStem(DEFAULT_STATE, "sunflower")).placed[0];
  const rose = lay(addStem(DEFAULT_STATE, "rose-red")).placed[0];
  check(
    "a 180mm sunflower renders 2.4x a 75mm rose",
    Math.abs(sunflower.widthPx / rose.widthPx - 180 / 75) < 1e-9,
  );
}

/* -------------------------------------------------------------------------- */
/* Purity                                                                       */
/* -------------------------------------------------------------------------- */

const realRandom = Math.random;
Math.random = () => {
  throw new Error("Math.random() called during render");
};
try {
  fingerprint(starterBouquet());
  check("no Math.random in the placement path", true);
} catch (err) {
  check("no Math.random in the placement path", false, String(err));
} finally {
  Math.random = realRandom;
}

console.log(
  failures === 0 ? "\nall engine checks passed\n" : `\n${failures} engine check(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
