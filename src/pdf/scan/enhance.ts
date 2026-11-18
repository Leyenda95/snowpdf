import type { Raster } from "@/pdf/inpaint";

/*
 * Scan filters: turn a photo of a sheet into something that looks scanned.
 *
 * The model is the usual one: paper reflects light evenly, so a photo is "what is printed" times
 * "how much light falls there". Dividing the photo by the light leaves what is printed, without
 * shadows, uneven lighting or the lamp's tint. The work is measuring the light, and doing it so
 * that a poor photo (out of focus, dark, noisy: what a phone gives indoors) still comes out
 * readable:
 *
 * 1. The light is measured on a coarse grid (about a millimetre of an A4 per cell), from the
 *    cells' means. A morphological closing several millimetres wide then erases everything
 *    thinner than that, which is text, however blurry: the same "dilate, then smooth" background
 *    estimate OpenCV scanners use, at the scale FairScan uses for its smallest kernel (1/50 of
 *    the page). A closing keeps the edge of a shadow where it is. A finer grid would follow the
 *    text itself and divide it away.
 * 2. What survives the closing is light, or print wider than the closing: a logo, a photo, a
 *    filled box. Print is told apart by its colour (not the paper's) or by being far darker than
 *    the page around it, and takes its light from the paper next to it.
 * 3. The light map is nudged towards the dark side of every edge: where it is too low the paper
 *    only gets whiter, where it is too high a grey band appears.
 * 4. The paper's level and its noise are measured on the result. Noisy photos are smoothed where
 *    nothing happens and get a lower white point, so the grain of the paper does not show.
 * 5. Strokes are reinforced with an unsharp mask as wide as a stroke, which gives blurry text its
 *    contrast back, and a tone curve takes paper to white and ink to dark. How dark the ink of
 *    this photo is gets measured too: where it is only a grey (out of focus, pencil) the curve
 *    starts higher, so it still ends up dark. "Color", "Grises" and "B/N" only differ in this
 *    last step; black and white is a soft threshold, so the edges of the strokes stay smooth, and
 *    it takes pale areas of colour for paper (as greys they would come out speckled).
 *
 * Every size is relative to the sheet, so the small copy on screen and the full-size page of the
 * PDF look the same.
 *
 * Known limit: a grey area without colour, lighter than INK_RATIO allows, is taken for shadow and
 * whitened. That is what the "original" filter is for.
 */

export type ScanFilter = "original" | "color" | "gray" | "bw";

export const SCAN_FILTERS: readonly ScanFilter[] = ["original", "color", "gray", "bw"];

/** Cells along the longest side of the light map. */
const GRID = 320;
/** Radius of the closing that erases text, as a fraction of the grid's longest side. */
const TEXT_REACH = 0.014;
/** Radius within which a dark area is compared with the page around it. */
const AREA_REACH = 0.07;
/** A cell this many times darker than the page around it is print, not shadow. */
const INK_RATIO = 1.6;
/** No shadow is this many times darker than the brightest paper. */
const DEEPEST_SHADOW = 3;
/**
 * How far a cell's colour is from the paper's (per channel, relative). An area off by more than
 * TINT_SAME all over is print if some cell in it is off by TINT_OTHER: a shadow's cast stays below
 * the first (about 0.04 in photos), a pale fill reaches the second.
 */
const TINT_SAME = 0.06;
const TINT_OTHER = 0.1;
/** Cells by which the light map is pulled towards the dark side of an edge. */
const EDGE_BIAS = 2;
/** Light is never assumed darker than this, so black areas don't turn into noise. */
const MIN_LIGHT = 32;
/** Resolution of the reflectance values (1.0 = ONE; a byte holds up to 1.275). */
const ONE = 200;
/** Luminance is kept with this many extra steps per level while it is blurred. */
const FINE = 32;
/**
 * Reflectance mapped to black: this fraction of the ink's level, within limits. Ink is what lies
 * below INK_BELOW; its level is that of its darkest tenth, and a sheet with less ink than
 * INK_LEAST of its area has none to speak of.
 */
