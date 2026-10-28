/**
 * Ink detection and inpainting on plain pixel buffers (used by the "magic eraser" when the
 * content to remove is made of pixels, e.g. text inside a scanned page). Pure TypeScript with no
 * DOM or MuPDF, so it runs in the MuPDF worker and in Node (tests).
 */

/** Tightly packed 8-bit pixels (stride = width * channels). Alpha, when present, is ignored. */
export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  channels: 3 | 4;
}

/** Pixel rectangle, `x1`/`y1` exclusive. */
export interface PixelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type InkPolarity = "dark" | "light";

export interface InkOptions {
  /** Resolution of the raster; sets the stroke thickness the background estimate tolerates. */
  dpi?: number;
  /** Minimum difference to the background (0..255) for a pixel to count as ink. Default 24. */
  threshold?: number;
  /** Zone where ink is looked for (and whose borders define "crossing" components). Default: all. */
  region?: PixelRect;
  /** Dark ink on a light background or the opposite. Default: detected. */
  polarity?: InkPolarity;
  /** Grow the final mask by this many pixels (antialiasing halos). Default 1. */
  dilate?: number;
  /**
   * Also take the soft edges of the ink (scanner blur, JPEG ringing): from the pixels above
   * `threshold`, grow into connected pixels above a much lower, noise-based level, up to
   * about 0.02 in. away. Only for removing ink; `count` is not affected.
   */
  hysteresis?: boolean;
}

export interface InkResult {
  /** 1 = ink. */
  mask: Uint8Array;
  /** Ink pixels before the mask was grown. */
  count: number;
  polarity: InkPolarity;
}

// ---------------------------------------------------------------------------------------------
// Morphology

/** Sliding max/min over a line of `count` samples (window 2r+1, clamped at the ends). */
function slide(src: Uint8Array, dst: Uint8Array, start: number, step: number, count: number, r: number, max: boolean, queue: Int32Array): void {
  let head = 0;
  let tail = 0;
  let next = 0;
  for (let i = 0; i < count; i++) {
    const hi = Math.min(count - 1, i + r);
    while (next <= hi) {
      const v = src[start + next * step];
      while (tail > head) {
        const back = src[start + queue[tail - 1] * step];
        if (max ? back <= v : back >= v) tail--;
        else break;
      }
      queue[tail++] = next++;
    }
    while (queue[head] < i - r) head++;
    dst[start + i * step] = src[start + queue[head] * step];
  }
}

/** Square-window dilation (max) or erosion (min), separable. */
function morph(src: Uint8Array, width: number, height: number, r: number, max: boolean): Uint8Array {
  if (r <= 0) return src.slice();
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  const queue = new Int32Array(Math.max(width, height));
  for (let y = 0; y < height; y++) slide(src, tmp, y * width, 1, width, r, max, queue);
  for (let x = 0; x < width; x++) slide(tmp, out, x, width, height, r, max, queue);
  return out;
}

function grayOf(img: Raster): Uint8Array {
  const { data, width, height, channels } = img;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += channels) gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114 + 500) / 1000;
  return gray;
}

/** How far each pixel is below the closing of `gray` (thin dark features stand out). */
function belowBackground(gray: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const bg = morph(morph(gray, width, height, r, true), width, height, r, false);
  const diff = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) diff[i] = Math.max(0, bg[i] - gray[i]);
  return diff;
}

function above(values: Uint8Array, threshold: number): Uint8Array {
  return values.map((v) => (v > threshold ? 1 : 0));
}

