// Renders the extension icon (a pull-request glyph on a gradient tile) to PNGs.
// Run with `node scripts/icons.mjs`; output goes to public/icons.
import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync, crc32 } from "node:zlib";

const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling per axis

const STROKE = 0.062;
const RING_R = 0.1;
const NODES = [
  [0.3, 0.28],
  [0.3, 0.72],
  [0.7, 0.72],
];
const SEGMENTS = [
  [0.3, 0.28 + RING_R, 0.3, 0.72 - RING_R], // left vertical
  [0.7, 0.72 - RING_R, 0.7, 0.28], // right vertical
  [0.7, 0.28, 0.46, 0.28], // top horizontal
  [0.46, 0.28, 0.55, 0.19], // arrow head
  [0.46, 0.28, 0.55, 0.37],
];

function distSegment(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function distRoundedRect(px, py, margin, radius) {
  const half = 0.5 - margin;
  const qx = Math.abs(px - 0.5) - (half - radius);
  const qy = Math.abs(py - 0.5) - (half - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function inGlyph(px, py) {
  const half = STROKE / 2;
  for (const [cx, cy] of NODES) {
    if (Math.abs(Math.hypot(px - cx, py - cy) - RING_R) <= half) return true;
  }
  return SEGMENTS.some((s) => distSegment(px, py, s) <= half);
}

function mix(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

const TOP = [124, 92, 255];
const BOTTOM = [64, 120, 255];

function render(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let tile = 0;
      let glyph = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / size;
          const py = (y + (sy + 0.5) / SS) / size;
          if (distRoundedRect(px, py, 0.02, 0.22) <= 0) {
            tile++;
            if (inGlyph(px, py)) glyph++;
          }
        }
      }
      const n = SS * SS;
      const bg = mix(TOP, BOTTOM, (x + y) / (2 * size));
      const g = tile ? glyph / tile : 0;
      const rgb = mix(bg, [255, 255, 255], g);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = rgb[0];
      raw[o + 1] = rgb[1];
      raw[o + 2] = rgb[2];
      raw[o + 3] = Math.round((tile / n) * 255);
    }
  }
  return raw;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(render(size))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

await mkdir("public/icons", { recursive: true });
for (const size of SIZES) {
  await writeFile(`public/icons/icon-${size}.png`, png(size));
}
console.log(`wrote ${SIZES.length} icons`);