const BLACK_OF_INK = 0.7;
const BLACK_MIN = 0.14;
const BLACK_MAX = 0.42;
const INK_BELOW = 0.85;
const INK_LEAST = 0.005;
/**
 * Only grey ink is taken for faint black. Ink of a colour (the blue rules of a notebook) is as
 * dark as it should be: up to INK_GREY of saturation it counts as grey, from INK_COLOURED not at all.
 */
const INK_GREY = 0.1;
const INK_COLOURED = 0.3;
/** The curve between black and white (above 1 darkens the mid tones). */
const GAMMA = 1.25;
/** White point: this many times the noise below the paper, within limits. */
const WHITE_NOISE = 3;
const WHITE_MIN = 0.82;
const WHITE_MAX = 0.93;
/** Paper noise (relative) from which the photo is smoothed, and where it is smoothed in full. */
const NOISE_LOW = 0.015;
const NOISE_HIGH = 0.05;
/** How much of the noise is left after the smoothing. */
const NOISE_LEFT = 0.35;
/** In a photo smoothed in full, colour fainter than this many times the noise is dropped. */
const CHROMA_NOISE = 2.5;
/** Unsharp mask: radius as a fraction of the longest side, strength, and the detail ignored. */
const SHARP_REACH = 1 / 500;
const SHARPEN = 1.3;
const SHARP_FLOOR = 0.025;
const SHARP_FLOOR_NOISE = 2;
/** Black-and-white threshold on the reinforced reflectance, and half the width of its grey step. */
const BW_THRESHOLD = 0.74;
const BW_SOFT = 0.12;

/**
 * Running maximum (or minimum) over a (2r+1)² window; what lies outside the map is ignored.
 * One pass along the rows and one along the columns, each in a time that does not depend on r
 * (van Herk's method: maxima running forwards and backwards inside blocks of one window).
 */
function extreme(src: Float32Array, w: number, h: number, r: number, max: boolean): Float32Array {
  const sign = max ? 1 : -1;
  const window = 2 * r + 1;
  const line = new Float32Array(Math.max(w, h) + 2 * r).fill(-Infinity);
  const forward = new Float32Array(line.length);
  const backward = new Float32Array(line.length);
  /** Prepares the maxima of the `n` values at line[r...]: that of window i is max(backward[i], forward[i + 2r]). */
  const run = (n: number) => {
    const total = n + 2 * r;
    for (let i = 0; i < total; i++) {
      const v = line[i];
      forward[i] = i % window === 0 || v > forward[i - 1] ? v : forward[i - 1];
    }
    for (let i = total - 1; i >= 0; i--) {
      const v = line[i];
      backward[i] = i === total - 1 || (i + 1) % window === 0 || v > backward[i + 1] ? v : backward[i + 1];
    }
  };
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) line[r + x] = sign * src[row + x];
    run(w);
    for (let x = 0; x < w; x++) tmp[row + x] = backward[x] > forward[x + 2 * r] ? backward[x] : forward[x + 2 * r];
  }
  line.fill(-Infinity);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) line[r + y] = tmp[y * w + x];
    run(h);
    for (let y = 0; y < h; y++) out[y * w + x] = sign * (backward[y] > forward[y + 2 * r] ? backward[y] : forward[y + 2 * r]);
  }
  return out;
}

/**
 * Erases dark features up to 2r cells wide; the edges of larger ones stay in place. The map is
 * first extended by r cells all around (repeating its border): cut at the border, a slanted
 * shadow edge would come out of the closing a few cells off where it meets it.
 */
function closing(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const pw = w + 2 * r;
  const ph = h + 2 * r;
  const padded = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    const row = Math.min(h - 1, Math.max(0, y - r)) * w;
    for (let x = 0; x < pw; x++) padded[y * pw + x] = src[row + Math.min(w - 1, Math.max(0, x - r))];
  }
  const closed = extreme(extreme(padded, pw, ph, r, true), pw, ph, r, false);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) out.set(closed.subarray((y + r) * pw + r, (y + r) * pw + r + w), y * w);
  return out;
}