/** Robust standard deviation of the pixel noise of `gray` where `exclude` is 0 (0 when there is too little to tell). */
function grayNoise(gray: Uint8Array, width: number, height: number, exclude: Uint8Array): number {
  const samples: number[] = [];
  const stride = Math.max(1, Math.floor((width * height) / 40000));
  for (let i = 0; i < gray.length; i += stride) {
    const x = i % width;
    const y = (i - x) / width;
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
    let sum = 0;
    let blocked = exclude[i] !== 0;
    for (let dy = -1; dy <= 1 && !blocked; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const j = i + dy * width + dx;
        if (exclude[j]) {
          blocked = true;
          break;
        }
        sum += gray[j];
      }
    }
    if (!blocked) samples.push(Math.abs(gray[i] - sum / 8));
  }
  if (samples.length < 30) return 0;
  samples.sort((a, b) => a - b);
  return (1.4826 * samples[Math.floor(samples.length / 2)]) / Math.sqrt(9 / 8);
}

function hasAny(mask: Uint8Array, width: number, region: PixelRect): boolean {
  for (let y = region.y0; y < region.y1; y++) for (let x = region.x0; x < region.x1; x++) if (mask[y * width + x]) return true;
  return false;
}

/** Median gray level of the region (only where `mask` is set, when given). */
function medianOf(gray: Uint8Array, mask: Uint8Array | null, width: number, region: PixelRect): number {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = region.y0; y < region.y1; y++) {
    for (let x = region.x0; x < region.x1; x++) {
      const i = y * width + x;
      if (mask && !mask[i]) continue;
      hist[gray[i]]++;
      n++;
    }
  }
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc * 2 >= n) return v;
  }
  return 0;
}

function clampRect(rect: PixelRect | undefined, width: number, height: number): PixelRect {
  if (!rect) return { x0: 0, y0: 0, x1: width, y1: height };
  return {
    x0: Math.max(0, Math.min(width, Math.floor(rect.x0))),
    y0: Math.max(0, Math.min(height, Math.floor(rect.y0))),
    x1: Math.max(0, Math.min(width, Math.ceil(rect.x1))),
    y1: Math.max(0, Math.min(height, Math.ceil(rect.y1))),
  };
}

// ---------------------------------------------------------------------------------------------
// Ink mask

/**
 * Find the ink in a region: thin features that differ from the local background (estimated with
 * a morphological closing, so gradients and photos are tolerated). Components that cross the
 * region (table rules, box borders) are not ink.
 */
