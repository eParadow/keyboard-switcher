'use strict';

/**
 * Generation des icones du projet : tray PNG (16/32) + app ICO (multi-taille).
 *
 * Pixel art procedural : on dessine un clavier stylise (corps + touches)
 * a differentes tailles sans aucune dependance externe (pas de sharp,
 * canvas, etc.). Encodeurs PNG et ICO maison, inlined.
 *
 * Usage : node scripts/gen-placeholder-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// --- PNG encoder minimal -------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

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

// --- Drawing helpers -----------------------------------------------------

function setPixel(buf, size, x, y, rgba) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  buf[i + 0] = rgba[0];
  buf[i + 1] = rgba[1];
  buf[i + 2] = rgba[2];
  buf[i + 3] = rgba[3];
}

function fillRect(buf, size, x, y, w, h, rgba) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      setPixel(buf, size, x + dx, y + dy, rgba);
    }
  }
}

// Rectangle avec coins arrondis (chanfrein 1px) — donne un look moins anguleux.
function fillRoundRect(buf, size, x, y, w, h, rgba) {
  fillRect(buf, size, x, y, w, h, rgba);
  // Retire les 4 pixels de coin pour adoucir.
  setPixel(buf, size, x, y, [0, 0, 0, 0]);
  setPixel(buf, size, x + w - 1, y, [0, 0, 0, 0]);
  setPixel(buf, size, x, y + h - 1, [0, 0, 0, 0]);
  setPixel(buf, size, x + w - 1, y + h - 1, [0, 0, 0, 0]);
}

// --- Clavier procedural --------------------------------------------------

/**
 * Dessine un clavier stylise sur un buffer RGBA transparent de taille
 * `size` x `size`. `active` = true pour la variante bleue (actif),
 * false pour la variante grise (paused).
 */
function drawKeyboard(size, active) {
  const buf = Buffer.alloc(size * size * 4); // transparent partout

  const body = active ? [0x4a, 0x9e, 0xff, 255] : [0x6b, 0x72, 0x80, 255];
  const bodyDark = active ? [0x1e, 0x4f, 0x8f, 255] : [0x37, 0x41, 0x51, 255];
  const key = [0xf3, 0xf4, 0xf6, 255];

  // Geometrie proportionnelle.
  const marginX = Math.max(1, Math.round(size * 0.06));
  const bodyH = Math.max(6, Math.round(size * 0.60));
  const bodyW = size - 2 * marginX;
  const bodyX = marginX;
  const bodyY = Math.round((size - bodyH) / 2);

  // Corps : bordure sombre + interieur bleu clair.
  fillRoundRect(buf, size, bodyX, bodyY, bodyW, bodyH, bodyDark);
  const innerInset = Math.max(1, Math.round(size / 32));
  fillRect(
    buf, size,
    bodyX + innerInset, bodyY + innerInset,
    bodyW - 2 * innerInset, bodyH - 2 * innerInset,
    body
  );

  // Zone interieure ou l'on dessine les touches.
  const pad = Math.max(1, Math.round(size / 16));
  const kbX = bodyX + innerInset + pad;
  const kbY = bodyY + innerInset + pad;
  const kbW = bodyW - 2 * (innerInset + pad);
  const kbH = bodyH - 2 * (innerInset + pad);

  // Grille : 3 rangees de touches + 1 rangee de spacebar.
  // A petite taille (16), on reduit a 2 rangees + spacebar.
  const rows = size < 24 ? 2 : 3;
  const cols = size < 24 ? 3 : 5;

  // Reserve ~30% de la hauteur pour la spacebar.
  const keysZoneH = Math.floor(kbH * 0.72);
  const gap = Math.max(1, Math.round(size / 40));
  const keyW = Math.floor((kbW - gap * (cols + 1)) / cols);
  const keyH = Math.floor((keysZoneH - gap * (rows + 1)) / rows);

  if (keyW >= 1 && keyH >= 1) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const kx = kbX + gap + c * (keyW + gap);
        const ky = kbY + gap + r * (keyH + gap);
        fillRect(buf, size, kx, ky, keyW, keyH, key);
      }
    }

    // Spacebar centree sous les touches.
    const sbY = kbY + gap + rows * (keyH + gap);
    const sbH = Math.max(1, kbY + kbH - sbY - gap);
    const sbWidth = Math.max(keyW, Math.floor(kbW * 0.55));
    const sbX = kbX + Math.floor((kbW - sbWidth) / 2);
    if (sbH >= 1) {
      fillRect(buf, size, sbX, sbY, sbWidth, sbH, key);
    }
  } else {
    // Taille trop petite pour une grille distincte : on marque juste
    // 3 bandes horizontales claires pour suggerer des rangees.
    const bandH = Math.max(1, Math.floor(kbH / 6));
    for (let i = 0; i < 3; i++) {
      const by = kbY + i * (bandH * 2) + 1;
      if (by + bandH <= kbY + kbH) {
        fillRect(buf, size, kbX + 1, by, kbW - 2, bandH, key);
      }
    }
  }

  return buf;
}

