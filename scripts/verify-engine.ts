/**
 * Engine checks, run with `npm run verify:engine`.
 *
 * The determinism guarantee ("same seed = same bouquet, always") is the kind of
 * property that quietly breaks the moment someone reaches for `Math.random`, so
 * it is worth asserting rather than trusting.
 */

import { computeLayout, placeStems, ringForIndex, scaleForRing, spriteWidthPx } from "../lib/engine";
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
check(
  "focals take the middle of the spiral",
  placed[0]?.item.category === "focal" && placed[placed.length - 1]?.item.category !== "focal",
);
check(
  "every head sits above the tie point",
  placed.every((s) => s.headY < layout.tieY),
);

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