/** Mean over the 3×3 cells around each one. */
function smooth(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(w - 1, x + 1);
      let sum = 0;
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) sum += src[yy * w + xx];
      out[y * w + x] = sum / ((y1 - y0 + 1) * (x1 - x0 + 1));
    }
  }
  return out;
}

/** Mean red, green and blue of every cell. */
function cellMeans(img: Raster, cell: number, cols: number, rows: number): Float32Array[] {
  const { width: w, height: h, channels: c, data } = img;
  const means = [0, 1, 2].map(() => new Float32Array(cols * rows));
  const [red, green, blue] = means;
  for (let cy = 0; cy < rows; cy++) {
    const y1 = Math.min(h, (cy + 1) * cell);
    for (let y = cy * cell; y < y1; y++) {
      let i = y * w * c;
      for (let cx = 0; cx < cols; cx++) {
        const x1 = Math.min(w, (cx + 1) * cell);
        let r = 0;
        let g = 0;
        let b = 0;
        for (let x = cx * cell; x < x1; x++, i += c) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
        }
        const k = cy * cols + cx;
        red[k] += r;
        green[k] += g;
        blue[k] += b;
      }
    }
    for (let cx = 0; cx < cols; cx++) {
      const count = (Math.min(w, (cx + 1) * cell) - cx * cell) * (y1 - cy * cell);
      const k = cy * cols + cx;
      red[k] /= count;
      green[k] /= count;
      blue[k] /= count;
    }
  }
  return means;
}

const lumaOf = (r: Float32Array, g: Float32Array, b: Float32Array) => r.map((v, i) => 0.299 * v + 0.587 * g[i] + 0.114 * b[i]);

/** The value below which `fraction` of the entries fall, to within a thousandth of `top` (entries lie in 0..top). */
function quantile(values: Float32Array, fraction: number, top: number): number {
  const bins = 4096;
  const hist = new Uint32Array(bins);
  const k = (bins - 1) / top;
  for (let i = 0; i < values.length; i++) hist[Math.min(bins - 1, Math.max(0, Math.round(values[i] * k)))]++;
  let seen = 0;
  let bin = 0;
  while (bin < bins - 1 && (seen += hist[bin]) <= values.length * fraction) bin++;
  return bin / k;
}

/** Cells of another colour than the paper's (1), as whole areas: see TINT_SAME. */
function tintedCells(colour: Float32Array[], level: Float32Array, tints: number[], cols: number, rows: number): Uint8Array {
  const off = new Float32Array(level.length);
  for (let i = 0; i < off.length; i++) {
    const own = Math.max(1, level[i]);
    for (let k = 0; k < 3; k++) off[i] = Math.max(off[i], Math.abs(colour[k][i] / own - tints[k]) / tints[k]);
  }
  const tinted = new Uint8Array(off.length);
  const todo: number[] = [];
  const take = (i: number) => {
    if (tinted[i] || off[i] <= TINT_SAME) return;
    tinted[i] = 1;
    todo.push(i);
  };
  off.forEach((v, i) => v > TINT_OTHER && take(i));
  for (let i = todo.pop(); i !== undefined; i = todo.pop()) {
    const x = i % cols;
    if (x > 0) take(i - 1);
    if (x < cols - 1) take(i + 1);
    if (i >= cols) take(i - cols);
    if (i < (rows - 1) * cols) take(i + cols);
  }
  return tinted;
}

/**
 * Which cells show bare paper (1) rather than print (0): they are neither far darker than the
 * page around them nor darker than any shadow gets and, when `keepColour` is set, they have the
 * paper's colour.
 */
function paperCells(colour: Float32Array[], level: Float32Array, tints: number[], cols: number, rows: number, keepColour: boolean): Uint8Array {
  const reach = Math.max(1, Math.round(Math.max(cols, rows) * AREA_REACH));
  const around = closing(level, cols, rows, reach);
  const brightest = quantile(level, 0.95, 255);
  const tinted = keepColour ? tintedCells(colour, level, tints, cols, rows) : new Uint8Array(level.length);
  return Uint8Array.from(level, (v, i) => {
    const own = Math.max(1, v);
    return tinted[i] || around[i] > INK_RATIO * own || brightest > DEEPEST_SHADOW * own ? 0 : 1;
  });
}

