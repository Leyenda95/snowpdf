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
