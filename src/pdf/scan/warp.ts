import type { Raster } from "@/pdf/inpaint";
import type { Point, Quad } from "./raster";

/* Perspective correction: the sheet's four corners become the corners of an upright rectangle. */

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Size of the straightened sheet: its longer top/bottom and left/right sides (what you would
 * measure on the photo), scaled down so the longest side is at most `maxSide`.
 */
export function warpSize(quad: Quad, maxSide: number): { width: number; height: number } {
  const [tl, tr, br, bl] = quad;
  // Corners are pixel centres: a side from pixel 0 to pixel 9 is 10 pixels long.
  const w = Math.max(dist(tl, tr), dist(bl, br)) + 1;
  const h = Math.max(dist(tl, bl), dist(tr, br)) + 1;
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Brings the row with the largest value in `col` up to the diagonal; false if the column is empty. */
function pivot(a: number[][], b: number[], col: number): boolean {
  let best = col;
  for (let r = col + 1; r < b.length; r++) if (Math.abs(a[r][col]) > Math.abs(a[best][col])) best = r;
  if (Math.abs(a[best][col]) < 1e-12) return false;
  [a[col], a[best]] = [a[best], a[col]];
  [b[col], b[best]] = [b[best], b[col]];
  return true;
}

/** Solves A·x = b in place (Gaussian elimination with partial pivoting); null if singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    if (!pivot(a, b, col)) return null;
    for (let r = col + 1; r < n; r++) {
      const f = a[r][col] / a[col][col];
      for (let k = col; k < n; k++) a[r][k] -= f * a[col][k];
      b[r] -= f * b[col];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r];
    for (let k = r + 1; k < n; k++) sum -= a[r][k] * x[k];
    x[r] = sum / a[r][r];
  }
  return x;
}

/**
 * Homography taking `from[i]` to `to[i]`, as [a, b, c, d, e, f, g, h]:
 * x' = (a·x + b·y + c) / (g·x + h·y + 1), y' = (d·x + e·y + f) / (g·x + h·y + 1).
 */
export function homography(from: Quad, to: Quad): number[] | null {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return solve(a, b);
}

/** The part of the picture inside `quad`, straightened (bilinear sampling). */
export function warpQuad(img: Raster, quad: Quad, maxSide: number): Raster {
  const { width, height } = warpSize(quad, maxSide);
  const { width: sw, height: sh, channels: c, data } = img;
  const out = new Uint8ClampedArray(width * height * c);
  // Output pixel centres span the sheet corner to corner.
  const rect: Quad = [
    { x: 0, y: 0 },
    { x: Math.max(1, width - 1), y: 0 },
    { x: Math.max(1, width - 1), y: Math.max(1, height - 1) },
    { x: 0, y: Math.max(1, height - 1) },
  ];
  const m = homography(rect, quad);
  if (!m) return { data: out, width, height, channels: c };
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const d = m[6] * u + m[7] * v + 1;
      const sx = Math.min(sw - 1, Math.max(0, (m[0] * u + m[1] * v + m[2]) / d));
      const sy = Math.min(sh - 1, Math.max(0, (m[3] * u + m[4] * v + m[5]) / d));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * sw + x0) * c;
      const i10 = (y0 * sw + x1) * c;
      const i01 = (y1 * sw + x0) * c;
      const i11 = (y1 * sw + x1) * c;
      const o = (v * width + u) * c;
      for (let k = 0; k < c; k++) {
        const top = data[i00 + k] + (data[i10 + k] - data[i00 + k]) * fx;
        const bottom = data[i01 + k] + (data[i11 + k] - data[i01 + k]) * fx;
        out[o + k] = top + (bottom - top) * fy;
      }
    }
  }
  return { data: out, width, height, channels: c };
}
