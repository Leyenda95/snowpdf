import type { Raster } from "@/pdf/inpaint";
import { boxBlur, extremeFilter, grayDownscale, type Point, type Quad } from "./raster";

/*
 * Finds the sheet of paper in a photo, to propose the crop corners.
 *
 * The pipeline follows the one Dropbox describes for its scanner (edges -> Hough lines -> every
 * quadrilateral they form, scored by how much edge lies along its perimeter), with classical
 * edges instead of their learned detector:
 *
 *  1. Work on a small grey copy. A morphological closing erases text first: Dropbox notes that
 *     text edges otherwise swamp the sheet's own.
 *  2. Sobel gradient; the strongest pixels are edges.
 *  3. Hough transform. Each edge pixel only votes for lines along its own direction, which keeps
 *     the accumulator clean.
 *  4. The best lines, split into "more horizontal" and "more vertical"; two of each make a quad.
 *     Like OSS Document Scanner's detector, implausible shapes are dropped (too small, too
 *     skewed, not convex) and larger candidates win.
 *  5. The winner's sides are re-fitted to the edge pixels along them (least squares), for
 *     sub-pixel corners.
 *
 * A wrong outline costs more than none: the crop would eat part of the page, while without one
 * the whole photo is kept and the user sets the corners. So a candidate also has to look like
 * paper lying on something, not like a thing printed on the paper (a table with filled rows, a
 * picture, a box): no side of it may be darker inside than outside, and all its sides but one
 * must be clearly lighter inside than what lies beyond them, near and further out. A filled row
 * of a table is darker than the row above it, but beyond it there is paper again.
 *
 * Photos taken from close often leave one edge of the sheet out of the picture. The picture's own
 * border can stand in for one side, never for more: with less than three edges of the sheet in
 * sight there is too little to go by.
 *
 * Everything is tuned on the reduced image, so it behaves the same for any photo size.
 */

const WORK_SIDE = 256;
/** Erases dark strokes up to twice this wide (work pixels). */
const TEXT_RADIUS = 3;
/** Weakest gradient that can be an edge (grey levels per pixel). */
const MIN_EDGE = 8;
/** Edges are at least this fraction of the strong gradients' level (their 99th percentile). */
const EDGE_FRACTION = 0.3;
/** A pixel votes for directions within this many degrees of its own. */
const VOTE_SPREAD = 4;
/** Lines kept per orientation. */
const MAX_LINES = 12;
/** A line needs edge along this fraction of the image's shorter side. */
const MIN_LINE = 0.18;
/** Peaks closer than this are the same line (degrees, pixels). */
const SAME_THETA = 10;
const SAME_RHO = 12;
/** Plausible sheet: share of the image, shortest side, corner angles, edge under its outline. */
const MIN_AREA = 0.1;
const MIN_SIDE = 0.15;
const MAX_CORNER_COS = 0.65;
const MIN_SUPPORT = 0.6;
const MIN_SIDE_SUPPORT = 0.35;
/**
 * Paper against what it lies on: a step of this many grey levels between the inside of the
 * outline, STEP_REACH work pixels from it, and the outside, at that distance and at the ones in
 * BEYOND (as far as the picture goes). A side is lighter inside when the step is there along
 * LIGHTER_SHARE of it, darker inside (at STEP_REACH) along DARKER_SHARE. Sides that may lack the
 * first: one (paper on a surface as light as itself still shows on the sides its shadow falls),
 * none when a side of the outline is the picture's border, which is already a guess.
 */
const MIN_STEP = 8;
const STEP_REACH = 4;
const BEYOND = [10, 20];
const LIGHTER_SHARE = 0.6;
const DARKER_SHARE = 0.4;
const UNCLEAR_SIDES = 1;
/** Sides of the outline that may be the picture's border, and what each costs a candidate. */
const MAX_BORDER_SIDES = 1;
const BORDER_COST = 0.85;
/** Corners may fall this far outside the picture (fraction of its size). */
const OUTSIDE = 0.05;
/** Edge pixels this close to a side count for its fit (work pixels). */
const FIT_DISTANCE = 2.5;

