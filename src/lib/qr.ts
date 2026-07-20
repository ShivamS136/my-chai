/**
 * QR rendering for the UPI intent URI (P0.5).
 *
 * Framework-free by contract, like `upi.ts` (ADR-004): no React, no DOM, no
 * network, no canvas. The only import is `qrcode`'s pure-JS encoder, which turns
 * text into a module matrix without touching a rendering surface.
 *
 * Both output formats are derived from that one matrix:
 *  - `renderQrSvg`     → what the page displays (crisp at any size, no raster)
 *  - `renderQrPng`     → what "Save QR" downloads
 *
 * We deliberately do NOT use `qrcode`'s own `toCanvas`/`toDataURL` renderers
 * (ADR-017). They require a real `<canvas>`, which means the download path could
 * not be tested in CI at all — and P0.5 says the QR must be downloadable. A
 * hand-rolled PNG encoder is ~90 lines of pure arithmetic that jsdom, Node and
 * every browser run identically, so `qr.test.ts` can decode the exact bytes a
 * donor would receive and assert they carry the exact URI.
 *
 * The QR is always rendered in plain black on white. The creator's accent colour
 * is deliberately NOT applied: scanners need high luminance contrast, and a
 * mis-scanned QR on a payment page is an unrecoverable failure (ADR-008).
 */

import { create } from 'qrcode';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * 'M' (~15% recovery) is the QR spec's general-purpose default and what UPI apps
 * expect. Higher levels survive more damage but grow the symbol, and our payload
 * is already long; a bigger symbol on a 240px canvas means smaller modules, which
 * hurts scanning more than the extra redundancy helps.
 */
export const QR_ERROR_CORRECTION_LEVEL = 'M' as const;

/** The QR spec mandates a 4-module light border. Scanners fail without it. */
export const QR_QUIET_ZONE_MODULES = 4;

/** Pixels per module in the downloaded PNG. 8 keeps a v10 symbol comfortably printable. */
export const QR_PNG_SCALE = 8;

const DEFAULT_DARK = '#000000';
const DEFAULT_LIGHT = '#FFFFFF';

// ── Matrix ───────────────────────────────────────────────────────────────────

export interface QrMatrix {
  /** Symbol width in modules, excluding the quiet zone. */
  readonly size: number;
  /** Row-major, `size * size` entries. 1 = dark. */
  readonly data: Uint8Array;
}

/**
 * Encodes text into a QR module matrix.
 *
 * Returns `null` instead of throwing — this runs on every keystroke of the
 * amount and message fields, where an empty or over-capacity payload is a normal
 * transient state, not an exception. `qrcode` throws on empty input and on text
 * exceeding version 40's capacity; both surface here as "no QR available", and
 * the UI keeps the copy-VPA path (which never depends on the QR) working.
 */
export const createQrMatrix = (text: string): QrMatrix | null => {
  try {
    const { modules } = create(text, { errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL });
    return { size: modules.size, data: modules.data };
  } catch {
    return null;
  }
};

/**
 * Reads a module in quiet-zone coordinates: `(0,0)` is the top-left of the
 * border, so anything outside the symbol proper reads as light.
 */
const isDarkAt = (matrix: QrMatrix, quietZone: number, row: number, col: number): boolean => {
  const r = row - quietZone;
  const c = col - quietZone;
  if (r < 0 || c < 0 || r >= matrix.size || c >= matrix.size) return false;
  return matrix.data[r * matrix.size + c] === 1;
};

const totalModules = (matrix: QrMatrix, quietZone: number): number => matrix.size + quietZone * 2;

// ── SVG ──────────────────────────────────────────────────────────────────────

export interface QrRenderOptions {
  readonly quietZone?: number;
  readonly dark?: string;
  readonly light?: string;
}

/**
 * Renders the matrix as a standalone SVG document.
 *
 * Dark modules are merged into horizontal runs and emitted as one `<path>`, so a
 * v10 symbol costs a few hundred bytes rather than ~1500 individual `<rect>`s.
 *
 * `shape-rendering="crispEdges"` is load-bearing, not cosmetic: with default
 * anti-aliasing the browser blends module edges into grey at non-integer scales,
 * which is exactly the ambiguity a camera cannot resolve.
 *
 * No width/height attributes — only a viewBox — so CSS controls the display size.
 */
