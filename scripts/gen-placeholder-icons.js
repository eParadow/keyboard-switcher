'use strict';

/**
 * Generation de PNG 16x16 unis pour les icones tray (placeholders).
 *
 * Ce script est autonome : pas de dependances externes (pas de `sharp`),
 * on ecrit directement les bytes d'un PNG 16x16 valide. A re-executer si
 * on veut regenerer les placeholders.
 *
 * Usage : node scripts/gen-placeholder-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// --- PNG encoder minimal -------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC32 table (standard PNG).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT : pour chaque ligne, 1 byte filter (0 = None) + 4 bytes/pixel RGBA.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function solidRgba(width, height, r, g, b, a = 255) {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4 + 0] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = a;
  }
  return buf;
}

// --- Main ---------------------------------------------------------------

function main() {
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  // Bleu #4a9eff plein (actif)
  const activeRgba = solidRgba(16, 16, 0x4a, 0x9e, 0xff, 255);
  const activePng = encodePng(16, 16, activeRgba);
  fs.writeFileSync(path.join(ASSETS_DIR, 'tray-icon.png'), activePng);

  // Gris #666666 plein (paused)
  const pausedRgba = solidRgba(16, 16, 0x66, 0x66, 0x66, 255);
  const pausedPng = encodePng(16, 16, pausedRgba);
  fs.writeFileSync(path.join(ASSETS_DIR, 'tray-icon-paused.png'), pausedPng);

  // eslint-disable-next-line no-console
  console.log('[gen-icons] wrote tray-icon.png + tray-icon-paused.png');
}

main();
