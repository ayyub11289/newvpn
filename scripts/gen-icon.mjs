/**
 * Generates a crisp multi-resolution Windows .ico (256, 64, 48, 32, 16)
 * featuring the VEIL VPN optical glass shield emblem.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, '../resources/icon.ico');
fs.mkdirSync(path.dirname(outPath), { recursive: true });

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - ax, py - ay);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - bx, py - by);
  const b = c1 / c2;
  return Math.hypot(px - (ax + b * vx), py - (ay + b * vy));
}

function renderIconPng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));

  for (let y = 0; y < size; y++) {
    const rowOff = y * (size * 4 + 1);
    raw[rowOff] = 0;
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size; // 0..1
      const ny = (y + 0.5) / size;
      const cx = nx - 0.5;
      const cy = ny - 0.5;

      // Squircle superellipse mask: |x|^4.2 + |y|^4.2 <= r^4.2
      const half = 0.46;
      const sq = Math.pow(Math.abs(cx / half), 4.4) + Math.pow(Math.abs(cy / half), 4.4);
      const px = rowOff + 1 + x * 4;

      if (sq > 1.04) {
        raw[px + 3] = 0;
        continue;
      }

      const edgeAlpha = sq > 0.94 ? Math.max(0, Math.min(1, (1.04 - sq) / 0.1)) : 1;

      // Deep obsidian-sapphire background gradient + subtle top specular sheen
      let r = 10 + (1 - ny) * 14 + Math.max(0, 0.35 - Math.hypot(cx + 0.18, cy + 0.2)) * 45;
      let g = 16 + (1 - ny) * 24 + Math.max(0, 0.35 - Math.hypot(cx + 0.18, cy + 0.2)) * 78;
      let b = 30 + (1 - ny) * 44 + Math.max(0, 0.35 - Math.hypot(cx + 0.18, cy + 0.2)) * 120;

      // Outer luminous bevel ring
      if (sq > 0.85 && sq <= 0.98) {
        const rimT = nx * 0.6 + (1 - ny) * 0.4;
        r = r * 0.35 + (56 * rimT + 34 * (1 - rimT)) * 0.65;
        g = g * 0.35 + (189 * rimT + 197 * (1 - rimT)) * 0.65;
        b = b * 0.35 + (248 * rimT + 150 * (1 - rimT)) * 0.65;
      }

      // Inner optical ring (orbital tunnel ring)
      const rad = Math.hypot(cx, cy);
      const ringDist = Math.abs(rad - 0.285);
      if (ringDist < 0.032) {
        const k = Math.max(0, 1 - ringDist / 0.032);
        const blend = k * k;
        const t = Math.min(1, Math.max(0, (nx - 0.2) / 0.6));
        const cr = 56 * (1 - t) + 34 * t;
        const cg = 189 * (1 - t) + 197 * t;
        const cb = 248 * (1 - t) + 94 * t;
        r = r * (1 - blend) + cr * blend;
        g = g * (1 - blend) + cg * blend;
        b = b * (1 - blend) + cb * blend;
      }

      // Crisp geometric "V" shield emblem in center
      const dLeft = distToSegment(nx, ny, 0.355, 0.37, 0.5, 0.645);
      const dRight = distToSegment(nx, ny, 0.5, 0.645, 0.645, 0.37);
      const dV = Math.min(dLeft, dRight);
      const strokeW = 0.044;
      if (dV < strokeW) {
        const k = Math.max(0, Math.min(1, (strokeW - dV) / 0.015));
        r = r * (1 - k) + 240 * k;
        g = g * (1 - k) + 249 * k;
        b = b * (1 - k) + 255 * k;
      }

      // Glowing emerald pulse dot at apex
      const dotD = Math.hypot(nx - 0.5, ny - 0.34);
      if (dotD < 0.048) {
        const k = Math.max(0, Math.min(1, (0.048 - dotD) / 0.016));
        r = r * (1 - k) + 34 * k;
        g = g * (1 - k) + 211 * k;
        b = b * (1 - k) + 153 * k;
      }

      raw[px] = Math.max(0, Math.min(255, Math.round(r)));
      raw[px + 1] = Math.max(0, Math.min(255, Math.round(g)));
      raw[px + 2] = Math.max(0, Math.min(255, Math.round(b)));
      raw[px + 3] = Math.round(edgeAlpha * 255);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', zlib.deflateSync(raw)),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function buildIco(sizes) {
  const images = sizes.map((s) => ({ size: s, png: renderIconPng(s) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(images.length, 4);

  const dirEntries = [];
  let offset = 6 + images.length * 16;

  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry[0] = img.size >= 256 ? 0 : img.size;
    entry[1] = img.size >= 256 ? 0 : img.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(img.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += img.png.length;
    dirEntries.push(entry);
  }

  return Buffer.concat([header, ...dirEntries, ...images.map((i) => i.png)]);
}

const icoBuffer = buildIco([256, 64, 48, 32, 16]);
fs.writeFileSync(outPath, icoBuffer);
console.log(`[VEIL] Generated multi-size Windows icon -> ${outPath} (${(icoBuffer.length / 1024).toFixed(1)} KB)`);