// --- ICO encoder ---------------------------------------------------------

/**
 * Encode une liste d'images PNG en un fichier .ico Windows.
 * Chaque image est fournie comme `{ width, height, png: Buffer }`.
 * Format : header 6 bytes + N * 16 bytes d'entrees + donnees PNG concatenees.
 */
function encodeIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type 1 = ICO
  header.writeUInt16LE(count, 4);  // count

  const entries = Buffer.alloc(16 * count);
  let dataOffset = 6 + 16 * count;
  const dataChunks = [];

  for (let i = 0; i < count; i++) {
    const img = images[i];
    const base = i * 16;
    entries[base + 0] = img.width >= 256 ? 0 : img.width;
    entries[base + 1] = img.height >= 256 ? 0 : img.height;
    entries[base + 2] = 0;  // color palette
    entries[base + 3] = 0;  // reserved
    entries.writeUInt16LE(1, base + 4);  // color planes
    entries.writeUInt16LE(32, base + 6); // bits per pixel
    entries.writeUInt32LE(img.png.length, base + 8);
    entries.writeUInt32LE(dataOffset, base + 12);
    dataChunks.push(img.png);
    dataOffset += img.png.length;
  }

  return Buffer.concat([header, entries, ...dataChunks]);
}

// --- Main ---------------------------------------------------------------

function main() {
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  // Tray : 32x32 pour la densite standard Windows 10/11.
  const activeRgba = drawKeyboard(32, true);
  const activePng = encodePng(32, 32, activeRgba);
  fs.writeFileSync(path.join(ASSETS_DIR, 'tray-icon.png'), activePng);

  const pausedRgba = drawKeyboard(32, false);
  const pausedPng = encodePng(32, 32, pausedRgba);
  fs.writeFileSync(path.join(ASSETS_DIR, 'tray-icon-paused.png'), pausedPng);

  // App icon ICO multi-taille : 16, 32, 48, 64, 128, 256 (variante active).
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoImages = icoSizes.map((s) => {
    const rgba = drawKeyboard(s, true);
    const png = encodePng(s, s, rgba);
    return { width: s, height: s, png };
  });
  const ico = encodeIco(icoImages);
  fs.writeFileSync(path.join(ASSETS_DIR, 'app-icon.ico'), ico);

  // Nettoyage du marqueur TODO s'il existait.
  const todoPath = path.join(ASSETS_DIR, 'app-icon.ico.TODO');
  if (fs.existsSync(todoPath)) {
    try { fs.unlinkSync(todoPath); } catch (_err) { /* ignore */ }
  }

  // eslint-disable-next-line no-console
  console.log('[gen-icons] wrote tray-icon.png (32x32)');
  // eslint-disable-next-line no-console
  console.log('[gen-icons] wrote tray-icon-paused.png (32x32)');
  // eslint-disable-next-line no-console
  console.log(`[gen-icons] wrote app-icon.ico (sizes: ${icoSizes.join(', ')})`);
}

main();
