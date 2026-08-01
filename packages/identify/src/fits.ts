import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

/**
 * Read a FITS image and stretch it for display.
 *
 * The rest of the pipeline speaks JPEG/PNG through sharp, which cannot open
 * FITS at all — so a stacked master, which is what actually comes out of a
 * night's imaging, could not be fed in without exporting it somewhere else
 * first. That is a real obstacle onsite, where the whole point is to hand the
 * tool the file the stacker just wrote.
 *
 * Two jobs, and only two. Decode the pixels, and apply a *display* stretch: a
 * linear master is almost black until stretched, and every downstream stage
 * here — plate solving, luminance sampling, the picture an audience looks at —
 * assumes something already stretched. This is deliberately not a processing
 * tool; it makes the frame legible, nothing more.
 *
 * Supports the common single-image case: an uncompressed primary HDU, BITPIX
 * 8/16/32/-32/-64, NAXIS 2 (mono) or 3 (colour planes). Bayer-matrix data from
 * a one-shot-colour camera is left as mono and flagged, since demosaicing a
 * light frame is a different job from displaying a master.
 */

const FITS_EXT = new Set(['.fit', '.fits', '.fts']);

export function isFitsPath(path: string): boolean {
  return FITS_EXT.has(extname(path).toLowerCase());
}

const BLOCK = 2880;
const CARD = 80;

export interface FitsHeader {
  [key: string]: string | number | boolean;
}

export interface FitsImage {
  width: number;
  height: number;
  /** 1 = mono, 3 = colour planes. */
  channels: number;
  /** Row-major, top row first, channel-interleaved. Physical values. */
  data: Float32Array;
  header: FitsHeader;
  /** Set when the data is an undemosaiced colour-filter array. */
  bayerPattern?: string;
}

function parseHeader(buf: Buffer): { header: FitsHeader; dataStart: number } {
  const header: FitsHeader = {};
  let offset = 0;
  for (;;) {
    if (offset + CARD > buf.length) throw new Error('FITS header ran past the end of the file');
    const card = buf.toString('latin1', offset, offset + CARD);
    offset += CARD;
    const key = card.slice(0, 8).trim();
    if (key === 'END') {
      // Data begins at the next 2880-byte boundary.
      return { header, dataStart: Math.ceil(offset / BLOCK) * BLOCK };
    }
    if (!key || card[8] !== '=') continue; // COMMENT / HISTORY / blank
    let value = card.slice(9).split('/')[0]!.trim();
    if (value.startsWith("'")) {
      header[key] = value.slice(1, value.lastIndexOf("'")).trim();
      continue;
    }
    value = value.trim();
    if (value === 'T' || value === 'F') {
      header[key] = value === 'T';
      continue;
    }
    const n = Number(value);
    header[key] = Number.isFinite(n) ? n : value;
  }
}

const num = (h: FitsHeader, k: string, dflt?: number): number => {
  const v = h[k];
  return typeof v === 'number' ? v : (dflt ?? NaN);
};

/** Decode the primary HDU into physical values (BZERO/BSCALE applied). */
export function decodeFits(buf: Buffer): FitsImage {
  const { header, dataStart } = parseHeader(buf);
  const bitpix = num(header, 'BITPIX');
  const naxis = num(header, 'NAXIS');
  if (!Number.isFinite(bitpix) || !Number.isFinite(naxis)) {
    throw new Error('Not a FITS image (no BITPIX/NAXIS)');
  }
  if (naxis < 2 || naxis > 3) {
    throw new Error(`FITS NAXIS=${naxis} is not a 2-D or 3-D image`);
  }
  const width = num(header, 'NAXIS1');
  const height = num(header, 'NAXIS2');
  const planes = naxis === 3 ? num(header, 'NAXIS3', 1) : 1;
  if (!(width > 0 && height > 0)) throw new Error('FITS image has no dimensions');
  if (planes !== 1 && planes !== 3) {
    throw new Error(`FITS has ${planes} planes; only mono or 3-plane colour is supported`);
  }

  const bzero = num(header, 'BZERO', 0);
  const bscale = num(header, 'BSCALE', 1);
  const count = width * height * planes;
  const bytes = Math.abs(bitpix) / 8;
  if (dataStart + count * bytes > buf.length) {
    throw new Error('FITS data block is shorter than the header claims');
  }

  // FITS is big-endian, and signed for every integer BITPIX except 8-bit.
  const raw = new Float32Array(count);
  let p = dataStart;
  for (let i = 0; i < count; i++) {
    let v: number;
    switch (bitpix) {
      case 8:
        v = buf.readUInt8(p);
        break;
      case 16:
        v = buf.readInt16BE(p);
        break;
      case 32:
        v = buf.readInt32BE(p);
        break;
      case -32:
        v = buf.readFloatBE(p);
        break;
      case -64:
        v = buf.readDoubleBE(p);
        break;
      default:
        throw new Error(`Unsupported FITS BITPIX ${bitpix}`);
    }
    raw[i] = v * bscale + bzero;
    p += bytes;
  }

  // FITS rows run bottom-up; images everywhere else run top-down. Flip, and
  // interleave the planes at the same time (FITS stores them one after another).
  const data = new Float32Array(count);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width;
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < planes; c++) {
        data[(y * width + x) * planes + c] = raw[c * width * height + src + x]!;
      }
    }
  }

  const bayer = header['BAYERPAT'] ?? header['COLORTYP'];
  return {
    width,
    height,
    channels: planes,
    data,
    header,
    ...(planes === 1 && typeof bayer === 'string' && bayer.trim()
      ? { bayerPattern: bayer.trim() }
      : {}),
  };
}