/** x·cos + y·sin = rho. */
interface Line {
  cos: number;
  sin: number;
  rho: number;
}

interface Edges {
  width: number;
  height: number;
  /** Gradient strength where it is an edge, else 0. */
  mag: Float32Array;
  gx: Float32Array;
  gy: Float32Array;
  /** Edge pixels, grown by two pixels (tolerance for the outline check). */
  near: Uint8Array;
}

function findEdges(gray: Float32Array, w: number, h: number): Edges {
  const mag = new Float32Array(w * h);
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const hist = new Uint32Array(1024);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = gray[i - w - 1];
      const b = gray[i - w];
      const c = gray[i - w + 1];
      const d = gray[i - 1];
      const f = gray[i + 1];
      const g = gray[i + w - 1];
      const hh = gray[i + w];
      const k = gray[i + w + 1];
      gx[i] = (c + 2 * f + k - a - 2 * d - g) / 4;
      gy[i] = (g + 2 * hh + k - a - 2 * b - c) / 4;
      mag[i] = Math.hypot(gx[i], gy[i]);
      hist[Math.min(1023, Math.round(mag[i] * 2))]++;
    }
  }
  let rest = Math.round((w - 2) * (h - 2) * 0.01);
  let level = 1023;
  while (level > 0 && (rest -= hist[level]) > 0) level--;
  const threshold = Math.max(MIN_EDGE, (level / 2) * EDGE_FRACTION);
  const mask = new Float32Array(w * h);
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] < threshold) mag[i] = 0;
    else mask[i] = 1;
  }
  const grown = extremeFilter(mask, w, h, 2, true);
  const near = new Uint8Array(w * h);
  for (let i = 0; i < grown.length; i++) near[i] = grown[i] > 0 ? 1 : 0;
  return { width: w, height: h, mag, gx, gy, near };
}

/** Hough accumulator: votes per (theta in degrees, rho + diag). */
interface Votes {
  acc: Uint32Array;
  /** Rho bins per theta. */
  nr: number;
  diag: number;
  cos: Float64Array;
  sin: Float64Array;
}

function houghVotes(e: Edges): Votes {
  const { width: w, height: h } = e;
  const diag = Math.ceil(Math.hypot(w, h));
  const nr = 2 * diag + 1;
  const cos = new Float64Array(180);
  const sin = new Float64Array(180);
  for (let t = 0; t < 180; t++) {
    cos[t] = Math.cos((t * Math.PI) / 180);
    sin[t] = Math.sin((t * Math.PI) / 180);
  }
  const acc = new Uint32Array(180 * nr);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (e.mag[i] === 0) continue;
      // The gradient points across the edge: it is the line's normal.
      const t0 = Math.round((Math.atan2(e.gy[i], e.gx[i]) * 180) / Math.PI);
      for (let dt = -VOTE_SPREAD; dt <= VOTE_SPREAD; dt++) {
        const t = (((t0 + dt) % 180) + 180) % 180;
        acc[t * nr + Math.round(x * cos[t] + y * sin[t]) + diag]++;
      }
    }
  }
  return { acc, nr, diag, cos, sin };
}

/** Forgets a peak and its neighbourhood; (theta, rho) and (theta ± 180, -rho) are the same line. */
function clearPeak(v: Votes, t: number, r: number): void {
  for (let dt = -SAME_THETA; dt <= SAME_THETA; dt++) {
    const wrapped = t + dt < 0 || t + dt >= 180;
    const tt = (t + dt + 180) % 180;
    const centre = (wrapped ? -r : r) + v.diag;
    const from = Math.max(0, centre - SAME_RHO);
    const to = Math.min(v.nr - 1, centre + SAME_RHO);
    if (from <= to) v.acc.fill(0, tt * v.nr + from, tt * v.nr + to + 1);
  }
}

