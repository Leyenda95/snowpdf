import type { Raster } from "@/pdf/inpaint";

/*
 * Shared pieces of the document scanner (photo -> clean page). Like the rest of src/pdf, pure
 * TypeScript on plain pixel buffers: no DOM, so it runs in Node (tests) and could move to a worker.
 */

export interface Point {
  x: number;
  y: number;
}

/** Corners of the sheet in image pixels: top left, top right, bottom right, bottom left. */
export type Quad = [Point, Point, Point, Point];

/** The whole image (pixel centres of its corners). */
export function fullQuad(width: number, height: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 },
  ];
}

/** Clockwise as seen (y down), no corner folded in: what a crop outline must stay. */
export function isConvexQuad(q: Quad): boolean {
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0) return false;
  }
  return true;
}

/**
 * The same corners on a copy of the picture `factor` times larger (corners are pixel centres, so
 * this is not a plain multiplication).
 */
export function scaleQuad(q: Quad, factor: number): Quad {
  return q.map((p) => ({ x: (p.x + 0.5) * factor - 0.5, y: (p.y + 0.5) * factor - 0.5 })) as Quad;
}

/** Where the source pixel (x, y) of a w×h picture lands after 1, 2 or 3 clockwise quarter turns. */
const TURNED: Record<1 | 2 | 3, (x: number, y: number, w: number, h: number) => [number, number]> = {
  1: (x, y, _w, h) => [h - 1 - y, x],
  2: (x, y, w, h) => [w - 1 - x, h - 1 - y],
  3: (x, y, w) => [y, w - 1 - x],
};

/** Rotates clockwise by quarter turns. */
export function rotateRaster(img: Raster, quarterTurns: number): Raster {
  const turns = (((quarterTurns % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  const { width: w, height: h, channels: c, data } = img;
  if (turns === 0) return { ...img, data: new Uint8ClampedArray(data) };
  const ow = turns === 2 ? w : h;
  const place = TURNED[turns];
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [ox, oy] = place(x, y, w, h);
      const i = (y * w + x) * c;
      const o = (oy * ow + ox) * c;
      for (let k = 0; k < c; k++) out[o + k] = data[i + k];
    }
  }
  return { data: out, width: ow, height: turns === 2 ? h : w, channels: c };
}

/** Grey image as floats, for the analysis steps. */
export interface GrayMap {
  data: Float32Array;
  width: number;
  height: number;
}

/**
 * Luminance, reduced by averaging whole blocks so the longest side is at most `maxSide`.
 * `scale` is source pixels per output pixel (an integer >= 1).
 */
export function grayDownscale(img: Raster, maxSide: number): GrayMap & { scale: number } {
  const { width: w, height: h, channels: c, data } = img;
  const scale = Math.max(1, Math.ceil(Math.max(w, h) / maxSide));
  const ow = Math.max(1, Math.floor(w / scale));
  const oh = Math.max(1, Math.floor(h / scale));
  const out = new Float32Array(ow * oh);
  const norm = 1 / (scale * scale);
  for (let oy = 0; oy < oh; oy++) {
    for (let dy = 0; dy < scale; dy++) {
      let i = ((oy * scale + dy) * w) * c;
      const row = oy * ow;
      for (let ox = 0; ox < ow; ox++) {
        let sum = 0;
        for (let dx = 0; dx < scale; dx++, i += c) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        out[row + ox] += sum * norm;
      }
    }
  }
  return { data: out, width: ow, height: oh, scale };
}

/** Running maximum (or minimum) over a (2r+1)² window, edges clamped. */
export function extremeFilter(src: Float32Array, width: number, height: number, r: number, max: boolean): Float32Array {
  const pick = max ? Math.max : Math.min;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = src[y * width + x];
      for (let k = Math.max(0, x - r); k <= Math.min(width - 1, x + r); k++) v = pick(v, src[y * width + k]);
      tmp[y * width + x] = v;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = tmp[y * width + x];
      for (let k = Math.max(0, y - r); k <= Math.min(height - 1, y + r); k++) v = pick(v, tmp[k * width + x]);
      out[y * width + x] = v;
    }
  }
  return out;
}

/** Mean over a (2r+1)² window, edges clamped. */
export function boxBlur(src: Float32Array, width: number, height: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = x - r; k <= x + r; k++) sum += src[y * width + Math.min(width - 1, Math.max(0, k))];
      tmp[y * width + x] = sum / (2 * r + 1);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = y - r; k <= y + r; k++) sum += tmp[Math.min(height - 1, Math.max(0, k)) * width + x];
      out[y * width + x] = sum / (2 * r + 1);
    }
  }
  return out;
}
