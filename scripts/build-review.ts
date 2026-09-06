/**
 * build-review — a contact sheet for the sprite set.
 *
 * Writes review.html at the repo root: every catalog variant on a transparency
 * checkerboard with its derived anchor drawn on top, alongside the numbers that
 * decide how it will be placed. Regenerate it after any run of derive-anchors.
 *
 *   npm run review
 *
 * The page links the PNGs relatively rather than inlining them, so it stays a
 * few kilobytes and opens straight from disk.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { decodeAlpha } from "./lib/png";
import { CANVAS_WIDTH_MM } from "../lib/engine";

const ROOT = resolve(__dirname, "..");
const CATALOG_PATH = join(ROOT, "data", "catalog.json");
const OUT_PATH = join(ROOT, "review.html");

/** The canvas width the app renders at, so on-screen sizes here match the app. */
const CANVAS_WIDTH_PX = 900;

interface Variant {
  src: string;
  anchor: [number, number];
  size: [number, number];
  headY: number;
  widthMm?: number;
  facing: string;
}

interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  colorway: string;
  pricePerStem: number;
  realWidthMm: number;
  bloomWidthMm: number;
  stemLengthMm: number;
  headColor: string;
  variants: Variant[];
}

interface Measured {
  variant: Variant;
  ok: boolean;
  problem?: string;
  width: number;
  height: number;
  /** Bounding box of the opaque pixels. */
  box: { minX: number; maxX: number; minY: number; maxY: number };
}