export function detectInk(img: Raster, opts: InkOptions = {}): InkResult {
  const { width, height } = img;
  const threshold = opts.threshold ?? 24;
  const dpi = opts.dpi ?? 150;
  const r = Math.max(2, Math.round(dpi * 0.04));
  const region = clampRect(opts.region, width, height);
  const gray = grayOf(img);

  const inverted = () => gray.map((v) => 255 - v);
  let polarity = opts.polarity;
  let dark: Uint8Array | null = null;
  let light: Uint8Array | null = null;
  if (!polarity) {
    // Thin dark strokes and the thin bright gaps between them look alike to the closing, so the
    // two readings are told apart by where their pixels lie: real ink is far from the level of
    // the page (the median), the gaps are the page itself.
    dark = belowBackground(gray, width, height, r);
    light = belowBackground(inverted(), width, height, r);
    const page = medianOf(gray, null, width, region);
    const gap = (d: Uint8Array) => {
      const m = above(d, threshold);
      return hasAny(m, width, region) ? Math.abs(medianOf(gray, m, width, region) - page) : 0;
    };
    polarity = gap(light) > gap(dark) ? "light" : "dark";
  }
  const diff = polarity === "dark" ? (dark ?? belowBackground(gray, width, height, r)) : (light ?? belowBackground(inverted(), width, height, r));
  const found = above(diff, threshold);

  // Only the region counts.
  const mask = new Uint8Array(width * height);
  for (let y = region.y0; y < region.y1; y++) mask.set(found.subarray(y * width + region.x0, y * width + region.x1), y * width + region.x0);

  // Components that cross the region are structure of the page, not text.
  const crossingPixels = new Uint8Array(width * height);
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let count = 0;
  for (let y = region.y0; y < region.y1; y++) {
    for (let x = region.x0; x < region.x1; x++) {
      const seed = y * width + x;
      if (!mask[seed] || seen[seed]) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = seed;
      seen[seed] = 1;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      while (head < tail) {
        const p = queue[head++];
        const px = p % width;
        const py = (p - px) / width;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        for (const q of [px > region.x0 ? p - 1 : -1, px < region.x1 - 1 ? p + 1 : -1, py > region.y0 ? p - width : -1, py < region.y1 - 1 ? p + width : -1]) {
          if (q < 0 || !mask[q] || seen[q]) continue;
          seen[q] = 1;
          queue[tail++] = q;
        }
      }
      const left = minX === region.x0;
      const right = maxX === region.x1 - 1;
      const top = minY === region.y0;
      const bottom = maxY === region.y1 - 1;
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const elongated = Math.max(w, h) / Math.min(w, h) > 8;
      const crossing = (left && right) || (top && bottom) || ((left || right || top || bottom) && elongated);
      if (crossing) {
        for (let i = 0; i < tail; i++) {
          mask[queue[i]] = 0;
          crossingPixels[queue[i]] = 1;
        }
      } else count += tail;
    }
  }

  let result = mask;
  if (opts.hysteresis && count > 0) {
    // Soft edges: the noise of the paper far from any ink sets how faint an edge may be.
    const reach = Math.max(1, Math.round(dpi * 0.02));
    const sigma = grayNoise(gray, width, height, morph(mask, width, height, reach + 2, true));
    const low = Math.max(6, 2.5 * sigma);
    result = mask.slice();
    const level = new Uint8Array(width * height);
    const queue2 = new Int32Array(width * height);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < result.length; i++) if (result[i]) queue2[tail++] = i;
    while (head < tail) {
      const p = queue2[head++];
      if (level[p] >= reach) continue;
      const px = p % width;
      const py = (p - px) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const qx = px + dx;
          const qy = py + dy;
          if ((dx === 0 && dy === 0) || qx < 0 || qy < 0 || qx >= width || qy >= height) continue;
          const q = qy * width + qx;
          if (result[q] || crossingPixels[q] || diff[q] <= low) continue;
          result[q] = 1;
          level[q] = level[p] + 1;
          queue2[tail++] = q;
        }
      }
    }
  }
  const grow = opts.dilate ?? 1;
  const out = grow > 0 ? morph(result, width, height, grow, true) : result;
  // A rule that crosses the zone stays, even right next to a letter.
  if (out !== mask) for (let i = 0; i < out.length; i++) if (crossingPixels[i]) out[i] = 0;
  return { mask: out, count, polarity };
}

/** Ink mask of `img` (1 = ink). See {@link detectInk}. */
export function inkMask(img: Raster, opts: InkOptions = {}): Uint8Array {
  return detectInk(img, opts).mask;
}

// ---------------------------------------------------------------------------------------------
// Inpainting

export interface InpaintOptions {
  /** Seed of the grain generator: the same input always gives the same output. */
  seed?: number;
  /** Add the noise of the surrounding paper to the filled pixels. Default true. */
  grain?: boolean;
  /** Smoothing passes over the filled pixels after the pyramid fill. Default 6. */
  smooth?: number;
  /**
   * Width in pixels of the ring around the mask whose pixels are not trusted as background (the
   * last of the ink's soft edge): they are never used to fill, and are blended into the fill
   * with a ramp so there is no seam. Default 2.
   */
  guard?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}

interface Level {
  w: number;
  h: number;
  /** Interleaved RGB. */
  c: Float32Array;
  /** Confidence 0..1. */
  a: Float32Array;
}

