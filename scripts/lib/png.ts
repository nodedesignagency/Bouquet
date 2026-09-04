/**
 * A minimal PNG reader and writer.
 *
 * The build scripts need two things from a sprite: which pixels are opaque, and
 * the pixels themselves so they can be cropped. Node already ships the hard part
 * (zlib), so this decodes the container and the scanline filters by hand rather
 * than pulling an image library into the project for two build scripts.
 *
 * Reading covers every colour type and bit depth in the base PNG spec, including
 * palettes with tRNS. Interlaced files are rejected with an explanation rather
 * than decoded wrongly. Writing emits 8-bit RGBA, which is all a sprite needs.
 */

import { deflateSync, inflateSync } from "node:zlib";

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

export interface Bitmap {
  width: number;
  height: number;
  /** Four bytes per pixel, row-major, non-premultiplied. */
  rgba: Uint8Array;
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

/**
 * Decodes a PNG to 8-bit RGBA.
 *
 * Colour is read alongside alpha so a sprite can be cropped and written back
 * out. 16-bit samples are taken from their high byte, which is all the sprite
 * pipeline needs.
 */
export function decodeRgba(buffer: Buffer): Bitmap {
  const { ihdr, idat, plte, trns } = readChunks(buffer);

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];

  if (ihdr[12] !== 0) {
    throw new PngError("Interlaced PNGs are not supported — re-export without Adam7 interlacing.");
  }
  const channels = CHANNELS[colorType];
  if (!channels) throw new PngError(`Unsupported colour type ${colorType}.`);

  const bitsPerPixel = channels * bitDepth;
  const bytesPerLine = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const samples = unfilter(inflateSync(idat), height, bytesPerLine, bpp);
  const { alpha } = decodeAlpha(buffer);

  const rgba = new Uint8Array(width * height * 4);
  const step = bitDepth === 16 ? 2 : 1;
  const scale = bitDepth < 8 ? 255 / ((1 << bitDepth) - 1) : 1;

  for (let y = 0; y < height; y += 1) {
    const line = y * bytesPerLine;
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4;
      let r: number;
      let g: number;
      let b: number;

      if (colorType === 3) {
        const index = bitDepth < 8 ? readPacked(samples, line, x, bitDepth) : samples[line + x];
        if (!plte) throw new PngError("Paletted PNG has no palette.");
        r = plte[index * 3];
        g = plte[index * 3 + 1];
        b = plte[index * 3 + 2];
      } else if (colorType === 0 || colorType === 4) {
        const grey =
          bitDepth < 8
            ? Math.round(readPacked(samples, line, x * channels, bitDepth) * scale)
            : samples[line + x * channels * step];
        r = grey;
        g = grey;
        b = grey;
      } else {
        const pixel = line + x * channels * step;
        r = samples[pixel];
        g = samples[pixel + step];
        b = samples[pixel + 2 * step];
      }

      rgba[out] = r;
      rgba[out + 1] = g;
      rgba[out + 2] = b;
      rgba[out + 3] = alpha[y * width + x];
    }
  }

  void trns;
  return { width, height, rgba };
}

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
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

/**
 * Writes an 8-bit RGBA PNG.
 *
 * Each scanline is offered to all five filters and the one with the smallest
 * sum of absolute differences wins — the heuristic libpng itself uses. On these
 * sprites it roughly halves the file against writing every line unfiltered.
 */
export function encodeRgba({ width, height, rgba }: Bitmap): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  const candidates = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];

  for (let y = 0; y < height; y += 1) {
    const line = y * stride;
    const prev = line - stride;

    for (let x = 0; x < stride; x += 1) {
      const v = rgba[line + x];
      const a = x >= 4 ? rgba[line + x - 4] : 0;
      const b = y > 0 ? rgba[prev + x] : 0;
      const c = x >= 4 && y > 0 ? rgba[prev + x - 4] : 0;
      candidates[0][x] = v;
      candidates[1][x] = (v - a) & 0xff;
      candidates[2][x] = (v - b) & 0xff;
      candidates[3][x] = (v - ((a + b) >> 1)) & 0xff;
      candidates[4][x] = (v - paeth(a, b, c)) & 0xff;
    }

    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f += 1) {
      let score = 0;
      for (let x = 0; x < stride; x += 1) {
        const s = candidates[f][x];
        score += s < 128 ? s : 256 - s;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }

    const out = y * (stride + 1);
    raw[out] = best;
    candidates[best].copy(raw, out + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
