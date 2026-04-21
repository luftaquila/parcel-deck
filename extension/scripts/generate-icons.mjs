#!/usr/bin/env node
/**
 * PNG generator for the extension icons (pure Node, no external deps).
 *
 * The mark is a rounded-square background with a centered parcel-box
 * glyph (vertical seam on top, horizontal tape in the middle).
 * Draw at 4x supersampling, then box-downsample for software antialiasing.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "src", "public", "icon");

const SS = 4; // supersample factor

// ─── PNG writer ──────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const bytesPerRow = 1 + width * 4;
  const raw = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    raw[y * bytesPerRow] = 0;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = y * bytesPerRow + 1 + x * 4;
      raw[dst] = rgba[src];
      raw[dst + 1] = rgba[src + 1];
      raw[dst + 2] = rgba[src + 2];
      raw[dst + 3] = rgba[src + 3];
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// High-resolution rasterizer.

/**
 * Draw onto a hard mask at SSx resolution, then box-filter downsample to
 * the target size. This gives rounded corners and curves soft edges.
 */
function drawIcon(size) {
  const BG = [45, 60, 218, 255];
  const FG = [255, 255, 255, 255];
  const hi = size * SS;
  const cornerRadius = size * 0.22 * SS;
  const hiPixels = new Uint8Array(hi * hi * 4);

  function setHiPixel(x, y, c) {
    if (x < 0 || y < 0 || x >= hi || y >= hi) return;
    const o = (y * hi + x) * 4;
    hiPixels[o] = c[0];
    hiPixels[o + 1] = c[1];
    hiPixels[o + 2] = c[2];
    hiPixels[o + 3] = c[3];
  }

  function insideRounded(x, y) {
    if (x < cornerRadius && y < cornerRadius) {
      const dx = cornerRadius - x;
      const dy = cornerRadius - y;
      return dx * dx + dy * dy <= cornerRadius * cornerRadius;
    }
    if (x >= hi - cornerRadius && y < cornerRadius) {
      const dx = x - (hi - cornerRadius);
      const dy = cornerRadius - y;
      return dx * dx + dy * dy <= cornerRadius * cornerRadius;
    }
    if (x < cornerRadius && y >= hi - cornerRadius) {
      const dx = cornerRadius - x;
      const dy = y - (hi - cornerRadius);
      return dx * dx + dy * dy <= cornerRadius * cornerRadius;
    }
    if (x >= hi - cornerRadius && y >= hi - cornerRadius) {
      const dx = x - (hi - cornerRadius);
      const dy = y - (hi - cornerRadius);
      return dx * dx + dy * dy <= cornerRadius * cornerRadius;
    }
    return true;
  }

  // 1. Background (rounded square)
  for (let y = 0; y < hi; y++) {
    for (let x = 0; x < hi; x++) {
      if (insideRounded(x, y)) setHiPixel(x, y, BG);
    }
  }

  // 2. Parcel box body: centered white rectangle
  const boxPadX = hi * 0.22;
  const boxPadY = hi * 0.22;
  const boxX1 = boxPadX;
  const boxY1 = boxPadY;
  const boxX2 = hi - boxPadX;
  const boxY2 = hi - boxPadY;
  for (let y = Math.floor(boxY1); y < Math.ceil(boxY2); y++) {
    for (let x = Math.floor(boxX1); x < Math.ceil(boxX2); x++) {
      setHiPixel(x, y, FG);
    }
  }

  // 3. Horizontal tape stripe in the background color
  const tapeH = hi * 0.11;
  const tapeYMid = (boxY1 + boxY2) / 2;
  const tapeY1 = tapeYMid - tapeH / 2;
  const tapeY2 = tapeYMid + tapeH / 2;
  for (let y = Math.floor(tapeY1); y < Math.ceil(tapeY2); y++) {
    for (let x = Math.floor(boxX1); x < Math.ceil(boxX2); x++) {
      setHiPixel(x, y, BG);
    }
  }

  // 4. Vertical seam from the top edge of the box down to the tape
  const seamW = hi * 0.08;
  const seamXMid = (boxX1 + boxX2) / 2;
  const seamX1 = seamXMid - seamW / 2;
  const seamX2 = seamXMid + seamW / 2;
  for (let y = Math.floor(boxY1); y < Math.ceil(tapeY1); y++) {
    for (let x = Math.floor(seamX1); x < Math.ceil(seamX2); x++) {
      setHiPixel(x, y, BG);
    }
  }

  // 5. Downsample by averaging SSxSS blocks
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const o = ((y * SS + sy) * hi + (x * SS + sx)) * 4;
          r += hiPixels[o];
          g += hiPixels[o + 1];
          b += hiPixels[o + 2];
          a += hiPixels[o + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }

  return encodePng(size, size, out);
}

// Execute.

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 48, 128]) {
  const png = drawIcon(size);
  writeFileSync(join(OUT_DIR, `${size}.png`), png);
  console.log(`wrote ${size}.png (${png.length} bytes)`);
}