/** The light everywhere: the paper cells' own level, spreading ring by ring into the rest. */
function spreadPaper(levels: Float32Array[], paper: Uint8Array, cols: number, rows: number): void {
  const [red, green, blue] = levels;
  const known = new Uint8Array(paper);
  let pending: number[] = [];
  for (let i = 0; i < paper.length; i++) if (!paper[i]) pending.push(i);
  // No paper at all: nothing to go by, every cell keeps its own level.
  if (pending.length === paper.length) return;
  while (pending.length > 0) {
    const rest: number[] = [];
    const filled: number[] = [];
    for (const i of pending) {
      const x = i % cols;
      const y = (i - x) / cols;
      const x1 = Math.min(cols - 1, x + 1);
      const y1 = Math.min(rows - 1, y + 1);
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let ny = Math.max(0, y - 1); ny <= y1; ny++) {
        for (let n = ny * cols + Math.max(0, x - 1); n <= ny * cols + x1; n++) {
          if (!known[n]) continue;
          count++;
          r += red[n];
          g += green[n];
          b += blue[n];
        }
      }
      if (count === 0) rest.push(i);
      else {
        red[i] = r / count;
        green[i] = g / count;
        blue[i] = b / count;
        filled.push(i);
      }
    }
    // Known only from the next ring on: a ring is filled from the one before, not from itself.
    for (const i of filled) known[i] = 1;
    pending = rest;
  }
}

interface LightMap {
  /** ONE / light for red, green and blue, per cell: what a pixel is multiplied by. */
  gains: Float32Array[];
  cols: number;
  rows: number;
  cell: number;
}

/**
 * The light on the sheet. Without `keepColour` a pale area of colour counts as paper and turns
 * white, which is what black and white wants (as a grey it would come out speckled).
 */
function estimateLight(img: Raster, keepColour: boolean): LightMap {
  const cell = Math.max(1, Math.round(Math.max(img.width, img.height) / GRID));
  const cols = Math.ceil(img.width / cell);
  const rows = Math.ceil(img.height / cell);
  const reach = Math.max(1, Math.round(Math.max(cols, rows) * TEXT_REACH));
  const colour = cellMeans(img, cell, cols, rows).map((channel) => closing(channel, cols, rows, reach));
  const level = lumaOf(colour[0], colour[1], colour[2]);
  // The paper's colour is its typical cell's, since paper is most of a sheet.
  const tints = colour.map((channel) => quantile(channel.map((v, i) => v / Math.max(1, level[i])), 0.5, 4));
  spreadPaper(colour, paperCells(colour, level, tints, cols, rows, keepColour), cols, rows);
  const gains = colour.map((channel, k) => {
    // Towards the dark side of every edge (see the header), then free of blocks.
    const light = smooth(extreme(channel, cols, rows, EDGE_BIAS, false), cols, rows);
    return light.map((v) => ONE / Math.max(MIN_LIGHT * tints[k], v));
  });
  return { gains, cols, rows, cell };
}

/** Where a pixel coordinate falls between cell centres: lower cell index and blend factor. */
function cellAxis(size: number, cells: number, cell: number): { index: Int32Array; frac: Float32Array } {
  const index = new Int32Array(size);
  const frac = new Float32Array(size);
  for (let p = 0; p < size; p++) {
    const g = Math.min(cells - 1, Math.max(0, (p + 0.5) / cell - 0.5));
    const i = Math.min(Math.max(0, cells - 2), Math.floor(g));
    index[p] = i;
    frac[p] = cells > 1 ? g - i : 0;
  }
  return { index, frac };
}