export const renderQrSvg = (matrix: QrMatrix, options: QrRenderOptions = {}): string => {
  const quietZone = options.quietZone ?? QR_QUIET_ZONE_MODULES;
  const dark = options.dark ?? DEFAULT_DARK;
  const light = options.light ?? DEFAULT_LIGHT;
  const total = totalModules(matrix, quietZone);

  const runs: string[] = [];
  for (let row = 0; row < total; row += 1) {
    let runStart = -1;
    // `col === total` is a deliberate sentinel iteration: it closes a run that
    // reaches the right edge without duplicating the emit branch below.
    for (let col = 0; col <= total; col += 1) {
      const dark_ = col < total && isDarkAt(matrix, quietZone, row, col);
      if (dark_) {
        if (runStart === -1) runStart = col;
      } else if (runStart !== -1) {
        const width = col - runStart;
        runs.push(`M${runStart} ${row}h${width}v1h-${width}z`);
        runStart = -1;
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
    `shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${light}"/>` +
    `<path fill="${dark}" d="${runs.join('')}"/>` +
    `</svg>`
  );
};

/**
 * `data:` URI for an `<img src>`.
 *
 * An `<img>` rather than inline SVG on purpose: it gives the QR a real `alt`
 * (DESIGN.md requires the VPA and amount as its text alternative), it keeps the
 * creator's page CSS from leaking into the symbol, and it avoids
 * `dangerouslySetInnerHTML`.
 */
export const qrSvgDataUrl = (svg: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// ── RGBA raster ──────────────────────────────────────────────────────────────

export interface QrRaster {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 bytes per pixel — the shape `jsQR` and `ImageData` both take. */
  readonly data: Uint8ClampedArray;
}

/**
 * Rasterises the matrix to RGBA. Used by the round-trip test to feed `jsQR`, and
 * as the reference the PNG encoder is checked against — the two share
 * `isDarkAt`, so a geometry bug cannot hide in one and not the other.
 */
export const renderQrRaster = (
  matrix: QrMatrix,
  scale: number = QR_PNG_SCALE,
  quietZone: number = QR_QUIET_ZONE_MODULES,
): QrRaster => {
  const total = totalModules(matrix, quietZone);
  const side = total * scale;
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y += 1) {
    const row = Math.floor(y / scale);
    for (let x = 0; x < side; x += 1) {
      const value = isDarkAt(matrix, quietZone, row, Math.floor(x / scale)) ? 0 : 255;
      const offset = (y * side + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { width: side, height: side, data };
};

// ── PNG ──────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    // biome-ignore lint/style/noNonNullAssertion: index is masked to 0..255.
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/** Adler-32 over the uncompressed stream, as zlib's trailer requires. */
const adler32 = (bytes: Uint8Array): number => {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
};

const u32 = (value: number): Uint8Array =>
  new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** PNG chunk: length, type, data, CRC over type+data. */
const pngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const typeBytes = new Uint8Array([...type].map((ch) => ch.charCodeAt(0)));
  const body = concat([typeBytes, data]);
  return concat([u32(data.length), body, u32(crc32(body))]);
};

/**
 * zlib stream using stored (uncompressed) DEFLATE blocks.
 *
 * A real compressor would shrink this ~10×, but implementing Huffman coding to
 * save ~12KB on a button the donor presses at most once is not a trade worth
 * making — and stored blocks are simple enough to be obviously correct, which
 * matters more in the payment path. The 1-bit-per-pixel colour type below is
 * where the real saving comes from.
 */
const zlibStored = (raw: Uint8Array): Uint8Array => {
  const blocks: Uint8Array[] = [];
  const MAX_BLOCK = 0xffff;
  for (let offset = 0; offset < raw.length; offset += MAX_BLOCK) {
    const slice = raw.subarray(offset, Math.min(offset + MAX_BLOCK, raw.length));
    const isFinal = offset + MAX_BLOCK >= raw.length;
    const len = slice.length;
    blocks.push(
      new Uint8Array([
        isFinal ? 1 : 0,
        len & 0xff,
        (len >>> 8) & 0xff,
        ~len & 0xff,
        (~len >>> 8) & 0xff,
      ]),
      slice,
    );
  }
  // 0x78 0x01: deflate, 32K window, no preset dictionary, fastest level.
  return concat([new Uint8Array([0x78, 0x01]), ...blocks, u32(adler32(raw))]);
};

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Encodes the matrix as a PNG.
 *
 * Colour type 0 (greyscale) at bit depth 1 — one bit per pixel, which is exactly
 * what a QR is. Bit 0 is black, bit 1 is white. Each scanline is prefixed with
 * filter byte 0 (None); filtering would only help a compressor we do not use.
 */
export const renderQrPng = (
  matrix: QrMatrix,
  scale: number = QR_PNG_SCALE,
  quietZone: number = QR_QUIET_ZONE_MODULES,
): Uint8Array => {
  const total = totalModules(matrix, quietZone);
  const side = total * scale;
  const bytesPerRow = Math.ceil(side / 8);

  const raw = new Uint8Array((bytesPerRow + 1) * side);
  for (let y = 0; y < side; y += 1) {
    const rowStart = y * (bytesPerRow + 1);
    raw[rowStart] = 0; // filter: None
    const moduleRow = Math.floor(y / scale);
    for (let x = 0; x < side; x += 1) {
      if (isDarkAt(matrix, quietZone, moduleRow, Math.floor(x / scale))) continue;
      // Light pixel: set the bit. The buffer starts all-zero, i.e. all-black.
      const index = rowStart + 1 + (x >>> 3);
      // biome-ignore lint/style/noNonNullAssertion: index is within the allocation.
      raw[index] = raw[index]! | (0x80 >>> (x & 7));
    }
  }

  const ihdr = concat([
    u32(side),
    u32(side),
    new Uint8Array([1, 0, 0, 0, 0]), // bit depth 1, greyscale, deflate, filter 0, non-interlaced
  ]);

  return concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibStored(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
};

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64 over bytes.
 *
 * Hand-rolled rather than `btoa`: `btoa` takes a latin1 *string*, so feeding it a
 * Uint8Array means `String.fromCharCode(...bytes)`, which overflows the call
 * stack on the ~14KB buffers this produces.
 */
/** Reads past the end as 0 — the padding case for a length that is not a multiple of 3. */
const byteAt = (bytes: Uint8Array, index: number): number => bytes[index] ?? 0;

const toBase64 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const triple = (byteAt(bytes, i) << 16) | (byteAt(bytes, i + 1) << 8) | byteAt(bytes, i + 2);
    const remaining = bytes.length - i;
    out += BASE64_ALPHABET[(triple >>> 18) & 63];
    out += BASE64_ALPHABET[(triple >>> 12) & 63];
    out += remaining > 1 ? BASE64_ALPHABET[(triple >>> 6) & 63] : '=';
    out += remaining > 2 ? BASE64_ALPHABET[triple & 63] : '=';
  }
  return out;
};

export const qrPngDataUrl = (png: Uint8Array): string => `data:image/png;base64,${toBase64(png)}`;
