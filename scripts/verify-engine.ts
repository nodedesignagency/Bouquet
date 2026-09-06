/**
 * Engine checks, run with `npm run verify:engine`.
 *
 * The determinism guarantee ("same seed = same bouquet, always") is the kind of
 * property that quietly breaks the moment someone reaches for `Math.random`, so
 * it is worth asserting rather than trusting.
 */

import { computeLayout, placeStems, ringForIndex, scaleForRing, spriteWidthPx } from "../lib/engine";
import { buildWrap, rimYAt } from "../lib/wrap";
import { addStem, DEFAULT_STATE, removeStemAt, starterBouquet } from "../lib/state";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../lib/canvas";
import type { BouquetState } from "../lib/types";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function fingerprint(state: BouquetState): string {
  const layout = computeLayout(CANVAS_WIDTH, CANVAS_HEIGHT, state);
  return placeStems(state, layout)
    .map((s) =>
      [
        s.item.id,
        s.n,
        s.ring,
        s.headX.toFixed(4),
        s.headY.toFixed(4),
        s.rotationDeg.toFixed(4),
        s.widthPx.toFixed(4),
        s.layer,
      ].join(","),
    )
    .join("|");
}

console.log("\nengine");

// --- determinism ------------------------------------------------------------
const a = starterBouquet();
const b = starterBouquet();
check("same state renders identically", fingerprint(a) === fingerprint(b));

const reseeded = { ...a, seed: a.seed + 1 };
check("a different seed moves the stems", fingerprint(a) !== fingerprint(reseeded));

// Jitter is addressed by ordinal rather than drawn from a stream, so removing
// the last stem must not re-roll anything. Ring spacing does adapt to the mean
// head width, so the spiral breathes in or out by one common factor — but every
// stem's jittered ANGLE has to come back bit-identical, and every stem's
// jittered radius has to move by that same factor and no other.
const trimmed = removeStemAt(a, a.stems.length - 1);
const before = placeStems(a, computeLayout(CANVAS_WIDTH, CANVAS_HEIGHT, a));
const after = placeStems(trimmed, computeLayout(CANVAS_WIDTH, CANVAS_HEIGHT, trimmed));
check(
  "removing a stem does not re-roll the others' jitter",
  after.every((s, i) => s.angleDeg === before[i].angleDeg),
);
const ratios = after
  .map((s, i) => (before[i].radiusPx === 0 ? null : s.radiusPx / before[i].radiusPx))
  .filter((r): r is number => r !== null);
check(
  "the spiral only rescales, it does not reshuffle",
  ratios.every((r) => Math.abs(r - ratios[0]) < 1e-12),
);

// --- placement rules --------------------------------------------------------
const layout = computeLayout(CANVAS_WIDTH, CANVAS_HEIGHT, a);
const placed = placeStems(a, layout);

check("tie point is 50% x, 72% y", layout.tieX === CANVAS_WIDTH * 0.5 && layout.tieY === CANVAS_HEIGHT * 0.72);
check("ring 0 holds the first stem only", ringForIndex(0) === 0 && ringForIndex(1) === 1 && ringForIndex(4) === 2);
check("scale drops 12% per ring", Math.abs(scaleForRing(2) - 0.7744) < 1e-9);
// Focals take the middle, filler sits around them, greens land outside. Stated
// as the ordering invariant rather than "the last stem is not a focal", so it
// still means something for a catalog that is all one category.
const RANK = { focal: 0, filler: 1, green: 2 } as const;
check(
  "placement runs focal, then filler, then greens",
  placed.every((s, i) => i === 0 || RANK[placed[i - 1].item.category] <= RANK[s.item.category]),
  placed.map((s) => s.item.category).join(" "),
);
check(
  "every head sits above the tie point",
  placed.every((s) => s.headY < layout.tieY),
);

