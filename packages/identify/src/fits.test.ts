import { describe, expect, it } from 'vitest';
import { decodeFits, autoStretch, isFitsPath } from './fits.js';

/** Build a minimal but valid FITS: 2880-byte header blocks, big-endian data. */
function makeFits(opts: {
  width: number;
  height: number;
  bitpix: 8 | 16 | -32;
  values: number[]; // bottom-up, as FITS stores them
  extra?: string[];
}): Buffer {
  const cards: string[] = [
    `SIMPLE  =                    T`,
    `BITPIX  = ${String(opts.bitpix).padStart(20)}`,
    `NAXIS   =                    2`,
    `NAXIS1  = ${String(opts.width).padStart(20)}`,
    `NAXIS2  = ${String(opts.height).padStart(20)}`,
    ...(opts.extra ?? []),
    'END',
  ];
  const headerText = cards.map((c) => c.padEnd(80)).join('');
  const blocks = Math.ceil(headerText.length / 2880);
  const header = Buffer.alloc(blocks * 2880, ' ');
  header.write(headerText, 0, 'latin1');

  const bytes = Math.abs(opts.bitpix) / 8;
  const data = Buffer.alloc(Math.ceil((opts.values.length * bytes) / 2880) * 2880);
  opts.values.forEach((v, i) => {
    if (opts.bitpix === 8) data.writeUInt8(v, i);
    else if (opts.bitpix === 16) data.writeInt16BE(v, i * 2);
    else data.writeFloatBE(v, i * 4);
  });
  return Buffer.concat([header, data]);
}

describe('FITS decoding', () => {
  it('recognises the extensions the capture programs actually write', () => {
    expect(isFitsPath('/a/b.fits')).toBe(true);
    expect(isFitsPath('/a/b.FIT')).toBe(true);
    expect(isFitsPath('/a/b.fts')).toBe(true);
    expect(isFitsPath('/a/b.jpg')).toBe(false);
  });

  it('flips the rows: FITS stores bottom-up, everything else top-down', () => {
    // Two rows: bottom row is 1,2 and top row is 3,4.
    const img = decodeFits(makeFits({ width: 2, height: 2, bitpix: 16, values: [1, 2, 3, 4] }));
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    expect(Array.from(img.data)).toEqual([3, 4, 1, 2]); // top row first
  });

  it('applies BZERO/BSCALE, which is how 16-bit unsigned data is stored', () => {
    const img = decodeFits(
      makeFits({
        width: 1,
        height: 1,
        bitpix: 16,
        values: [-32768], // signed on disk …
        extra: ['BZERO   =              32768.0', 'BSCALE  =                  1.0'],
      }),
    );
    expect(img.data[0]).toBe(0); // … unsigned 0 in physical value
  });

  it('reads 32-bit floats', () => {
    const img = decodeFits(makeFits({ width: 2, height: 1, bitpix: -32, values: [0.25, 0.75] }));
    expect(Array.from(img.data)).toEqual([0.25, 0.75]);
  });

  it('flags a Bayer matrix rather than silently treating it as a grey image', () => {
    const img = decodeFits(
      makeFits({ width: 2, height: 1, bitpix: 8, values: [1, 2], extra: ["BAYERPAT= 'RGGB    '"] }),
    );
    expect(img.bayerPattern).toBe('RGGB');
  });

  it('refuses data it cannot honestly decode', () => {
    expect(() => decodeFits(Buffer.alloc(2880, ' '))).toThrow(/header ran past|BITPIX/);
  });
});

describe('display stretch', () => {
  const linear = (values: number[], w = values.length) =>
    decodeFits(makeFits({ width: w, height: values.length / w, bitpix: -32, values }));

  it('lifts a dark linear frame to a visible background', () => {
    // A typical linear master: sky at ~0.01, a few stars far above it.
    const sky = Array.from({ length: 96 }, (_, i) => 0.01 + (i % 4) * 0.001);
    const out = autoStretch(linear([...sky, 0.9, 0.8, 0.7, 0.95], 100));
    const bg = out.slice(0, 96).reduce((a, b) => a + b, 0) / 96;
    // The point of the stretch: sky that was 1% of full scale becomes visible.
    expect(bg).toBeGreaterThan(40);
    expect(bg).toBeLessThan(110);
    expect(Math.max(...out)).toBeGreaterThan(200); // stars stay bright
  });

  it('does not divide by zero on a perfectly flat frame', () => {
    const out = autoStretch(linear(Array.from({ length: 16 }, () => 0.5), 4));
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });
});
