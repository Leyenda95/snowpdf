import type { CSSProperties } from "react";
import { getFont, newId } from "@/model/registry";
import type { EditorObject, EraseObject, Frame, ImageAsset, PageRef, SymbolName, TextObject } from "@/model/types";
import { displayRotation } from "@/model/types";
import { frameToUser, rotate } from "@/pdf/objectGeometry";
import { TEXT_PADDING, layoutText } from "@/pdf/textLayout";
import { cssRotation } from "@/render/viewTransform";
import type { PageGeometry } from "./viewer/geometry";
import type { ToolStyles } from "./editorStore";
import { intlLocale } from "@/i18n";

/** Absolute CSS box of a frame on its page overlay. */
export function frameStyle(frame: Frame, geom: PageGeometry): CSSProperties {
  const c = geom.visible.toView(frame.cx, frame.cy);
  const w = frame.w * geom.scale;
  const h = frame.h * geom.scale;
  const deg = cssRotation(geom.rotation, frame.rot);
  return {
    position: "absolute",
    left: c.x - w / 2,
    top: c.y - h / 2,
    width: w,
    height: h,
    transform: Math.abs(deg % 360) > 0.01 ? `rotate(${deg}deg)` : undefined,
  };
}

/** Screen-space (overlay px, y down) vector rotated by the CSS angle of a frame. */
export function rotateScreen(x: number, y: number, deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
}

/** Upright frame for an axis-aligned rectangle drawn on screen. */
export function frameFromScreenRect(geom: PageGeometry, x0: number, y0: number, x1: number, y1: number): Frame {
  const c = geom.visible.toUser((x0 + x1) / 2, (y0 + y1) / 2);
  return { cx: c.x, cy: c.y, w: Math.abs(x1 - x0) / geom.scale, h: Math.abs(y1 - y0) / geom.scale, rot: geom.rotation };
}

