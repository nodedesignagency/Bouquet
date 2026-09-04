/**
 * A minimal PNG reader, for alpha only.
 *
 * `derive-anchors` needs one thing from a sprite: which pixels are opaque.
 * Node already ships the hard part (zlib), so this decodes the container and
 * the scanline filters by hand rather than pulling an image library into the
 * project for a build script.
 *
 * Covers every colour type and bit depth in the base PNG spec, including
 * palettes with tRNS. Interlaced files are rejected with an explanation rather
 * than decoded wrongly.
 */

import { inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Samples per pixel, by PNG colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export class PngError extends Error {}

export interface AlphaMask {
  width: number;
  height: number;
  /** One byte per pixel, row-major. 0 is fully transparent. */
  alpha: Uint8Array;
}

interface Chunks {
  ihdr: Buffer;
  idat: Buffer;
  plte?: Buffer;
  trns?: Buffer;
}

function readChunks(buffer: Buffer): Chunks {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new PngError("Not a PNG file.");
  }

  let offset = 8;
  let ihdr: Buffer | undefined;
  let plte: Buffer | undefined;
  let trns: Buffer | undefined;
  const idatParts: Buffer[] = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") ihdr = data;
    else if (type === "PLTE") plte = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idatParts.push(data);
    else if (type === "IEND") break;

    offset += 12 + length;
  }

  if (!ihdr) throw new PngError("PNG has no header chunk.");
  if (idatParts.length === 0) throw new PngError("PNG has no image data.");

  return { ihdr, plte, trns, idat: Buffer.concat(idatParts) };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Reverses the per-scanline filters, in place, returning the raw sample bytes. */
function unfilter(raw: Buffer, height: number, bytesPerLine: number, bpp: number): Buffer {
  const out = Buffer.alloc(height * bytesPerLine);
  let inPos = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[inPos];
    inPos += 1;
    const line = y * bytesPerLine;
    const prev = line - bytesPerLine;

    for (let x = 0; x < bytesPerLine; x += 1) {
      const value = raw[inPos + x];
      const a = x >= bpp ? out[line + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= bpp && y > 0 ? out[prev + x - bpp] : 0;

      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + a;
          break;
        case 2:
          restored = value + b;
          break;
        case 3:
          restored = value + ((a + b) >> 1);
          break;
        case 4:
          restored = value + paeth(a, b, c);
          break;
        default:
          throw new PngError(`Unknown scanline filter ${filter} on row ${y}.`);
      }
      out[line + x] = restored & 0xff;
    }
    inPos += bytesPerLine;
  }

  return out;
}

/** Reads one sample from a scanline, for bit depths below 8. */
function readPacked(line: Buffer, offset: number, index: number, bitDepth: number): number {
  const perByte = 8 / bitDepth;
  const byte = line[offset + Math.floor(index / perByte)];
  const shift = 8 - bitDepth * ((index % perByte) + 1);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

/**
 * Decodes a PNG far enough to know how opaque every pixel is.
 */
export function decodeAlpha(buffer: Buffer): AlphaMask {
  const { ihdr, idat, plte, trns } = readChunks(buffer);

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];

  if (interlace !== 0) {
    throw new PngError("Interlaced PNGs are not supported — re-export without Adam7 interlacing.");
  }
  const channels = CHANNELS[colorType];
  if (!channels) throw new PngError(`Unsupported colour type ${colorType}.`);
  if (![1, 2, 4, 8, 16].includes(bitDepth)) {
    throw new PngError(`Unsupported bit depth ${bitDepth}.`);
  }

  const bitsPerPixel = channels * bitDepth;
  const bytesPerLine = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const samples = unfilter(inflateSync(idat), height, bytesPerLine, bpp);

  const alpha = new Uint8Array(width * height);
  const step = bitDepth === 16 ? 2 : 1;

  for (let y = 0; y < height; y += 1) {
    const line = y * bytesPerLine;

    for (let x = 0; x < width; x += 1) {
      let value = 255;

      if (colorType === 6 || colorType === 4) {
        // The alpha channel is the last sample of the pixel.
        const pixel = line + x * channels * step;
        value = samples[pixel + (channels - 1) * step];
      } else if (colorType === 3) {
        const index =
          bitDepth < 8
            ? readPacked(samples, line, x, bitDepth)
            : samples[line + x];
        // tRNS on a palette is a list of alphas; entries past its end are opaque.
        value = trns && index < trns.length ? trns[index] : 255;
        if (plte && index * 3 >= plte.length) {
          throw new PngError("Palette index out of range.");
        }
      } else if (trns) {
        // A single colour declared transparent, given at the file's bit depth.
        const pixel = line + x * channels * step;
        let matches = true;
        for (let c = 0; c < channels; c += 1) {
          const declared = trns.readUInt16BE(c * 2);
          const actual =
            bitDepth === 16
              ? samples.readUInt16BE(pixel + c * 2)
              : bitDepth === 8
                ? samples[pixel + c]
                : readPacked(samples, line, x * channels + c, bitDepth);
          if (actual !== declared) {
            matches = false;
            break;
          }
        }
        if (matches) value = 0;
      }

      alpha[y * width + x] = value;
    }
  }

  return { width, height, alpha };
}
