import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "../public/icon");
mkdirSync(outDir, { recursive: true });

// Precompute CRC32 table for valid PNG chunks.
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function buildBrandPng(size) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  const pine = [20, 54, 43, 255];
  const paper = [246, 243, 236, 255];
  const copper = [184, 106, 58, 255];
  const radius = size * 0.22;

  const distRoundedRect = (x, y) => {
    const cx = size / 2;
    const cy = size / 2;
    const half = size / 2 - 0.5;
    const dx = Math.max(Math.abs(x + 0.5 - cx) - (half - radius), 0);
    const dy = Math.max(Math.abs(y + 0.5 - cy) - (half - radius), 0);
    return Math.hypot(dx, dy) - radius;
  };

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < size; x += 1) {
      const px = rowStart + 1 + x * 4;
      const d = distRoundedRect(x, y);
      let rgba = [0, 0, 0, 0];

      if (d <= 0) {
        rgba = [...pine];
        const nx = (x + 0.5) / size;
        const ny = (y + 0.5) / size;
        // Minimal V mark in paper tone + copper accent dot
        const onLeftArm = nx >= 0.25 && nx <= 0.52 && Math.abs(ny - (0.3 + (nx - 0.28) * 1.75)) < 0.085;
        const onRightArm = nx >= 0.48 && nx <= 0.75 && Math.abs(ny - (0.72 - (nx - 0.5) * 1.75)) < 0.085;
        const inCopperDot = Math.hypot(nx - 0.74, ny - 0.28) <= 0.09;
        if (inCopperDot) {
          rgba = copper;
        } else if (onLeftArm || onRightArm) {
          rgba = paper;
        }
      }

      raw[px] = rgba[0];
      raw[px + 1] = rgba[1];
      raw[px + 2] = rgba[2];
      raw[px + 3] = rgba[3];
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [16, 48, 128]) {
  writeFileSync(resolve(outDir, `${size}.png`), buildBrandPng(size));
}