/** Push-pull fill: pyramid of averages of the known pixels, then upsampled into the holes. */
function pushPull(img: Raster, mask: Uint8Array): Float32Array | null {
  const { width, height, channels, data } = img;
  const base: Level = { w: width, h: height, c: new Float32Array(width * height * 3), a: new Float32Array(width * height) };
  let known = 0;
  for (let i = 0; i < width * height; i++) {
    if (mask[i]) continue;
    known++;
    base.a[i] = 1;
    base.c[i * 3] = data[i * channels];
    base.c[i * 3 + 1] = data[i * channels + 1];
    base.c[i * 3 + 2] = data[i * channels + 2];
  }
  if (known === 0) return null;

  const levels: Level[] = [base];
  for (;;) {
    const lv = levels[levels.length - 1];
    if (lv.a.every((v) => v > 0) || (lv.w === 1 && lv.h === 1)) break;
    const w = Math.ceil(lv.w / 2);
    const h = Math.ceil(lv.h / 2);
    const next: Level = { w, h, c: new Float32Array(w * h * 3), a: new Float32Array(w * h) };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = x * 2 + dx;
            const sy = y * 2 + dy;
            if (sx >= lv.w || sy >= lv.h) continue;
            const i = sy * lv.w + sx;
            const wt = lv.a[i];
            n++;
            sum += wt;
            r += lv.c[i * 3] * wt;
            g += lv.c[i * 3 + 1] * wt;
            b += lv.c[i * 3 + 2] * wt;
          }
        }
        const o = y * w + x;
        if (sum > 0) {
          next.a[o] = sum / n;
          next.c[o * 3] = r / sum;
          next.c[o * 3 + 1] = g / sum;
          next.c[o * 3 + 2] = b / sum;
        }
      }
    }
    levels.push(next);
  }

  // Push: every level is completed from the one above (bilinear), keeping what it already knew.
  for (let l = levels.length - 2; l >= 0; l--) {
    const fine = levels[l];
    const coarse = levels[l + 1];
    for (let y = 0; y < fine.h; y++) {
      const fy = (y + 0.5) / 2 - 0.5;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const ya = Math.max(0, Math.min(coarse.h - 1, y0));
      const yb = Math.max(0, Math.min(coarse.h - 1, y0 + 1));
      for (let x = 0; x < fine.w; x++) {
        const o = y * fine.w + x;
        const wt = fine.a[o];
        if (wt >= 1) continue;
        const fx = (x + 0.5) / 2 - 0.5;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const xa = Math.max(0, Math.min(coarse.w - 1, x0));
        const xb = Math.max(0, Math.min(coarse.w - 1, x0 + 1));
        for (let k = 0; k < 3; k++) {
          const up =
            (coarse.c[(ya * coarse.w + xa) * 3 + k] * (1 - tx) + coarse.c[(ya * coarse.w + xb) * 3 + k] * tx) * (1 - ty) +
            (coarse.c[(yb * coarse.w + xa) * 3 + k] * (1 - tx) + coarse.c[(yb * coarse.w + xb) * 3 + k] * tx) * ty;
          fine.c[o * 3 + k] = fine.c[o * 3 + k] * wt + up * (1 - wt);
        }
        fine.a[o] = 1;
      }
    }
  }
  return base.c;
}

/**
 * Robust (MAD) standard deviation of the per-pixel noise, per channel, of the paper near the hole
 * (everywhere when there is too little near it). Each pixel is compared with the mean of the
 * window around it, wide enough to see noise that is not white (scanner and JPEG smoothing).
 */