function measure(variant: Variant): Measured {
  const file = join(ROOT, "public", variant.src.replace(/^\//, ""));
  const empty = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let buffer: Buffer;
  try {
    buffer = readFileSync(file);
  } catch {
    return { variant, ok: false, problem: "no file", width: 0, height: 0, box: empty };
  }

  try {
    const { width, height, alpha } = decodeAlpha(buffer);
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (alpha[y * width + x] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) {
      return { variant, ok: false, problem: "fully transparent", width, height, box: empty };
    }
    return { variant, ok: true, width, height, box: { minX, maxX, minY, maxY } };
  } catch (error) {
    return {
      variant,
      ok: false,
      problem: error instanceof Error ? error.message : String(error),
      width: 0,
      height: 0,
      box: empty,
    };
  }
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function card(entry: CatalogEntry, m: Measured): string {
  const { variant } = m;
  const name = variant.src.split("/").pop() ?? variant.src;

  if (!m.ok) {
    return `<figure class="card missing">
        <div class="tile empty"><span>${escapeHtml(m.problem ?? "unreadable")}</span></div>
        <figcaption><b>${escapeHtml(name)}</b><span class="facing">${escapeHtml(variant.facing)}</span></figcaption>
      </figure>`;
  }

  const [ax, ay] = variant.anchor;
  const left = ((ax / m.width) * 100).toFixed(3);
  const top = ((ay / m.height) * 100).toFixed(3);

  const boxW = m.box.maxX - m.box.minX + 1;
  const boxH = m.box.maxY - m.box.minY + 1;
  // Should be 100%: crop-sprites trims the frame to the content so that
  // realWidthMm lands on the flower and not on its packaging. Anything less
  // means a sprite has been added without being cropped.
  const fill = (boxW / m.width) * 100;
  // A pose may be a different real size from its item — a bud is not as wide as
  // the flower it becomes.
  const widthMm = variant.widthMm ?? entry.realWidthMm;
  const onScreenPx = (widthMm / CANVAS_WIDTH_MM) * CANVAS_WIDTH_PX;
  const onScreenH = onScreenPx * (m.height / m.width);

  // Where the anchor sits inside the frame, as a fraction — this, not the pixel
  // pair, is what the renderer uses.
  const fx = (ax / m.width).toFixed(4);
  const fy = (ay / m.height).toFixed(4);

  // The distance the renderer has to work with: cut end up to the bloom.
  const stemMm = ((ay - variant.headY) / m.width) * widthMm;
  const headTop = ((variant.headY / m.height) * 100).toFixed(3);
  void boxH;

  return `<figure class="card">
      <div class="tile">
        <img src="public${escapeHtml(variant.src)}" alt="${escapeHtml(name)}" loading="lazy">
        <div class="box" style="left:${((m.box.minX / m.width) * 100).toFixed(3)}%;top:${((m.box.minY / m.height) * 100).toFixed(3)}%;width:${((boxW / m.width) * 100).toFixed(3)}%;height:${((boxH / m.height) * 100).toFixed(3)}%"></div>
        <div class="hair-head" style="top:${headTop}%"></div>
        <div class="hair-h" style="top:${top}%"></div>
        <div class="hair-v" style="left:${left}%"></div>
        <div class="dot" style="left:${left}%;top:${top}%"></div>
      </div>
      <figcaption>
        <b>${escapeHtml(name)}</b><span class="facing">${escapeHtml(variant.facing)}</span>
        <dl>
          <dt>anchor</dt><dd>${ax}, ${ay} <span class="fine">(${fx}, ${fy})</span></dd>
          <dt>head row</dt><dd>${variant.headY} <span class="fine">→ ${stemMm.toFixed(0)} mm of stem</span></dd>
          <dt>image</dt><dd>${m.width} × ${m.height}<span class="${fill < 99.5 ? "warn" : "fine"}"> ${fill.toFixed(0)}% content — ${fill < 99.5 ? "needs cropping" : "cropped"}</span></dd>
          <dt>drawn</dt><dd>${onScreenPx.toFixed(0)} × ${onScreenH.toFixed(0)} px at ${widthMm} mm${
            variant.widthMm ? '<span class="warn"> (pose override)</span>' : ""
          }</dd>
        </dl>
      </figcaption>
    </figure>`;
}

function main() {
  const catalog: CatalogEntry[] = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
  const measured = catalog.map((entry) => ({ entry, variants: entry.variants.map(measure) }));

  const total = measured.reduce((n, g) => n + g.variants.length, 0);
  const good = measured.reduce((n, g) => n + g.variants.filter((v) => v.ok).length, 0);
  const widest = Math.max(...catalog.map((e) => e.realWidthMm));

  const sections = measured
    .map(
      ({ entry, variants }) => `<section>
      <header class="item">
        <h2>${escapeHtml(entry.name)}</h2>
        <dl class="specs">
          <dt>id</dt><dd>${escapeHtml(entry.id)}</dd>
          <dt>width</dt><dd>${entry.realWidthMm} mm</dd>
          <dt>bloom</dt><dd>${entry.bloomWidthMm} mm</dd>
          <dt>stem</dt><dd>${entry.stemLengthMm} mm visible</dd>
          <dt>price</dt><dd>₹${entry.pricePerStem}</dd>
        </dl>
      </header>
      <div class="grid">${variants.map((m) => card(entry, m)).join("")}</div>
    </section>`,
    )
    .join("");

  // Every flower at its true size relative to every other one — the same ratio
  // the canvas uses, and the fastest way to spot a wrong realWidthMm.
  const scaleStrip = catalog
    .map((entry) => {
      const first = entry.variants[0];
      return `<div class="scale-item" style="width:${((entry.realWidthMm / widest) * 100).toFixed(2)}%">
        <img src="public${escapeHtml(first.src)}" alt="" loading="lazy">
        <span>${escapeHtml(entry.name)}<br>${entry.realWidthMm} mm</span>
      </div>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sprite review — Bouquet</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#141110; color:#f2ebe4; font:14px/1.5 ui-sans-serif,system-ui,sans-serif; }
  .wrap { max-width:1500px; margin:0 auto; padding:32px 24px 80px; }
  h1 { font:600 30px/1.2 Georgia,serif; margin:0 0 6px; }
  .lede { color:#a2948a; margin:0 0 28px; max-width:62ch; }
  .tally { font-family:ui-monospace,monospace; font-size:12px; color:#93a983; }
  section { margin:34px 0 0; border-top:1px solid #2c2521; padding-top:16px; }
  .item { display:flex; flex-wrap:wrap; align-items:baseline; gap:18px; margin-bottom:14px; }
  h2 { font:600 19px/1 Georgia,serif; margin:0; }
  dl { margin:0; display:flex; flex-wrap:wrap; gap:2px 10px; font-family:ui-monospace,monospace; font-size:11px; }
  dl dt { color:#6b5f56; }
  dl dd { margin:0 8px 0 0; color:#d8cdc3; }
  .specs dd { color:#93a983; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(215px,1fr)); gap:12px; }
  .card { margin:0; border:1px solid #2c2521; border-radius:8px; overflow:hidden; background:#1b1715; }
  .card.missing { border-color:#5d3a2a; }
  .tile { position:relative; line-height:0;
    background-color:#2b2b2b;
    background-image:linear-gradient(45deg,#3a3a3a 25%,transparent 25%),linear-gradient(-45deg,#3a3a3a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#3a3a3a 75%),linear-gradient(-45deg,transparent 75%,#3a3a3a 75%);
    background-size:14px 14px; background-position:0 0,0 7px,7px -7px,-7px 0; }
  .tile img { width:100%; display:block; }
  .tile.empty { display:flex; align-items:center; justify-content:center; aspect-ratio:2/3; }
  .tile.empty span { font:11px ui-monospace,monospace; color:#d98a5a; }
  .box { position:absolute; border:1px dashed #93a98366; }
  .hair-h { position:absolute; left:0; right:0; border-top:1px dashed #d7a05a99; }
  .hair-head { position:absolute; left:0; right:0; border-top:1px dashed #93a983aa; }
  .hair-v { position:absolute; top:0; bottom:0; border-left:1px dashed #d7a05a55; }
  .dot { position:absolute; width:15px; height:15px; margin:-8px 0 0 -8px; border:2px solid #d7a05a; border-radius:50%; }
  figcaption { padding:8px 10px 10px; }
  figcaption b { font-weight:500; font-size:12px; }
  .facing { font:10px ui-monospace,monospace; color:#141110; background:#93a983; border-radius:3px; padding:1px 5px; margin-left:6px; vertical-align:1px; }
  figcaption dl { margin-top:7px; display:grid; grid-template-columns:auto 1fr; gap:1px 8px; }
  .warn { color:#d98a5a; }
  .fine { color:#6b5f56; }
  .scale { display:flex; align-items:flex-end; gap:14px; margin:10px 0 0; }
  .scale-item { text-align:center; }
  .scale-item img { width:100%; display:block; }
  .scale-item span { font:10px ui-monospace,monospace; color:#a2948a; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Sprite review</h1>
  <p class="lede">Every catalog variant with the measurements <code>derive-anchors</code> found. The gold crosshair is the anchor — the cut end of the stem, pinned to the tie point. The sage line is the middle of the bloom, which is what the renderer slides onto the spiral. Generated from <code>data/catalog.json</code>.</p>
  <p class="tally">${good}/${total} variants have artwork · generated ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC</p>

  <section>
    <header class="item"><h2>To scale</h2><dl class="specs"><dt>canvas</dt><dd>${CANVAS_WIDTH_MM} mm across</dd></dl></header>
    <div class="scale">${scaleStrip}</div>
  </section>

  ${sections}
</div>
</body>
</html>
`;

  writeFileSync(OUT_PATH, html);
  console.log(`  review.html written — ${good}/${total} variants have artwork`);
}

main();