interface Reflectance {
  /** Photo / light (1.0 = ONE, capped at 255): red, green, blue per pixel. */
  rgb: Uint8Array;
  /**
   * Its luminance, never above the paper's: brighter than paper is paper (glare, or the lit side
   * of a shadow's edge, where the light is taken from the dark side), not an edge to reinforce.
   */
  luma: Uint8Array;
}

/** Divides the photo by the light, interpolated between cells. `scale` corrects the paper's level. */
function reflectance(img: Raster, map: LightMap, scale: number): Reflectance {
  const { width: w, height: h, channels: c, data } = img;
  const { gains, cols, rows, cell } = map;
  const ax = cellAxis(w, cols, cell);
  const ay = cellAxis(h, rows, cell);
  const below = rows > 1 ? cols : 0;
  const rgb = new Uint8Array(w * h * 3);
  const luma = new Uint8Array(w * h);
  // The gains of the current row of pixels, per cell column.
  const line = [0, 1, 2].map(() => new Float32Array(cols + 1));
  for (let y = 0; y < h; y++) {
    const top = ay.index[y] * cols;
    const fy = ay.frac[y];
    for (let k = 0; k < 3; k++) {
      const gain = gains[k];
      const out = line[k];
      for (let x = 0; x < cols; x++) out[x] = (gain[top + x] + (gain[top + below + x] - gain[top + x]) * fy) * scale;
      out[cols] = out[cols - 1];
    }
    const [lr, lg, lb] = line;
    let i = y * w * c;
    let o = y * w * 3;
    for (let x = 0; x < w; x++, i += c, o += 3) {
      const g = ax.index[x];
      const fx = ax.frac[x];
      const r = data[i] * (lr[g] + (lr[g + 1] - lr[g]) * fx);
      const gr = data[i + 1] * (lg[g] + (lg[g + 1] - lg[g]) * fx);
      const b = data[i + 2] * (lb[g] + (lb[g + 1] - lb[g]) * fx);
      rgb[o] = r > 255 ? 255 : r;
      rgb[o + 1] = gr > 255 ? 255 : gr;
      rgb[o + 2] = b > 255 ? 255 : b;
      const l = 0.299 * r + 0.587 * gr + 0.114 * b;
      luma[y * w + x] = l > ONE ? ONE : l;
    }
  }
  return { rgb, luma };
}

/**
 * The sheet as it came out of a first division, from a sample of pixels: the paper's level (the
 * peak of the histogram, which should be 1), its noise (how far above the peak the paper
 * spreads; below it there is ink too), the level of the ink (0 if there is hardly any) and how
 * grey that ink is (1 grey .. 0 clearly coloured). All relative; noise and ink, to the paper's
 * level.
 */
function measurePaper(img: Raster, map: LightMap): { level: number; noise: number; ink: number; grey: number } {
  const { width: w, height: h, channels: c, data } = img;
  const { gains, cols, cell } = map;
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 200000)));
  const hist = new Float64Array(512);
  // Red, green and blue of the pixels at each level, added up (noise cancels out in a sum).
  const colour = [0, 1, 2].map(() => new Float64Array(512));
  for (let y = step >> 1; y < h; y += step) {
    const row = Math.floor(y / cell) * cols;
    for (let x = step >> 1; x < w; x += step) {
      const g = row + Math.floor(x / cell);
      const i = (y * w + x) * c;
      const r = data[i] * gains[0][g];
      const gr = data[i + 1] * gains[1][g];
      const b = data[i + 2] * gains[2][g];
      const bin = Math.min(511, Math.round(0.299 * r + 0.587 * gr + 0.114 * b));
      hist[bin]++;
      colour[0][bin] += r;
      colour[1][bin] += gr;
      colour[2][bin] += b;
    }
  }
  // The peak, on a lightly smoothed histogram, between 0.7 and 1.3.
  let peak = ONE;
  let best = -1;
  for (let v = Math.round(0.7 * ONE); v <= Math.round(1.3 * ONE); v++) {
    const n = hist[v - 2] + 2 * hist[v - 1] + 3 * hist[v] + 2 * hist[v + 1] + hist[v + 2];
    if (n > best) {
      best = n;
      peak = v;
    }
  }
  // Half of a bell curve: 90 % of it lies within 1.645 deviations of the peak. Measured that far
  // out because the darker parts of the sheet, brightened the most, are the noisiest.
  let above = 0;
  for (let v = peak; v < 512; v++) above += hist[v];
  let seen = 0;
  let reach = peak;
  while (reach < 511 && (seen += hist[reach]) < 0.9 * above) reach++;
  // The ink: everything clearly below the paper, and the level its darkest tenth reaches.
  const inkTop = Math.round(INK_BELOW * peak);
  let ink = 0;
  let total = above;
  for (let v = 0; v < peak; v++) {
    total += hist[v];
    if (v < inkTop) ink += hist[v];
  }
  let dark = 0;
  if (ink >= INK_LEAST * total) {
    seen = 0;
    while (dark < inkTop && (seen += hist[dark]) < 0.1 * ink) dark++;
  }
  // The colour of that darkest tenth: how far apart its strongest and weakest channels are.
  const sums = colour.map((channel) => channel.subarray(0, dark + 1).reduce((a, b) => a + b, 0));
  const strongest = Math.max(...sums);
  const saturation = strongest > 0 ? (strongest - Math.min(...sums)) / strongest : 0;
  const grey = clamp01((INK_COLOURED - saturation) / (INK_COLOURED - INK_GREY));
  return { level: peak / ONE, noise: (reach - peak) / (1.645 * peak), ink: dark / peak, grey };
}