/** Frame of a segment between two screen points (line/arrow), thickness `h` in points. */
export function frameFromScreenSegment(geom: PageGeometry, a: { x: number; y: number }, b: { x: number; y: number }, h: number): Frame {
  const p = geom.visible.toUser(a.x, a.y);
  const q = geom.visible.toUser(b.x, b.y);
  return {
    cx: (p.x + q.x) / 2,
    cy: (p.y + q.y) / 2,
    w: Math.max(1, Math.hypot(q.x - p.x, q.y - p.y)),
    h,
    rot: (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI,
  };
}

/** End points of a line object on screen. */
export function segmentEnds(frame: Frame, geom: PageGeometry): [{ x: number; y: number }, { x: number; y: number }] {
  const a = frameToUser(frame, { x: -frame.w / 2, y: 0 });
  const b = frameToUser(frame, { x: frame.w / 2, y: 0 });
  return [geom.visible.toView(a.x, a.y), geom.visible.toView(b.x, b.y)];
}

// ------------------------------------------------------------------ text

type TextStyle = ToolStyles["text"];

/** New text box whose top-left corner sits at a screen point, upright on screen. */
export function createText(pageId: string, geom: PageGeometry, at: { x: number; y: number }, style: TextStyle, text = ""): TextObject {
  // The installed family of the previous text, if its regular face is loaded.
  const system = style.systemFont && getFont(style.systemFont) ? style.systemFont : null;
  const base = { text, font: style.font, bold: false, italic: false, size: style.size, lineHeight: 1.2, sourceFont: system, useSourceFont: !!system };
  const lay = layoutText(base);
  const w = lay.width * geom.scale;
  const h = lay.height * geom.scale;
  const c = geom.visible.toUser(at.x + w / 2, at.y + h / 2);
  return {
    id: newId("obj"),
    pageId,
    kind: "text",
    frame: { cx: c.x, cy: c.y, w: lay.width, h: lay.height, rot: geom.rotation },
    opacity: 1,
    color: style.color,
    align: style.align,
    background: null,
    replaces: null,
    justifyWidth: null,
    ...base,
  };
}

/**
 * Apply a change to a text object and refit its box, keeping the anchor edge fixed (left edge
 * for left-aligned text, right edge for right-aligned, centre otherwise; top edge always).
 */
export function refitText(obj: TextObject, patch: Partial<TextObject>): TextObject {
  const next = { ...obj, ...patch };
  const lay = layoutText(next);
  const dw = lay.width - obj.frame.w;
  const dh = lay.height - obj.frame.h;
  const sx = next.align === "left" ? dw / 2 : next.align === "right" ? -dw / 2 : 0;
  const shift = rotate({ x: sx, y: -dh / 2 }, obj.frame.rot);
  return { ...next, frame: { ...obj.frame, cx: obj.frame.cx + shift.x, cy: obj.frame.cy + shift.y, w: lay.width, h: lay.height } };
}

export function formatDate(format: ToolStyles["date"]["format"], d = new Date()): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  if (format === "yyyy-mm-dd") return `${d.getFullYear()}-${mm}-${dd}`;
  if (format === "d de mmmm de yyyy") return d.toLocaleDateString(intlLocale(), { day: "numeric", month: "long", year: "numeric" });
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// ------------------------------------------------------------------ other kinds

export function createShape(
  kind: "rect" | "ellipse" | "whiteout" | "redact" | "highlight",
  pageId: string,
  frame: Frame,
  styles: ToolStyles,
): EditorObject {
  const base = { id: newId("obj"), pageId, frame };
  switch (kind) {
    case "rect":
    case "ellipse":
      return { ...base, kind, opacity: styles.shape.opacity, stroke: styles.shape.stroke, fill: styles.shape.fill, strokeWidth: styles.shape.strokeWidth };
    case "whiteout":
      return { ...base, kind, opacity: 1, color: styles.whiteout.color };
    case "redact":
      return { ...base, kind, opacity: 1, color: styles.redact.color };
    case "highlight":
      return { ...base, kind, opacity: styles.highlight.opacity, color: styles.highlight.color };
  }
}

/** Magic eraser over a frame; the analysis (see erase.ts) fills in the rest. */
export function createEraser(pageId: string, frame: Frame): EraseObject {
  return { id: newId("obj"), pageId, kind: "erase", frame, opacity: 1, method: null, assetId: null, renderBox: null };
}

export function createLine(kind: "line" | "arrow", pageId: string, frame: Frame, styles: ToolStyles): EditorObject {
  const s = styles.line;
  return { id: newId("obj"), pageId, kind, frame: { ...frame, h: Math.max(6, s.strokeWidth * 3) }, opacity: s.opacity, stroke: s.stroke, strokeWidth: s.strokeWidth, dashed: s.dashed };
}

export function createSymbol(pageId: string, geom: PageGeometry, at: { x: number; y: number }, symbol: SymbolName, styles: ToolStyles): EditorObject {
  const c = geom.visible.toUser(at.x, at.y);
  const size = styles.symbol.size;
  return { id: newId("obj"), pageId, kind: "symbol", frame: { cx: c.x, cy: c.y, w: size, h: size, rot: geom.rotation }, opacity: 1, symbol, color: styles.symbol.color };
}

/** Image/signature centred on a screen point, `width` points wide (keeps aspect ratio). */
export function createImage(pageId: string, geom: PageGeometry, at: { x: number; y: number }, asset: ImageAsset, width: number, signature: boolean): EditorObject {
  const c = geom.visible.toUser(at.x, at.y);
  const h = (width * asset.height) / asset.width;
  return { id: newId("obj"), pageId, kind: "image", frame: { cx: c.x, cy: c.y, w: width, h, rot: geom.rotation }, opacity: 1, assetId: asset.id, signature };
}

/** Default placement width for a new image on a page. */
export function defaultImageWidth(page: PageRef, asset: ImageAsset, signature: boolean): number {
  const [x0, y0, x1, y1] = page.crop ?? page.view;
  const pageW = displayRotation(page) % 180 === 0 ? x1 - x0 : y1 - y0;
  if (signature) return Math.min(170, pageW * 0.35);
  return Math.min(asset.width * 0.75, pageW * 0.5);
}

/** Text box top-left, in screen coordinates, used when re-anchoring after edits. */
export function textTopLeft(obj: TextObject, geom: PageGeometry): { x: number; y: number } {
  const p = frameToUser(obj.frame, { x: -obj.frame.w / 2 + TEXT_PADDING * 0, y: obj.frame.h / 2 });
  return geom.visible.toView(p.x, p.y);
}
