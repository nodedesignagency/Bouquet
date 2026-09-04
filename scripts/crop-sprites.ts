/**
 * crop-sprites — trims the empty frame around each sprite.
 *
 * The sizing rule maps `realWidthMm` onto the sprite, so any transparent margin
 * baked into the artwork is width the flower does not get: the cutouts arrived
 * with 21-56% of their frame empty, which would have rendered a 75mm rose at
 * 33mm. Cropping to the opaque bounding box makes "the sprite is realWidthMm
 * wide" true of the flower rather than of its packaging.
 *
 *   npm run crop-sprites
 *   npm run crop-sprites -- --dry-run
 *
 * Safe to re-run: a sprite that is already tight against its content is left
 * alone. Run derive-anchors afterwards, since cropping moves every anchor.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { decodeRgba, encodeRgba, PngError } from "./lib/png";

const ROOT = resolve(__dirname, "..");
const ASSETS_DIR = join(ROOT, "public", "assets");

/**
 * Any pixel that is not perfectly transparent is content. Cropping is the one
 * place to be maximally cautious — a threshold here would shave the softest
 * edge off every petal, permanently.
 */
const KEEP_ABOVE = 0;

function contentBox(rgba: Uint8Array, width: number, height: number) {
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] > KEEP_ABOVE) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  return maxX < 0 ? null : { minX, maxX, minY, maxY };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const files = readdirSync(ASSETS_DIR)
    .filter((n) => n.toLowerCase().endsWith(".png"))
    .sort();

  if (files.length === 0) {
    console.log(`No PNGs in ${relative(ROOT, ASSETS_DIR)}.`);
    return;
  }

  let cropped = 0;
  let already = 0;
  let before = 0;
  let after = 0;

  for (const file of files) {
    const path = join(ASSETS_DIR, file);
    let image;
    try {
      image = decodeRgba(readFileSync(path));
    } catch (error) {
      console.log(`  !  ${file}: ${error instanceof PngError ? error.message : String(error)}`);
      process.exitCode = 1;
      continue;
    }

    const box = contentBox(image.rgba, image.width, image.height);
    if (!box) {
      console.log(`  !  ${file}: every pixel is transparent.`);
      process.exitCode = 1;
      continue;
    }

    const w = box.maxX - box.minX + 1;
    const h = box.maxY - box.minY + 1;
    const oldSize = statSync(path).size;
    before += oldSize;

    if (w === image.width && h === image.height) {
      already += 1;
      after += oldSize;
      console.log(`  ·  ${file.padEnd(34)} already tight at ${w}×${h}`);
      continue;
    }

    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      const from = ((box.minY + y) * image.width + box.minX) * 4;
      out.set(image.rgba.subarray(from, from + w * 4), y * w * 4);
    }

    const encoded = encodeRgba({ width: w, height: h, rgba: out });
    if (!dryRun) writeFileSync(path, encoded);
    cropped += 1;
    after += encoded.length;

    const fill = ((w * h) / (image.width * image.height)) * 100;
    console.log(
      `  →  ${file.padEnd(34)} ${image.width}×${image.height} → ${w}×${h}` +
        `  (${fill.toFixed(0)}% of the frame kept, ${(oldSize / 1024).toFixed(0)}` +
        ` → ${(encoded.length / 1024).toFixed(0)} kB)`,
    );
  }

  console.log("");
  console.log(`  ${cropped} cropped, ${already} already tight`);
  console.log(`  ${(before / 1024 / 1024).toFixed(1)} MB → ${(after / 1024 / 1024).toFixed(1)} MB`);
  if (dryRun && cropped > 0) console.log("  --dry-run: nothing was written");
  else if (cropped > 0) console.log("  run derive-anchors next — cropping moved every anchor");
  console.log("");
}

main();
