import type { Frame, PdfBox } from "@/model/types";

/** Geometry of editor object frames in PDF user space (y up, rot counter-clockwise). */

export type Point = { x: number; y: number };

export function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function rotate(p: Point, deg: number): Point {
  const r = rad(deg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Local frame coordinates (origin at the centre, y up) -> user space. */
export function frameToUser(f: Frame, local: Point): Point {
  const p = rotate(local, f.rot);
  return { x: f.cx + p.x, y: f.cy + p.y };
}

/** User space -> local frame coordinates. */
export function userToFrame(f: Frame, user: Point): Point {
  return rotate({ x: user.x - f.cx, y: user.y - f.cy }, -f.rot);
}

/** Corners: top-left, top-right, bottom-right, bottom-left (in the frame's own orientation). */
export function frameCorners(f: Frame): Point[] {
  const hw = f.w / 2;
  const hh = f.h / 2;
  return [
    { x: -hw, y: hh },
    { x: hw, y: hh },
    { x: hw, y: -hh },
    { x: -hw, y: -hh },
  ].map((p) => frameToUser(f, p));
}

/** Axis-aligned bounding box in user space. */
export function frameBBox(f: Frame): PdfBox {
  const pts = frameCorners(f);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function boxToFrame(box: PdfBox, rot = 0): Frame {
  return { cx: (box[0] + box[2]) / 2, cy: (box[1] + box[3]) / 2, w: Math.abs(box[2] - box[0]), h: Math.abs(box[3] - box[1]), rot };
}

export function boxesIntersect(a: PdfBox, b: PdfBox): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/** Share (0..1) of the area of `b` that `a` covers. */
export function boxOverlapRatio(a: PdfBox, b: PdfBox): number {
  const area = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  if (area <= 0) return 0;
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? (w * h) / area : 0;
}

/**
 * Cut `box` so it does not spill over neighbouring boxes (text lines stacked along the axis
 * perpendicular to the baseline). Each cut lands in the middle of the overlap and never goes
 * past the centre of `box`. Only for upright or quarter-turned text (rot 0/90/180/270);
 * other angles come back unchanged.
 */
export function trimBoxAgainst(box: PdfBox, others: PdfBox[], rot: number): PdfBox {
  const r = ((Math.round(rot) % 360) + 360) % 360;
  if (Math.abs(rot - Math.round(rot)) > 0.5 || r % 90 !== 0) return box;
  // Stacking axis: y (index 1/3) for 0/180, x (index 0/2) for 90/270.
  const lo = r % 180 === 0 ? 1 : 0;
  const hi = lo + 2;
  const sl = 1 - lo; // along-the-line axis
  const out: PdfBox = [...box];
  const centre = (box[lo] + box[hi]) / 2;
  for (const o of others) {
    // Must share extent along the line direction and overlap across the stacking axis.
    if (!(box[sl] < o[sl + 2] && o[sl] < box[sl + 2])) continue;
    const from = Math.max(box[lo], o[lo]);
    const to = Math.min(box[hi], o[hi]);
    if (!(from < to)) continue;
    const mid = (from + to) / 2;
    if ((o[lo] + o[hi]) / 2 > centre) out[hi] = Math.min(out[hi], Math.max(mid, centre));
    else out[lo] = Math.max(out[lo], Math.min(mid, centre));
  }
  return out;
}