/** Median of a sample, computed in place on a copy. */
function median(values: Float32Array): number {
  const a = Float32Array.from(values);
  a.sort();
  const m = a.length >> 1;
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

/** Sample at most `max` pixels, evenly spread, so statistics stay cheap. */
function sample(data: Float32Array, stride: number, max = 200_000): Float32Array {
  const total = Math.floor(data.length / stride);
  const step = Math.max(1, Math.floor(total / max));
  const out = new Float32Array(Math.floor(total / step));
  for (let i = 0, j = 0; j < out.length; i += step, j++) out[j] = data[i * stride]!;
  return out;
}

/** PixInsight's midtone transfer function. */
function mtf(x: number, m: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (m === 0.5) return x;
  return ((m - 1) * x) / ((2 * m - 1) * x - m);
}

export interface StretchOptions {
  /** Where the background should land, 0–1. Higher = brighter. Default 0.25. */
  targetBackground?: number;
  /** How many MADs below the median to clip. Default 2.8 (the STF convention). */
  shadowsClip?: number;
}

/**
 * Auto-stretch, the way a capture program's screen transfer function does it:
 * find the sky background from the median, clip a few robust deviations below
 * it, and pull it up to a fixed target with a midtone transfer. It is
 * parameter-free in practice, which matters — nobody is going to tune a curve
 * on a dark field with an audience waiting.
 *
 * Channels share one transfer so colour balance survives; stretching each
 * independently would neutralise exactly the colour the reading talks about.
 */
export function autoStretch(img: FitsImage, opts: StretchOptions = {}): Uint8Array {
  const target = opts.targetBackground ?? 0.25;
  const clip = opts.shadowsClip ?? 2.8;
  const { data, channels } = img;

  const lum = sample(data, channels);
  const med = median(lum);
  const dev = Float32Array.from(lum, (v) => Math.abs(v - med));
  const mad = median(dev) * 1.4826; // → a normal-equivalent sigma

  // Spread over the sample, not Math.min/max with a spread argument list —
  // that overflows the call stack once the sample runs to six figures.
  let sMin = Infinity;
  let sMax = -Infinity;
  for (const v of lum) {
    if (v < sMin) sMin = v;
    if (v > sMax) sMax = v;
  }
  // A synthetic frame can be perfectly flat; fall back to the range so it still
  // renders instead of dividing by zero.
  let lo = mad > 0 ? med - clip * mad : sMin;
  let hi = sMax;
  if (!(hi > lo)) {
    lo = sMin;
    hi = lo + 1;
  }

  const norm = (v: number): number => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  const bg = norm(med);
  // Midtone that maps the background to the target brightness.
  const m = bg > 0 && bg < 1 ? solveMidtone(bg, target) : 0.5;

  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = Math.round(mtf(norm(data[i]!), m) * 255);
  }
  return out;
}

/** The midtone m with mtf(bg, m) = target. Monotonic in m, so bisect. */
function solveMidtone(bg: number, target: number): number {
  let lo = 1e-6;
  let hi = 1 - 1e-6;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (mtf(bg, mid) < target) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export interface FitsReadResult {
  /** 8-bit pixels, ready to hand to sharp as raw input. */
  pixels: Uint8Array;
  width: number;
  height: number;
  channels: number;
  header: FitsHeader;
  bayerPattern?: string;
  /** The object name the capture program recorded, if any — a free target hint. */
  objectName?: string;
}

/** Read a FITS file and return display-ready 8-bit pixels. */
export async function readFitsForDisplay(
  path: string,
  opts: StretchOptions = {},
): Promise<FitsReadResult> {
  const img = decodeFits(await readFile(path));
  const objectName = typeof img.header['OBJECT'] === 'string' ? img.header['OBJECT'].trim() : '';
  return {
    pixels: autoStretch(img, opts),
    width: img.width,
    height: img.height,
    channels: img.channels,
    header: img.header,
    ...(img.bayerPattern ? { bayerPattern: img.bayerPattern } : {}),
    ...(objectName ? { objectName } : {}),
  };
}

/**
 * Decode a FITS file to a PNG the rest of the pipeline can open.
 *
 * Everything downstream — plate solving, luminance sampling, the kiosk page —
 * goes through sharp, which has no FITS reader. Converting once at the door
 * keeps that assumption intact instead of threading a second image path
 * through every stage.
 */
export async function fitsToPng(
  path: string,
  outPath: string,
  opts: StretchOptions = {},
): Promise<{ width: number; height: number; objectName?: string; bayerPattern?: string }> {
  const { default: sharp } = await import('sharp');
  const r = await readFitsForDisplay(path, opts);
  await sharp(Buffer.from(r.pixels), {
    raw: { width: r.width, height: r.height, channels: r.channels as 1 | 3 },
  })
    .png()
    .toFile(outPath);
  return {
    width: r.width,
    height: r.height,
    ...(r.objectName ? { objectName: r.objectName } : {}),
    ...(r.bayerPattern ? { bayerPattern: r.bayerPattern } : {}),
  };
}