/** The strongest straight lines, as [more horizontal, more vertical]. */
function houghLines(e: Edges): [Line[], Line[]] {
  const v = houghVotes(e);
  const minVotes = MIN_LINE * Math.min(e.width, e.height);
  const horizontal: Line[] = [];
  const vertical: Line[] = [];
  while (horizontal.length < MAX_LINES || vertical.length < MAX_LINES) {
    let at = 0;
    for (let i = 1; i < v.acc.length; i++) if (v.acc[i] > v.acc[at]) at = i;
    if (v.acc[at] < minVotes) break;
    const t = Math.floor(at / v.nr);
    const r = (at % v.nr) - v.diag;
    clearPeak(v, t, r);
    const group = Math.abs(v.sin[t]) >= Math.abs(v.cos[t]) ? horizontal : vertical;
    if (group.length < MAX_LINES) group.push({ cos: v.cos[t], sin: v.sin[t], rho: r });
  }
  return [horizontal, vertical];
}

function intersect(a: Line, b: Line): Point | null {
  const det = a.cos * b.sin - a.sin * b.cos;
  if (Math.abs(det) < 1e-6) return null;
  return { x: (a.rho * b.sin - b.rho * a.sin) / det, y: (a.cos * b.rho - b.cos * a.rho) / det };
}

/** Corners in clockwise order (as seen, y down) starting at the top left; null if not convex. */
function orderQuad(pts: Point[]): Quad | null {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  const cw = area >= 0 ? pts : [pts[0], pts[3], pts[2], pts[1]];
  for (let i = 0; i < 4; i++) {
    const a = cw[i];
    const b = cw[(i + 1) % 4];
    const c = cw[(i + 2) % 4];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0) return null;
  }
  let first = 0;
  for (let i = 1; i < 4; i++) if (cw[i].x + cw[i].y < cw[first].x + cw[first].y) first = i;
  return [cw[first], cw[(first + 1) % 4], cw[(first + 2) % 4], cw[(first + 3) % 4]];
}

function quadArea(q: Quad): number {
  let area = 0;
  for (let i = 0; i < 4; i++) area += q[i].x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * q[i].y;
  return Math.abs(area) / 2;
}

/** Corner `i` is not too sharp or too flat, and the side leaving it is long enough. */
function cornerOk(q: Quad, i: number, minSide: number): boolean {
  const a = q[(i + 3) % 4];
  const b = q[i];
  const c = q[(i + 1) % 4];
  const l1 = Math.hypot(a.x - b.x, a.y - b.y);
  const l2 = Math.hypot(c.x - b.x, c.y - b.y);
  const cos = ((a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y)) / (l1 * l2);
  return l2 >= minSide && Math.abs(cos) <= MAX_CORNER_COS;
}

/** Whether the shape could be a sheet of paper in a photo. */
function plausible(q: Quad, w: number, h: number): boolean {
  const inFrame = (p: Point) => p.x >= -OUTSIDE * w && p.x <= (1 + OUTSIDE) * w && p.y >= -OUTSIDE * h && p.y <= (1 + OUTSIDE) * h;
  if (!q.every(inFrame) || quadArea(q) < MIN_AREA * w * h) return false;
  const minSide = MIN_SIDE * Math.min(w, h);
  return [0, 1, 2, 3].every((i) => cornerOk(q, i, minSide));
}

/** The border of the picture a side runs along, as a line, or null if it runs inside the picture. */
function borderOf(a: Point, b: Point, w: number, h: number): Line | null {
  const at = (u: number, v: number, to: number) => Math.abs(u - to) <= 0.5 && Math.abs(v - to) <= 0.5;
  if (at(a.y, b.y, 0)) return { cos: 0, sin: 1, rho: 0 };
  if (at(a.y, b.y, h - 1)) return { cos: 0, sin: 1, rho: h - 1 };
  if (at(a.x, b.x, 0)) return { cos: 1, sin: 0, rho: 0 };
  if (at(a.x, b.x, w - 1)) return { cos: 1, sin: 0, rho: w - 1 };
  return null;
}

const sidesOf = (q: Quad): [Point, Point][] => [0, 1, 2, 3].map((i) => [q[i], q[(i + 1) % 4]]);

/** How many sides of the outline are the picture's border. */
const borderSides = (q: Quad, w: number, h: number) => sidesOf(q).filter(([a, b]) => borderOf(a, b, w, h)).length;

/**
 * Whether the outline has paper inside and what the paper lies on outside (see MIN_STEP), judged
 * on the sides found in the picture. `gray` is the picture with its text erased.
 */