// The one that actually went wrong: a flower low AND off to one side landing
// under the collar's rising side point, and vanishing behind the paper. The
// dome's floor is shaped like the rim to prevent it, so assert the two curves
// never cross — across several seeds and several recipes, since whether they do
// depends on where the spiral happens to put things.
const RECIPES: Array<[string, Array<[string, number]>]> = [
  ["mixed", [["sunflower-small", 1], ["lily-white", 3], ["rose-red", 5], ["carnation-pink", 4]]],
  ["sunflower-heavy", [["sunflower", 3], ["sunflower-small", 2], ["rose-red", 3], ["carnation-pink", 3]]],
  ["lily-heavy", [["lily-white", 6], ["carnation-pink", 4]]],
  ["one-of-each", [["sunflower", 1], ["lily-white", 1], ["rose-red", 1], ["carnation-pink", 1]]],
];

let buried = 0;
let checked = 0;
for (const [, recipe] of RECIPES) {
  for (const seed of [8412, 1, 777, 20260906, 65535]) {
    let candidate: BouquetState = { ...DEFAULT_STATE, seed };
    for (const [itemId, count] of recipe) {
      for (let i = 0; i < count; i += 1) candidate = addStem(candidate, itemId);
    }
    const l = computeLayout(CANVAS_WIDTH, CANVAS_HEIGHT, candidate);
    const stems = placeStems(candidate, l);
    const { rim } = buildWrap(candidate, l, stems);
    if (!rim) continue;
    for (const stem of stems) {
      checked += 1;
      // The head's centre must clear the rim. Half a bloom may sit behind the
      // paper — that is a flower resting in the wrap — but the middle of it
      // must not.
      if (stem.headY > rimYAt(rim, stem.headX)) buried += 1;
    }
  }
}
check(
  "no flower's centre falls behind the collar rim",
  buried === 0,
  `${buried} of ${checked} heads buried`,
);

// Each category is placed in its own band, which is the whole point of having
// three of them: flowers pack a disc, filler threads through it, greenery sits
// outside and reaches higher. Assert the structure rather than the constants.
{
  let banded: BouquetState = { ...DEFAULT_STATE, seed: 4242 };
  for (const [itemId, count] of [
    ["rose-red", 6],
    ["lily-white", 3],
    ["babysbreath", 4],
    ["eucalyptus-silver", 3],
    ["fern-leatherleaf", 2],
  ] as Array<[string, number]>) {
    for (let i = 0; i < count; i += 1) banded = addStem(banded, itemId);
  }
  const l = computeLayout(CANVAS_WIDTH, CANVAS_HEIGHT, banded);
  const stems = placeStems(banded, l);
  const of = (category: string) => stems.filter((s) => s.item.category === category);
  const radii = (category: string) => of(category).map((s) => s.radiusPx);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  check(
    "greenery sits outside the flower mass",
    Math.min(...radii("green")) >= Math.max(...radii("focal")) * 0.85,
    `nearest green ${Math.min(...radii("green")).toFixed(0)}px vs furthest flower ${Math.max(
      ...radii("focal"),
    ).toFixed(0)}px`,
  );
  check(
    "greenery carries higher than the flowers",
    mean(of("green").map((s) => s.headY)) < mean(of("focal").map((s) => s.headY)),
  );
  check(
    "filler threads through the flowers rather than ringing them",
    Math.min(...radii("filler")) < Math.max(...radii("focal")),
  );
}

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

// --- sizing -----------------------------------------------------------------
check(
  "sizing comes from real millimetres",
  spriteWidthPx(180, 900, 1) === 405 && spriteWidthPx(75, 900, 1) === 168.75,
);
const sunflower = placeStems(addStem(DEFAULT_STATE, "sunflower"), layout)[0];
const rose = placeStems(addStem(DEFAULT_STATE, "rose-red"), layout)[0];
check(
  "a 180mm sunflower renders 2.4x a 75mm rose",
  Math.abs(sunflower.widthPx / rose.widthPx - 180 / 75) < 1e-9,
);

// --- purity -----------------------------------------------------------------
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
