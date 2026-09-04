/**
 * Checks the PNG reader and the anchor maths, run with `npm run verify:anchors`.
 *
 * There are no sprites in /public/assets yet, so this builds PNGs with known
 * shapes — a stem whose cut end is at a known pixel — and asserts that the
 * anchor comes back at exactly that point. Whoever drops the real artwork in
 * can run this first and know the reader is not the problem.
 */

import { deflateSync } from "node:zlib";

import { decodeAlpha } from "./lib/png";
import { findAnchor } from "./derive-anchors";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/* -------------------------------------------------------------------------- */
/* A minimal PNG writer, so the tests have something to read                    */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Writes an 8-bit RGBA PNG, one filter-0 scanline per row. */
function writeRgba(width: number, height: number, alphaAt: (x: number, y: number) => number) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    raw[pos] = 0;
    pos += 1;
    for (let x = 0; x < width; x += 1) {
      raw[pos] = 200;
      raw[pos + 1] = 60;
      raw[pos + 2] = 90;
      raw[pos + 3] = alphaAt(x, y);
      pos += 4;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Writes an 8-bit paletted PNG whose first palette entry is transparent. */
function writePalette(width: number, height: number, opaqueAt: (x: number, y: number) => boolean) {
  const raw = Buffer.alloc(height * (1 + width));
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    raw[pos] = 0;
    pos += 1;
    for (let x = 0; x < width; x += 1) {
      raw[pos] = opaqueAt(x, y) ? 1 : 0;
      pos += 1;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3; // palette
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", Buffer.from([0, 0, 0, 90, 40, 60])),
    chunk("tRNS", Buffer.from([0, 255])),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                       */
/* -------------------------------------------------------------------------- */

console.log("\npng reader");

// A flower on a stem: a blob up top, a 3px stem running down to row 79,
// with its cut end centred on x = 40. Odd width, so the centroid is a whole
// pixel and the check is not really a check of how .5 rounds.
const STEM_X = 40;
const CUT_ROW = 79;
const sprite = writeRgba(100, 100, (x, y) => {
  const onStem = y >= 30 && y <= CUT_ROW && Math.abs(x - STEM_X) <= 1;
  const inHead = Math.hypot(x - 50, y - 18) < 15;
  return onStem || inHead ? 255 : 0;
});

const decoded = decodeAlpha(sprite);
check("reads the image size", decoded.width === 100 && decoded.height === 100);
check("reads alpha", decoded.alpha[18 * 100 + 50] === 255 && decoded.alpha[0] === 0);

const anchor = findAnchor(decoded.alpha, decoded.width, decoded.height, 8);
check(
  "anchor lands on the cut end of the stem",
  anchor?.y === CUT_ROW && anchor?.x === STEM_X,
  `got ${JSON.stringify(anchor)}, expected [${STEM_X}, ${CUT_ROW}]`,
);

// Rows below the stem must be ignored even when they carry faint fringing.
const fringed = writeRgba(100, 100, (x, y) => {
  if (y >= 30 && y <= CUT_ROW && Math.abs(x - STEM_X) <= 1) return 255;
  if (y > CUT_ROW) return 4; // below the threshold
  return 0;
});
const fringedAnchor = (() => {
  const d = decodeAlpha(fringed);
  return findAnchor(d.alpha, d.width, d.height, 8);
})();
check(
  "faint fringing below the stem is ignored",
  fringedAnchor?.y === CUT_ROW,
  `got row ${fringedAnchor?.y}`,
);

// A soft edge should not drag the anchor sideways: alpha weighting keeps it
// on the centre of mass, not the middle of the row's extent.
const soft = writeRgba(21, 10, (x, y) => {
  if (y !== 9) return 0;
  if (x === 10) return 255;
  if (x === 9 || x === 11) return 40;
  return 0;
});
const softAnchor = (() => {
  const d = decodeAlpha(soft);
  return findAnchor(d.alpha, d.width, d.height, 8);
})();
check("a soft edge does not pull the anchor off centre", softAnchor?.x === 10);

// Palette + tRNS is the other format sprite exporters commonly produce.
const paletted = writePalette(60, 40, (x, y) => y === 39 && x >= 20 && x <= 24);
const palAnchor = (() => {
  const d = decodeAlpha(paletted);
  return findAnchor(d.alpha, d.width, d.height, 8);
})();
check(
  "paletted PNGs with tRNS decode",
  palAnchor?.x === 22 && palAnchor?.y === 39,
  `got ${JSON.stringify(palAnchor)}`,
);

// An empty sprite is a problem to report, not a crash.
const blank = decodeAlpha(writeRgba(8, 8, () => 0));
check("a fully transparent sprite yields no anchor", findAnchor(blank.alpha, 8, 8, 8) === null);

console.log(
  failures === 0 ? "\nall anchor checks passed\n" : `\n${failures} anchor check(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