function looksLikeSheet(q: Quad, gray: Float32Array, w: number, h: number): boolean {
  const at = (x: number, y: number) => {
    const px = Math.round(x);
    const py = Math.round(y);
    return px >= 0 && py >= 0 && px < w && py < h ? gray[py * w + px] : -1;
  };
  let unclear = 0;
  for (const [a, b] of sidesOf(q)) {
    if (borderOf(a, b, w, h)) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    // The outline runs clockwise: the inside is to the right of each side.
    const nx = (-(b.y - a.y) / len) * STEP_REACH;
    const ny = ((b.x - a.x) / len) * STEP_REACH;
    const n = Math.max(2, Math.ceil(len));
    let seen = 0;
    let lighter = 0;
    let darker = 0;
    // Clear of the corners, where the neighbouring side's outside comes in.
    for (let k = Math.ceil(0.1 * n); k <= 0.9 * n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n;
      const y = a.y + ((b.y - a.y) * k) / n;
      const inside = at(x + nx, y + ny);
      const outside = at(x - nx, y - ny);
      if (inside < 0 || outside < 0) continue;
      seen++;
      if (outside - inside >= MIN_STEP) darker++;
      else if (inside - outside >= MIN_STEP) {
        // Still not paper further out (where there is picture left to look at)?
        const paperAgain = BEYOND.some((d) => {
          const far = at(x - (nx * d) / STEP_REACH, y - (ny * d) / STEP_REACH);
          return far >= 0 && inside - far < MIN_STEP;
        });
        if (!paperAgain) lighter++;
      }
    }
    if (darker > DARKER_SHARE * seen) return false;
    // A side hugging the border has nothing beyond it to compare with.
    if (seen < 0.4 * n || lighter < LIGHTER_SHARE * seen) unclear++;
  }
  return unclear <= (borderSides(q, w, h) > 0 ? 0 : UNCLEAR_SIDES);
}

/** Fraction of the outline lying on edges (0 when one side has too little); sides on the picture's border don't count. */
function support(q: Quad, e: Edges): number {
  let hit = 0;
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    if (borderOf(a, b, e.width, e.height)) continue;
    const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    let sideHit = 0;
    for (let s = 0; s < n; s++) {
      const x = Math.round(a.x + ((b.x - a.x) * s) / (n - 1));
      const y = Math.round(a.y + ((b.y - a.y) * s) / (n - 1));
      if (x >= 0 && y >= 0 && x < e.width && y < e.height && e.near[y * e.width + x]) sideHit++;
    }
    if (sideHit < MIN_SIDE_SUPPORT * n) return 0;
    hit += sideHit;
    total += n;
  }
  return total > 0 ? hit / total : 0;
}

/** Least-squares line through the edge pixels along a side (weighted by edge strength). */
function fitSide(a: Point, b: Point, e: Edges): Line | null {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const x0 = Math.max(1, Math.floor(Math.min(a.x, b.x) - FIT_DISTANCE));
  const x1 = Math.min(e.width - 2, Math.ceil(Math.max(a.x, b.x) + FIT_DISTANCE));
  const y0 = Math.max(1, Math.floor(Math.min(a.y, b.y) - FIT_DISTANCE));
  const y1 = Math.min(e.height - 2, Math.ceil(Math.max(a.y, b.y) + FIT_DISTANCE));
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * e.width + x;
      const m = e.mag[i];
      if (m === 0) continue;
      const along = (x - a.x) * ux + (y - a.y) * uy;
      const across = (x - a.x) * -uy + (y - a.y) * ux;
      // Stay clear of the corners, where the neighbouring side's edge bends in.
      if (along < 0.08 * len || along > 0.92 * len || Math.abs(across) > FIT_DISTANCE) continue;
      // Only edges running the same way as the side.
      if (Math.abs(e.gx[i] * ux + e.gy[i] * uy) > 0.5 * m) continue;
      sw += m;
      sx += m * x;
      sy += m * y;
      sxx += m * x * x;
      sxy += m * x * y;
      syy += m * y * y;
    }
  }
  if (sw === 0) return null;
  const mx = sx / sw;
  const my = sy / sw;
  const cxx = sxx / sw - mx * mx;
  const cxy = sxy / sw - mx * my;
  const cyy = syy / sw - my * my;
  // Direction of largest spread; the line's normal is perpendicular to it.
  const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const cos = -Math.sin(angle);
  const sin = Math.cos(angle);
  return { cos, sin, rho: mx * cos + my * sin };
}

