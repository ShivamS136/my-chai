import { inflateSync } from 'node:zlib';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import {
  createQrMatrix,
  QR_QUIET_ZONE_MODULES,
  type QrMatrix,
  qrPngDataUrl,
  qrSvgDataUrl,
  renderQrPng,
  renderQrRaster,
  renderQrSvg,
} from './qr.ts';
import { buildUpiUri } from './upi.ts';

/**
 * The QR is the desktop payment path (P0.5). A QR that encodes the wrong VPA
 * sends money to a stranger, unrecoverably (PRD §8.3) — so these tests decode
 * what we actually render, with a third-party decoder, rather than asserting on
 * our own intermediate representations.
 *
 * Two independent decoders are used deliberately:
 *  - `jsQR` reads the rendered pixels back to a string (proves the symbol).
 *  - Node's `zlib.inflateSync` reads our PNG's compressed stream (proves the
 *    container, including the adler-32 trailer, against a real implementation
 *    rather than our own).
 */

const uriFor = (overrides: Partial<Parameters<typeof buildUpiUri>[0]> = {}): string => {
  const result = buildUpiUri({
    vpa: 'shivam@okaxis',
    name: 'Shivam Sharma',
    amount: 150,
    ...overrides,
  });
  if (!result.ok) throw new Error(`fixture is not payable: ${result.errors[0]?.message}`);
  return result.value.uri;
};

const matrixFor = (text: string): QrMatrix => {
  const matrix = createQrMatrix(text);
  if (matrix === null) throw new Error('expected a QR matrix');
  return matrix;
};

const decode = (raster: ReturnType<typeof renderQrRaster>): string | null =>
  jsQR(raster.data, raster.width, raster.height)?.data ?? null;

// ── PNG container ────────────────────────────────────────────────────────────

interface PngChunk {
  readonly type: string;
  readonly data: Uint8Array;
}

const readU32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) << 24) |
  ((bytes[offset + 1] ?? 0) << 16) |
  ((bytes[offset + 2] ?? 0) << 8) |
  (bytes[offset + 3] ?? 0);

