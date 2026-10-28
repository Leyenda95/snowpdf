import { degrees, rgb, type Color, type PDFFont, type PDFImage, type PDFPage } from "@cantoo/pdf-lib";
import type { Rotation } from "@/model/types";

/**
 * Helpers to place content on a pdf-lib page using *display* coordinates: the page as a
 * viewer shows it (after /Rotate), origin at its bottom-left corner, y up, in points.
 * pdf-lib itself always draws in unrotated user space, so without these helpers a
 * watermark or page number on a rotated page would come out sideways.
 */

export interface DisplayGeometry {
  /** Displayed width and height in points (swapped for 90/270 rotations). */
  width: number;
  height: number;
  /** Clockwise display rotation of the page. */
  rotation: Rotation;
  /** Display point -> user space point. */
  toUser(x: number, y: number): { x: number; y: number };
}

export function normalizeRotation(angle: number): Rotation {
  const a = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  return a as Rotation;
}

export function getDisplayGeometry(page: PDFPage): DisplayGeometry {
  const box = page.getCropBox();
  const x0 = box.x;
  const y0 = box.y;
  const x1 = box.x + box.width;
  const y1 = box.y + box.height;
  const rotation = normalizeRotation(page.getRotation().angle);
  switch (rotation) {
    case 90:
      return { width: box.height, height: box.width, rotation, toUser: (x, y) => ({ x: x1 - y, y: y0 + x }) };
    case 180:
      return { width: box.width, height: box.height, rotation, toUser: (x, y) => ({ x: x1 - x, y: y1 - y }) };
    case 270:
      return { width: box.height, height: box.width, rotation, toUser: (x, y) => ({ x: x0 + y, y: y1 - x }) };
    default:
      return { width: box.width, height: box.height, rotation, toUser: (x, y) => ({ x: x0 + x, y: y0 + y }) };
  }
}

export function hexToColor(hex: string): Color {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function rotateVec(x: number, y: number, deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
}

export interface DisplayTextOptions {
  font: PDFFont;
  size: number;
  color?: string;
  opacity?: number;
  /** Extra counter-clockwise rotation as seen on screen, degrees. */
  angle?: number;
}

/** Draw text whose baseline starts at display point (x, y). */
export function drawTextAt(page: PDFPage, text: string, x: number, y: number, opts: DisplayTextOptions): void {
  const g = getDisplayGeometry(page);
  const angle = opts.angle ?? 0;
  const p = g.toUser(x, y);
  page.drawText(text, {
    x: p.x,
    y: p.y,
    size: opts.size,
    font: opts.font,
    color: hexToColor(opts.color ?? "#000000"),
    opacity: opts.opacity ?? 1,
    rotate: degrees(g.rotation + angle),
  });
}

/** Draw a single line of text centred on display point (cx, cy). */
export function drawTextCentered(page: PDFPage, text: string, cx: number, cy: number, opts: DisplayTextOptions): void {
  const tw = opts.font.widthOfTextAtSize(text, opts.size);
  const th = opts.font.heightAtSize(opts.size, { descender: false });
  const o = rotateVec(-tw / 2, -th / 2, opts.angle ?? 0);
  drawTextAt(page, text, cx + o.x, cy + o.y, opts);
}

export interface DisplayImageOptions {
  opacity?: number;
  /** Counter-clockwise rotation around the box centre, as seen on screen. */
  angle?: number;
}

/** Draw an image filling the display box whose bottom-left corner is (x, y). */
export function drawImageBox(
  page: PDFPage,
  image: PDFImage,
  x: number,
  y: number,
  width: number,
  height: number,
  opts: DisplayImageOptions = {},
): void {
  const g = getDisplayGeometry(page);
  const angle = opts.angle ?? 0;
  const o = rotateVec(-width / 2, -height / 2, angle);
  const p = g.toUser(x + width / 2 + o.x, y + height / 2 + o.y);
  page.drawImage(image, {
    x: p.x,
    y: p.y,
    width,
    height,
    opacity: opts.opacity ?? 1,
    rotate: degrees(g.rotation + angle),
  });
}