function surroundingNoise(img: Raster, hole: Uint8Array): [number, number, number] {
  const { width, height, channels, data } = img;
  const R = 3;
  const total = width * height;
  const near = morph(hole, width, height, 14, true);
  const measure = (usable: (i: number) => boolean): [number, number, number] | null => {
    const samples: number[][] = [[], [], []];
    const stride = Math.max(1, Math.floor(total / 30000));
    for (let i = 0; i < total; i += stride) {
      if (!usable(i)) continue;
      const x = i % width;
      const y = (i - x) / width;
      if (x < R || y < R || x >= width - R || y >= height - R) continue;
      let blocked = false;
      const sum = [0, 0, 0];
      for (let dy = -R; dy <= R && !blocked; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx === 0 && dy === 0) continue;
          const j = i + dy * width + dx;
          if (hole[j]) {
            blocked = true;
            break;
          }
          for (let k = 0; k < 3; k++) sum[k] += data[j * channels + k];
        }
      }
      if (blocked) continue;
      const n = (2 * R + 1) ** 2 - 1;
      for (let k = 0; k < 3; k++) samples[k].push(Math.abs(data[i * channels + k] - sum[k] / n));
    }
    if (samples[0].length < 30) return null;
    // Residual of a pixel against the mean of its n neighbours has variance sigma^2 * (n + 1) / n.
    const n = (2 * R + 1) ** 2 - 1;
    const sigma = (values: number[]) => {
      values.sort((p, q) => p - q);
      return Math.min(25, (1.4826 * values[Math.floor(values.length / 2)]) / Math.sqrt((n + 1) / n));
    };
    return [sigma(samples[0]), sigma(samples[1]), sigma(samples[2])];
  };
  return measure((i) => near[i] !== 0) ?? measure(() => true) ?? [0, 0, 0];
}

/**
 * Fill the masked pixels (mask = 1) with the surrounding background: smooth fill from the
 * nearest known pixels plus the grain measured around the hole, so a scanned sheet does not
 * look laminated. Only masked pixels change; the input is not modified.
 */
export function inpaint(img: Raster, mask: Uint8Array, opts: InpaintOptions = {}): Raster {
  const { width, height, channels } = img;
  const out: Raster = { data: new Uint8ClampedArray(img.data), width, height, channels };
  let any = false;
  for (let i = 0; i < mask.length && !any; i++) any = mask[i] !== 0;
  if (!any) return out;

  // `weight`: how much of the fill a pixel takes. The mask takes all of it, the guard ring less
  // and less the farther it is from the mask. `holes` = every pixel that is filled.
  const guard = Math.max(0, opts.guard ?? 2);
  const weight = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) weight[i] = mask[i] ? 1 : 0;
  let holes = mask;
  for (let g = 1; g <= guard; g++) {
    const grown = morph(mask, width, height, g, true);
    for (let i = 0; i < grown.length; i++) if (grown[i] && !holes[i]) weight[i] = 1 - g / (guard + 1);
    holes = grown;
  }

  const fill = pushPull(img, holes);
  if (!fill) return out;

  // Smoothing: relax only the filled pixels towards the mean of their neighbours.
  const passes = opts.smooth ?? 6;
  if (passes > 0) {
    let cur: Float32Array = fill;
    let spare: Float32Array = new Float32Array(fill.length);
    for (let p = 0; p < passes; p++) {
      spare.set(cur);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (!holes[i]) continue;
          const l = x > 0 ? i - 1 : i;
          const r = x < width - 1 ? i + 1 : i;
          const u = y > 0 ? i - width : i;
          const d = y < height - 1 ? i + width : i;
          for (let k = 0; k < 3; k++) spare[i * 3 + k] = (cur[l * 3 + k] + cur[r * 3 + k] + cur[u * 3 + k] + cur[d * 3 + k]) / 4;
        }
      }
      [cur, spare] = [spare, cur];
    }
    if (cur !== fill) fill.set(cur);
  }

  // The grain is measured away from the hole and its ring: the ink's halo would inflate it.
  const sigmas = opts.grain === false ? [0, 0, 0] : surroundingNoise(img, holes);
  const noise = gaussian(mulberry32(opts.seed ?? 0x5eed));
  for (let i = 0; i < holes.length; i++) {
    if (!holes[i]) continue;
    const w = weight[i];
    const g = sigmas[0] || sigmas[1] || sigmas[2] ? noise() : 0;
    for (let k = 0; k < 3; k++) {
      const filled = fill[i * 3 + k] + g * sigmas[k];
      out.data[i * channels + k] = Math.round(w * filled + (1 - w) * img.data[i * channels + k]);
    }
  }
  return out;
}