const parsePngChunks = (png: Uint8Array): PngChunk[] => {
  const chunks: PngChunk[] = [];
  let offset = 8; // skip the signature
  while (offset < png.length) {
    const length = readU32(png, offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length; // length + type + data + crc
  }
  return chunks;
};

/**
 * Decodes our PNG back to RGBA the way an image library would: inflate the IDAT
 * with Node's zlib, then unpack the 1-bit greyscale scanlines.
 */
const decodePngToRaster = (png: Uint8Array): ReturnType<typeof renderQrRaster> => {
  const chunks = parsePngChunks(png);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  const idat = chunks.find((c) => c.type === 'IDAT');
  if (!ihdr || !idat) throw new Error('malformed PNG');

  const width = readU32(ihdr.data, 0);
  const height = readU32(ihdr.data, 4);
  const raw = new Uint8Array(inflateSync(Buffer.from(idat.data)));

  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (bytesPerRow + 1);
    expect(raw[rowStart]).toBe(0); // filter type: None
    for (let x = 0; x < width; x += 1) {
      const byte = raw[rowStart + 1 + (x >>> 3)] ?? 0;
      const bit = (byte >>> (7 - (x & 7))) & 1;
      const value = bit === 1 ? 255 : 0;
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
};

// ── Round-trip ───────────────────────────────────────────────────────────────

describe('QR round-trip', () => {
  const cases: ReadonlyArray<readonly [label: string, uri: string]> = [
    ['minimal — no note', uriFor({ amount: 1 })],
    ['typical donation', uriFor()],
    ['note with a space', uriFor({ note: 'Thanks for the great work' })],
    // The characters that made us reject URLSearchParams (ADR-010) and hand-roll
    // the encoder: a `+` must survive as %2B, not decode back to a space.
    ['note with reserved characters', uriFor({ note: 'a+b & c#d = e?f' })],
    ['note with emoji', uriFor({ note: 'chai ☕ for you 🙏' })],
    ['note at the 60 code-point cap', uriFor({ note: 'ना'.repeat(60) })],
    ['name with an apostrophe', uriFor({ name: "D'Souza" })],
    ['largest payable amount', uriFor({ amount: 10_000_000 })],
  ];

  it.each(cases)('%s decodes from the rendered pixels to the exact URI', (_label, uri) => {
    expect(decode(renderQrRaster(matrixFor(uri)))).toBe(uri);
  });

  it.each(cases)('%s decodes from the downloaded PNG to the exact URI', (_label, uri) => {
    expect(decode(decodePngToRaster(renderQrPng(matrixFor(uri))))).toBe(uri);
  });

  it('renders identical geometry to the SVG and the PNG', () => {
    const matrix = matrixFor(uriFor());
    // Same scale for both so the comparison is pixel-exact.
    expect(Array.from(decodePngToRaster(renderQrPng(matrix, 4)).data)).toEqual(
      Array.from(renderQrRaster(matrix, 4).data),
    );
  });
});

// ── Matrix ───────────────────────────────────────────────────────────────────

describe('createQrMatrix', () => {
  it('produces a square, odd-sized symbol', () => {
    const matrix = matrixFor(uriFor());
    expect(matrix.data).toHaveLength(matrix.size * matrix.size);
    // Every QR version is 4n+17 modules — always odd. A wrong stride would break this.
    expect(matrix.size % 2).toBe(1);
  });

  it('returns null rather than throwing on empty input', () => {
    // The custom-amount field is empty on first paint; a throw here would take
    // out the whole render tree.
    expect(createQrMatrix('')).toBeNull();
  });

  it('returns null rather than throwing when the payload exceeds QR capacity', () => {
    expect(createQrMatrix('x'.repeat(5000))).toBeNull();
  });
});

// ── SVG ──────────────────────────────────────────────────────────────────────

describe('renderQrSvg', () => {
  const matrix = matrixFor(uriFor());
  const svg = renderQrSvg(matrix);

  it('sizes the viewBox to the symbol plus a quiet zone on both sides', () => {
    const total = matrix.size + QR_QUIET_ZONE_MODULES * 2;
    expect(svg).toContain(`viewBox="0 0 ${total} ${total}"`);
  });

  it('omits width and height on the root so CSS controls the display size', () => {
    // Scoped to the <svg> tag — the background <rect> legitimately carries both.
    const openTag = svg.slice(0, svg.indexOf('>') + 1);
    expect(openTag).not.toMatch(/\swidth=/);
    expect(openTag).not.toMatch(/\sheight=/);
  });

  it('disables anti-aliasing, which blurs module edges beyond what cameras resolve', () => {
    expect(svg).toContain('shape-rendering="crispEdges"');
  });

  it('defaults to black on white regardless of the creator accent', () => {
    // Scanners need luminance contrast; the accent never applies here.
    expect(svg).toContain('fill="#FFFFFF"');
    expect(svg).toContain('fill="#000000"');
  });

  it('merges each row of dark modules into horizontal runs', () => {
    // Reconstructing the matrix from the path proves the merge is lossless.
    const quiet = QR_QUIET_ZONE_MODULES;
    const painted = new Set<string>();
    const path = /M(\d+) (\d+)h(\d+)v1h-\d+z/g;
    let match = path.exec(svg);
    while (match !== null) {
      const [, x, y, width] = match;
      for (let i = 0; i < Number(width); i += 1) painted.add(`${Number(x) + i},${y}`);
      match = path.exec(svg);
    }
    for (let row = 0; row < matrix.size; row += 1) {
      for (let col = 0; col < matrix.size; col += 1) {
        const dark = matrix.data[row * matrix.size + col] === 1;
        expect(painted.has(`${col + quiet},${row + quiet}`)).toBe(dark);
      }
    }
  });

  it('emits fewer runs than dark modules', () => {
    const runs = svg.match(/M\d+ \d+h/g)?.length ?? 0;
    const darkModules = matrix.data.reduce<number>((sum, bit) => sum + bit, 0);
    expect(runs).toBeGreaterThan(0);
    expect(runs).toBeLessThan(darkModules);
  });

  it('honours a custom quiet zone', () => {
    expect(renderQrSvg(matrix, { quietZone: 0 })).toContain(
      `viewBox="0 0 ${matrix.size} ${matrix.size}"`,
    );
  });

  it('honours custom colours', () => {
    const themed = renderQrSvg(matrix, { dark: '#123456', light: '#abcdef' });
    expect(themed).toContain('fill="#123456"');
    expect(themed).toContain('fill="#abcdef"');
  });
});

describe('qrSvgDataUrl', () => {
  it('percent-encodes the payload so `#` in colours does not truncate the URI', () => {
    const url = qrSvgDataUrl(renderQrSvg(matrixFor(uriFor())));
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(url).not.toContain('#');
    expect(decodeURIComponent(url.slice('data:image/svg+xml;charset=utf-8,'.length))).toContain(
      '<svg',
    );
  });
});

// ── PNG ──────────────────────────────────────────────────────────────────────

describe('renderQrPng', () => {
  const matrix = matrixFor(uriFor());
  const png = renderQrPng(matrix);

  it('starts with the PNG signature', () => {
    expect(Array.from(png.subarray(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });

  it('declares a square 1-bit greyscale, non-interlaced image', () => {
    const ihdr = parsePngChunks(png).find((c) => c.type === 'IHDR');
    if (!ihdr) throw new Error('no IHDR');
    const side = (matrix.size + QR_QUIET_ZONE_MODULES * 2) * 8;
    expect(readU32(ihdr.data, 0)).toBe(side);
    expect(readU32(ihdr.data, 4)).toBe(side);
    expect(Array.from(ihdr.data.subarray(8))).toEqual([1, 0, 0, 0, 0]);
  });

  it('ends with the canonical IEND chunk', () => {
    // These 12 bytes are fixed by the PNG spec, CRC included — matching them
    // checks our CRC-32 against a published value, not against ourselves.
    expect(Array.from(png.subarray(-12))).toEqual([
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
  });

  it('emits a zlib stream that a real inflater accepts', () => {
    // Node verifies the adler-32 trailer and stored-block framing for us.
    const idat = parsePngChunks(png).find((c) => c.type === 'IDAT');
    if (!idat) throw new Error('no IDAT');
    const side = (matrix.size + QR_QUIET_ZONE_MODULES * 2) * 8;
    const raw = inflateSync(Buffer.from(idat.data));
    expect(raw).toHaveLength((Math.ceil(side / 8) + 1) * side);
  });

  it('spans more than one stored block when the image exceeds 64KB', () => {
    // Exercises the multi-block path: stored DEFLATE blocks cap at 65535 bytes.
    const large = renderQrPng(matrix, 32);
    const idat = parsePngChunks(large).find((c) => c.type === 'IDAT');
    if (!idat) throw new Error('no IDAT');
    expect(idat.data.length).toBeGreaterThan(0xffff);
    expect(() => inflateSync(Buffer.from(idat.data))).not.toThrow();
    expect(decode(decodePngToRaster(large))).toBe(uriFor());
  });

  it('honours a custom quiet zone', () => {
    const bare = renderQrPng(matrix, 8, 0);
    const ihdr = parsePngChunks(bare).find((c) => c.type === 'IHDR');
    if (!ihdr) throw new Error('no IHDR');
    expect(readU32(ihdr.data, 0)).toBe(matrix.size * 8);
  });
});

describe('qrPngDataUrl', () => {
  it('base64-encodes the bytes losslessly', () => {
    const png = renderQrPng(matrixFor(uriFor()));
    const url = qrPngDataUrl(png);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    const decoded = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
    expect(Array.from(decoded)).toEqual(Array.from(png));
  });

  it.each([1, 2, 3])('pads correctly for a payload of length %i mod 3', (length) => {
    // Base64 padding is the classic off-by-one; round-trip each remainder.
    const bytes = new Uint8Array(Array.from({ length }, (_, i) => i * 40 + 7));
    const url = qrPngDataUrl(bytes);
    const decoded = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });
});