/** Blurs along both axes with the weights 1-4-6-4-1: luminance in, FINE times its mean out. */
function soften(src: Uint8Array, w: number, h: number): Uint16Array {
  const tmp = new Uint16Array(w * h);
  const out = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const a = row + (x > 0 ? x - 1 : 0);
      const b = row + (x < w - 1 ? x + 1 : x);
      const aa = row + (x > 1 ? x - 2 : 0);
      const bb = row + (x < w - 2 ? x + 2 : w - 1);
      tmp[row + x] = src[aa] + 4 * (src[a] + src[b]) + 6 * src[row + x] + src[bb];
    }
  }
  const shift = 256 / FINE;
  for (let y = 0; y < h; y++) {
    const a = (y > 0 ? y - 1 : 0) * w;
    const b = (y < h - 1 ? y + 1 : y) * w;
    const aa = (y > 1 ? y - 2 : 0) * w;
    const bb = (y < h - 2 ? y + 2 : h - 1) * w;
    const row = y * w;
    for (let x = 0; x < w; x++) out[row + x] = (tmp[aa + x] + 4 * (tmp[a + x] + tmp[b + x]) + 6 * tmp[row + x] + tmp[bb + x]) / shift;
  }
  return out;
}

/** Mean over a (2r+1)² window, edges clamped. */
function boxBlur(src: Uint16Array, w: number, h: number, r: number): Uint16Array {
  const tmp = new Uint16Array(w * h);
  const out = new Uint16Array(w * h);
  const size = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / size;
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  const sums = new Uint32Array(w);
  for (let k = -r; k <= r; k++) {
    const row = Math.min(h - 1, Math.max(0, k)) * w;
    for (let x = 0; x < w; x++) sums[x] += tmp[row + x];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const add = Math.min(h - 1, y + r + 1) * w;
    const drop = Math.max(0, y - r) * w;
    for (let x = 0; x < w; x++) {
      out[row + x] = sums[x] / size;
      sums[x] += tmp[add + x] - tmp[drop + x];
    }
  }
  return out;
}

/**
 * The luminance with its noise smoothed (as much as `calm` says, 0..1) and its strokes
 * reinforced: an unsharp mask `radius` wide, leaving alone the detail below `floor`. In FINE steps.
 */