function refine(q: Quad, e: Edges): Quad {
  // A side on the picture's border is that border, exactly.
  const sides = sidesOf(q).map(([a, b]) => borderOf(a, b, e.width, e.height) ?? fitSide(a, b, e));
  const out = q.map((p, i) => {
    const before = sides[(i + 3) % 4];
    const after = sides[i];
    const hit = before && after ? intersect(before, after) : null;
    // A fit that moved the corner far away went wrong (e.g. latched onto another edge).
    return hit && Math.hypot(hit.x - p.x, hit.y - p.y) <= 2 * FIT_DISTANCE ? hit : p;
  });
  return out as Quad;
}

/** The quad two "horizontal" and two "vertical" lines enclose, if it could be a sheet. */
function quadOf(h1: Line, h2: Line, v1: Line, v2: Line, e: Edges): Quad | null {
  const pts = [intersect(h1, v1), intersect(h1, v2), intersect(h2, v2), intersect(h2, v1)];
  if (pts.some((p) => !p)) return null;
  const quad = orderQuad(pts as Point[]);
  return quad && plausible(quad, e.width, e.height) ? quad : null;
}

/**
 * The candidate that looks most like the sheet: large, with edge all along its outline and paper
 * inside it. `gray` is the picture with its text erased.
 */
function bestQuad(found: [Line[], Line[]], e: Edges, gray: Float32Array): Quad | null {
  const { width: w, height: h } = e;
  // The picture's own borders are candidates too (see the header).
  const horizontal = [...found[0], { cos: 0, sin: 1, rho: 0 }, { cos: 0, sin: 1, rho: h - 1 }];
  const vertical = [...found[1], { cos: 1, sin: 0, rho: 0 }, { cos: 1, sin: 0, rho: w - 1 }];
  let best: Quad | null = null;
  let bestScore = 0;
  const consider = (quad: Quad | null) => {
    if (!quad) return;
    const borders = borderSides(quad, w, h);
    if (borders > MAX_BORDER_SIDES) return;
    const area = quadArea(quad) * BORDER_COST ** borders;
    // Cheap bound first: the outline checks are the expensive part.
    if (area <= bestScore) return;
    const s = support(quad, e);
    // Bigger is better, but a candidate with gaps in its outline loses quickly.
    const score = area * s ** 4;
    if (s >= MIN_SUPPORT && score > bestScore && looksLikeSheet(quad, gray, w, h)) {
      bestScore = score;
      best = quad;
    }
  };
  for (let i = 0; i < horizontal.length; i++) {
    for (let j = i + 1; j < horizontal.length; j++) {
      for (let k = 0; k < vertical.length; k++) {
        for (let l = k + 1; l < vertical.length; l++) consider(quadOf(horizontal[i], horizontal[j], vertical[k], vertical[l], e));
      }
    }
  }
  return best;
}

/** The sheet's corners in image pixels, or null when no convincing sheet is found. */
export function detectDocument(img: Raster): Quad | null {
  const small = grayDownscale(img, WORK_SIDE);
  const { width: w, height: h, scale } = small;
  if (w < 32 || h < 32) return null;
  const closed = extremeFilter(extremeFilter(small.data, w, h, TEXT_RADIUS, true), w, h, TEXT_RADIUS, false);
  const erased = boxBlur(closed, w, h, 1);
  const edges = findEdges(erased, w, h);
  const best = bestQuad(houghLines(edges), edges, erased);
  if (!best) return null;
  // Work pixel centres back to source pixels.
  return refine(best, edges).map((p) => ({
    x: Math.min(img.width - 1, Math.max(0, (p.x + 0.5) * scale - 0.5)),
    y: Math.min(img.height - 1, Math.max(0, (p.y + 0.5) * scale - 0.5)),
  })) as Quad;
}
