/**
 * derive-anchors — works out where each sprite's stem was cut.
 *
 * The anchor is the point pinned to the tie point, so it has to be the bottom
 * of the stem rather than the middle of the image. For every PNG in
 * /public/assets this finds the lowest row containing any opaque pixel, takes
 * the horizontal centroid of that row (weighted by alpha, so a soft edge does
 * not drag the anchor sideways), and writes the result back into the catalog.
 *
 *   npm run derive-anchors
 *   npm run derive-anchors -- --dry-run
 *   npm run derive-anchors -- --threshold=32
 *
 * Anchors are stored in the source PNG's own pixel space, which is the only
 * thing they can meaningfully be measured in. Nothing downstream sizes anything
 * from those pixels: the renderer converts the anchor to a fraction of the
 * sprite and places it using the millimetre sizing rule.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { decodeAlpha, PngError } from "./lib/png";

const ROOT = resolve(__dirname, "..");
const ASSETS_DIR = join(ROOT, "public", "assets");
const CATALOG_PATH = join(ROOT, "data", "catalog.json");
const PUBLIC_PREFIX = "/assets/";

/** Alpha at or below this counts as transparent — enough to ignore stray fringing. */
const DEFAULT_THRESHOLD = 8;

interface Variant {
  src: string;
  anchor: [number, number];
  facing: string;
}

interface CatalogEntry {
  id: string;
  variants: Variant[];
  [key: string]: unknown;
}

interface Anchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The lowest opaque row, and where along it the mass sits.
 * Returns null for an image with nothing in it.
 */
export function findAnchor(
  alpha: Uint8Array,
  width: number,
  height: number,
  threshold: number,
): Anchor | null {
  for (let y = height - 1; y >= 0; y -= 1) {
    const row = y * width;
    let weight = 0;
    let weighted = 0;

    for (let x = 0; x < width; x += 1) {
      const a = alpha[row + x];
      if (a > threshold) {
        weight += a;
        weighted += a * x;
      }
    }

    if (weight > 0) {
      return { x: Math.round(weighted / weight), y, width, height };
    }
  }

  return null;
}

function parseArgs(argv: string[]) {
  const thresholdArg = argv.find((arg) => arg.startsWith("--threshold="));
  const threshold = thresholdArg ? Number(thresholdArg.split("=")[1]) : DEFAULT_THRESHOLD;

  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 254) {
    throw new Error("--threshold must be a number between 0 and 254.");
  }

  return { dryRun: argv.includes("--dry-run"), threshold };
}

function listPngs(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith(".png"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function main() {
  const { dryRun, threshold } = parseArgs(process.argv.slice(2));
  const files = listPngs(ASSETS_DIR);

  if (files.length === 0) {
    console.log(
      `No PNGs in ${relative(ROOT, ASSETS_DIR)}. Drop the sprites in there and run this again.`,
    );
    return;
  }

  const catalog: CatalogEntry[] = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));

  // Index the catalog by the src each variant claims, so a file can be matched
  // to the variant that expects it.
  const bySrc = new Map<string, { entry: CatalogEntry; variant: Variant }>();
  for (const entry of catalog) {
    for (const variant of entry.variants) {
      bySrc.set(variant.src, { entry, variant });
    }
  }

  let changed = 0;
  let unchanged = 0;
  const orphanFiles: string[] = [];
  const failures: string[] = [];

  for (const file of files) {
    const src = `${PUBLIC_PREFIX}${file}`;
    const target = bySrc.get(src);

    if (!target) {
      orphanFiles.push(file);
      continue;
    }

    let anchor: Anchor | null;
    try {
      const { width, height, alpha } = decodeAlpha(readFileSync(join(ASSETS_DIR, file)));
      anchor = findAnchor(alpha, width, height, threshold);
    } catch (error) {
      failures.push(`${file}: ${error instanceof PngError ? error.message : String(error)}`);
      continue;
    }

    if (!anchor) {
      failures.push(`${file}: every pixel is transparent.`);
      continue;
    }

    const [oldX, oldY] = target.variant.anchor;
    const moved = oldX !== anchor.x || oldY !== anchor.y;
    target.variant.anchor = [anchor.x, anchor.y];

    if (moved) changed += 1;
    else unchanged += 1;

    console.log(
      `  ${moved ? "→" : "·"} ${file.padEnd(38)} anchor [${anchor.x}, ${anchor.y}]` +
        ` of ${anchor.width}×${anchor.height}` +
        (moved ? `  (was [${oldX}, ${oldY}])` : ""),
    );
  }

  // Variants the catalog names but no file provides. Worth saying out loud:
  // these are the sprites still to be drawn.
  const missing = [...bySrc.keys()]
    .filter((src) => !files.includes(src.slice(PUBLIC_PREFIX.length)))
    .sort();

  if (!dryRun && changed > 0) {
    writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  }

  console.log("");
  console.log(`  ${changed} anchor(s) updated, ${unchanged} already correct`);
  if (dryRun && changed > 0) console.log("  --dry-run: catalog.json was not written");
  if (orphanFiles.length > 0) {
    console.log(`  ${orphanFiles.length} file(s) no catalog variant asks for:`);
    for (const file of orphanFiles) console.log(`    ${file}`);
  }
  if (missing.length > 0) {
    console.log(`  ${missing.length} variant(s) still waiting on a file:`);
    for (const src of missing) console.log(`    ${src}`);
  }
  if (failures.length > 0) {
    console.log(`  ${failures.length} file(s) could not be read:`);
    for (const failure of failures) console.log(`    ${failure}`);
    process.exitCode = 1;
  }
  console.log("");
}

if (require.main === module) {
  main();
}
