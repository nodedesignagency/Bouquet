/**
 * Deterministic randomness.
 *
 * `Math.random()` must never appear anywhere in the render path. Every jittered
 * value is instead derived from the bouquet's single `seed` plus a stable
 * coordinate (the stem's spiral ordinal and a channel name), so a value can be
 * recomputed from scratch at any time without keeping RNG state around.
 *
 * That matters more than it sounds: because each value is addressed rather than
 * drawn from a stream, removing stem #3 does not shuffle the jitter of every
 * stem after it. Only stems whose ordinal actually changed move.
 */

/** FNV-1a over a string, mixed into a 32-bit seed. */
function hashString(str: string, seed: number): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Integer avalanche (splitmix32 finaliser). Turns a counter into white noise. */
function mix32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * A pure, addressable random value in [0, 1).
 *
 * @param seed    the bouquet seed
 * @param n       stable coordinate (usually the stem's spiral ordinal)
 * @param channel names what is being jittered, e.g. "angle" or "radius"
 * @param sub     optional second coordinate, e.g. a floret index in a cluster
 */
export function rand(seed: number, n: number, channel: string, sub = 0): number {
  const base = hashString(channel, seed);
  const mixed = mix32(base ^ Math.imul(n + 1, 0x9e3779b9) ^ Math.imul(sub + 1, 0x85ebca6b));
  return mixed / 4294967296;
}

/** A pure random value in [-1, 1). */
export function randSigned(seed: number, n: number, channel: string, sub = 0): number {
  return rand(seed, n, channel, sub) * 2 - 1;
}

/** A pure random value in [min, max). */
export function randRange(
  seed: number,
  n: number,
  channel: string,
  min: number,
  max: number,
  sub = 0,
): number {
  return min + rand(seed, n, channel, sub) * (max - min);
}

/** A pure coin flip that is true with probability `p`. */
export function randChance(
  seed: number,
  n: number,
  channel: string,
  p: number,
  sub = 0,
): boolean {
  return rand(seed, n, channel, sub) < p;
}

/**
 * A fresh seed for the "shuffle" button. This is the one place a
 * non-deterministic number is allowed, because it produces a NEW state rather
 * than rendering an existing one. Rendering that state stays pure.
 */
export function makeSeed(): number {
  return Math.floor(Math.random() * 0xffff_ffff) >>> 0;
}
