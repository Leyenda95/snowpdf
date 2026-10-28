import { displayRotation, pageBox, type PageRef, type Rotation } from "@/model/types";
import { PDF_TO_CSS } from "@/render/pdfjs";
import { makeViewTransform, type ViewTransform } from "@/render/viewTransform";

export interface PageGeometry {
  /** CSS px per point. */
  scale: number;
  rotation: Rotation;
  /** Visible box (crop) <-> overlay coordinates. */
  visible: ViewTransform;
  /** Full page view <-> pdf.js layer coordinates. */
  full: ViewTransform;
  /** Top-left of the visible box inside the full layers. */
  offsetX: number;
  offsetY: number;
}

export function pageGeometry(page: PageRef, zoom: number): PageGeometry {
  const scale = zoom * PDF_TO_CSS;
  const rotation = displayRotation(page);
  const full = makeViewTransform(page.view, scale, rotation);
  const box = pageBox(page);
  if (box === page.view) return { scale, rotation, visible: full, full, offsetX: 0, offsetY: 0 };
  const visible = makeViewTransform(box, scale, rotation);
  const pts = [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[0], box[3]],
    [box[2], box[3]],
  ].map(([x, y]) => full.toView(x, y));
  return {
    scale,
    rotation,
    visible,
    full,
    offsetX: Math.min(...pts.map((p) => p.x)),
    offsetY: Math.min(...pts.map((p) => p.y)),
  };
}

/** Page size on screen at zoom 1, used for layout and "fit" zoom. */
export function baseSize(page: PageRef): { width: number; height: number } {
  const g = pageGeometry(page, 1);
  return { width: g.visible.width, height: g.visible.height };
}