function reinforce(luma: Uint8Array, w: number, h: number, calm: number, radius: number, amount: number, floor: number): Int32Array {
  const base = new Uint16Array(w * h);
  if (calm > 0) {
    const soft = soften(luma, w, h);
    for (let i = 0; i < base.length; i++) base[i] = luma[i] * FINE + (soft[i] - luma[i] * FINE) * calm;
  } else for (let i = 0; i < base.length; i++) base[i] = luma[i] * FINE;
  // Two passes of a box are close to a bell: no square halos around the strokes.
  const wide = boxBlur(boxBlur(base, w, h, radius), w, h, radius);
  const out = new Int32Array(w * h);
  const least = floor * ONE * FINE;
  for (let i = 0; i < out.length; i++) {
    const d = base[i] - wide[i];
    out[i] = base[i] + (d > least ? d - least : d < -least ? d + least : 0) * amount;
  }
  return out;
}

/** Reflectance (0..ONE and a bit beyond) to output level. */
function toneCurve(black: number, white: number): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const t = Math.min(1, Math.max(0, (i / ONE - black) / (white - black)));
    lut[i] = Math.round(255 * Math.pow(t, GAMMA));
  }
  return lut;
}

/** A soft step around the threshold: a short ramp of greys keeps the edges of the strokes smooth. */
function stepCurve(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = (255 * (i / ONE - BW_THRESHOLD + BW_SOFT)) / (2 * BW_SOFT);
  return lut;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Applies a scan filter; returns a new raster of the same size and layout. */
export function enhance(img: Raster, filter: ScanFilter): Raster {
  const { width: w, height: h, channels } = img;
  const out = new Uint8ClampedArray(img.data);
  if (filter === "original" || w === 0 || h === 0) return { data: out, width: w, height: h, channels };

  const map = estimateLight(img, filter !== "bw");
  const paper = measurePaper(img, map);
  const { rgb, luma } = reflectance(img, map, 1 / paper.level);

  const calm = clamp01((paper.noise - NOISE_LOW) / (NOISE_HIGH - NOISE_LOW));
  const noise = paper.noise * (1 - (1 - NOISE_LEFT) * calm);
  const radius = Math.max(1, Math.round(Math.max(w, h) * SHARP_REACH));
  const floor = Math.max(SHARP_FLOOR, SHARP_FLOOR_NOISE * noise);
  const strong = reinforce(luma, w, h, calm, radius, SHARPEN, floor);

  const white = Math.min(WHITE_MAX, Math.max(WHITE_MIN, 1 - WHITE_NOISE * noise));
  const black = BLACK_MIN + (Math.min(BLACK_MAX, Math.max(BLACK_MIN, BLACK_OF_INK * paper.ink)) - BLACK_MIN) * paper.grey;
  if (filter === "color") {
    const lut = toneCurve(black, white);
    // In a noisy photo, colour this faint is noise: without it the paper is not speckled.
    const faint = Math.round(CHROMA_NOISE * paper.noise * calm * ONE);
    for (let i = 0, p = 0, o = 0; i < strong.length; i++, p += 3, o += channels) {
      // The same change of luminance for the three channels: the colour stays.
      const y = Math.round(strong[i] / FINE);
      const l = luma[i];
      let r = rgb[p] - l;
      let g = rgb[p + 1] - l;
      let b = rgb[p + 2] - l;
      if (faint > 0) {
        r = r > faint ? r - faint : r < -faint ? r + faint : 0;
        g = g > faint ? g - faint : g < -faint ? g + faint : 0;
        b = b > faint ? b - faint : b < -faint ? b + faint : 0;
      }
      r += y;
      g += y;
      b += y;
      out[o] = lut[r < 0 ? 0 : r > 255 ? 255 : r];
      out[o + 1] = lut[g < 0 ? 0 : g > 255 ? 255 : g];
      out[o + 2] = lut[b < 0 ? 0 : b > 255 ? 255 : b];
    }
  } else {
    const lut = filter === "gray" ? toneCurve(black, white) : stepCurve();
    for (let i = 0, o = 0; i < strong.length; i++, o += channels) {
      const v = Math.round(strong[i] / FINE);
      out[o] = out[o + 1] = out[o + 2] = lut[v < 0 ? 0 : v > 255 ? 255 : v];
    }
  }
  return { data: out, width: w, height: h, channels };
}
