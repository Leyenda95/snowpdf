import type { PdfBox, Rotation } from "@/model/types";

/**
 * PDF user space (y up) <-> view space (CSS px, y down) for a box shown at a scale and a
 * clockwise rotation. Same maths as pdf.js `PageViewport`, but usable for any box (crops,
 * blank pages) without a loaded page.
 */
export interface ViewTransform {
  /** Size of the box on screen, in CSS px. */
  width: number;
  height: number;
  scale: number;
  rotation: Rotation;
  /** [a, b, c, d, e, f]: view = (a·x + c·y + e, b·x + d·y + f). */
  m: [number, number, number, number, number, number];
  toView(x: number, y: number): { x: number; y: number };
  toUser(vx: number, vy: number): { x: number; y: number };
  /** A view-space displacement as a user-space displacement. */
  deltaToUser(dx: number, dy: number): { x: number; y: number };
}

export function makeViewTransform(box: PdfBox, scale: number, rotation: Rotation): ViewTransform {
  const [x0, y0, x1, y1] = box;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let a: number, b: number, c: number, d: number;
  switch (rotation) {
    case 90:
      [a, b, c, d] = [0, 1, 1, 0];
      break;
    case 180:
      [a, b, c, d] = [-1, 0, 0, 1];
      break;
    case 270:
      [a, b, c, d] = [0, -1, -1, 0];
      break;
    default:
      [a, b, c, d] = [1, 0, 0, -1];
  }
  const swap = a === 0;
  const offX = Math.abs((swap ? cy - y0 : cx - x0) * scale);
  const offY = Math.abs((swap ? cx - x0 : cy - y0) * scale);
  const width = Math.abs((swap ? y1 - y0 : x1 - x0) * scale);
  const height = Math.abs((swap ? x1 - x0 : y1 - y0) * scale);
  const m: ViewTransform["m"] = [
    a * scale,
    b * scale,
    c * scale,
    d * scale,
    offX - a * scale * cx - c * scale * cy,
    offY - b * scale * cx - d * scale * cy,
  ];
  const det = m[0] * m[3] - m[1] * m[2];
  return {
    width,
    height,
    scale,
    rotation,
    m,
    toView: (x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }),
    toUser: (vx, vy) => {
      const px = vx - m[4];
      const py = vy - m[5];
      return { x: (m[3] * px - m[2] * py) / det, y: (-m[1] * px + m[0] * py) / det };
    },
    deltaToUser: (dx, dy) => ({ x: (m[3] * dx - m[2] * dy) / det, y: (-m[1] * dx + m[0] * dy) / det }),
  };
}

/** Clockwise CSS rotation of an object with user-space rotation `rot` on a page shown at R. */
export function cssRotation(pageRotation: Rotation, rot: number): number {
  return pageRotation - rot;
}
