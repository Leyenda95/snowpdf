import type { PointerEvent as ReactPointerEvent } from "react";
import { breakCoalescing, useDocStore } from "@/model/docStore";
import { updateObject, updateObjects } from "@/model/docActions";
import { newId } from "@/model/registry";
import type { EditorObject, Frame, TextObject } from "@/model/types";
import { layoutText } from "@/pdf/textLayout";
import { cssRotation } from "@/render/viewTransform";
import { frameFromScreenSegment, rotateScreen, segmentEnds } from "../objects";
import type { PageGeometry } from "../viewer/geometry";

/** Pointer-captured drag. Deltas are in overlay px (no CSS scaling is applied to overlays). */
export function drag(
  e: ReactPointerEvent,
  onMove: (dx: number, dy: number, ev: PointerEvent) => void,
  onEnd?: (moved: boolean, ev: PointerEvent) => void,
  threshold = 3,
): void {
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  const sx = e.clientX;
  const sy = e.clientY;
  let moved = false;
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx;
    const dy = ev.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < threshold) return;
    moved = true;
    onMove(dx, dy, ev);
  };
  const up = (ev: PointerEvent) => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    target.removeEventListener("pointercancel", up);
    onEnd?.(moved, ev);
    breakCoalescing();
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", up);
}

function currentFrames(ids: string[]): Map<string, Frame> {
  const map = new Map<string, Frame>();
  for (const o of useDocStore.getState().doc.objects) if (ids.includes(o.id)) map.set(o.id, o.frame);
  return map;
}

export function moveGesture(e: ReactPointerEvent, ids: string[], geom: PageGeometry): void {
  const starts = currentFrames(ids);
  const key = newId("move");
  drag(e, (dx, dy) => {
    const d = geom.visible.deltaToUser(dx, dy);
    updateObjects(
      ids,
      (o) => {
        const s = starts.get(o.id);
        if (s) o.frame = { ...s, cx: s.cx + d.x, cy: s.cy + d.y };
      },
      key,
    );
  });
}

/** hx/hy: -1 left/top, 0 none, 1 right/bottom (in the object's own upright box). */
export interface HandleDir {
  hx: -1 | 0 | 1;
  hy: -1 | 0 | 1;
}

const LOCKED_KINDS = new Set<EditorObject["kind"]>(["image", "symbol", "text"]);

export function resizeGesture(e: ReactPointerEvent, obj: EditorObject, dir: HandleDir, geom: PageGeometry): void {
  const s0 = obj.frame;
  const scale = geom.scale;
  const deg = cssRotation(geom.rotation, s0.rot);
  const w0 = s0.w * scale;
  const h0 = s0.h * scale;
  const key = newId("resize");

  // New box (px) -> frame keeping the opposite edge/corner fixed.
  const place = (W: number, H: number): Frame => {
    const ax = (-dir.hx * w0) / 2;
    const ay = (-dir.hy * h0) / 2;
    const ncx = dir.hx === 0 ? 0 : ax + (dir.hx * W) / 2;
    const ncy = dir.hy === 0 ? 0 : ay + (dir.hy * H) / 2;
    const sv = rotateScreen(ncx, ncy, deg);
    const du = geom.visible.deltaToUser(sv.x, sv.y);
    return { ...s0, cx: s0.cx + du.x, cy: s0.cy + du.y, w: W / scale, h: H / scale };
  };

  drag(e, (dx, dy, ev) => {
    const l = rotateScreen(dx, dy, -deg);
    let W = dir.hx === 0 ? w0 : w0 + dir.hx * l.x;
    let H = dir.hy === 0 ? h0 : h0 + dir.hy * l.y;
    const corner = dir.hx !== 0 && dir.hy !== 0;
    const lock = obj.kind === "text" || (LOCKED_KINDS.has(obj.kind) && corner) !== ev.shiftKey;
    if (lock) {
      const k = Math.max(dir.hx ? W / w0 : 0, dir.hy ? H / h0 : 0);
      W = w0 * k;
      H = h0 * k;
    }
    W = Math.max(W, 4);
    H = Math.max(H, 4);
    if (obj.kind === "text") {
      const size = Math.min(400, Math.max(4, Math.round(obj.size * (H / h0) * 10) / 10));
      const lay = layoutText({ ...(obj as TextObject), size });
      updateObject(obj.id, { size, frame: place(lay.width * scale, lay.height * scale) } as Partial<TextObject>, key);
      return;
    }
    updateObject(obj.id, { frame: place(W, H) }, key);
  });
}

function normalizeDeg(d: number): number {
  return ((d % 360) + 540) % 360 - 180;
}

export function rotateGesture(e: ReactPointerEvent, obj: EditorObject, geom: PageGeometry, overlayEl: HTMLElement): void {
  const c = geom.visible.toView(obj.frame.cx, obj.frame.cy);
  const key = newId("rotate");
  drag(e, (_dx, _dy, ev) => {
    const r = overlayEl.getBoundingClientRect();
    let css = (Math.atan2(ev.clientY - r.top - c.y, ev.clientX - r.left - c.x) * 180) / Math.PI + 90;
    const snapped = Math.round(css / 90) * 90;
    if (ev.shiftKey) css = Math.round(css / 15) * 15;
    else if (Math.abs(css - snapped) < 4) css = snapped;
    updateObject(obj.id, { frame: { ...obj.frame, rot: normalizeDeg(geom.rotation - css) } }, key);
  });
}

export function endpointGesture(e: ReactPointerEvent, obj: EditorObject, which: "start" | "end", geom: PageGeometry): void {
  const [a0, b0] = segmentEnds(obj.frame, geom);
  const moving = which === "start" ? a0 : b0;
  const fixed = which === "start" ? b0 : a0;
  const key = newId("endpoint");
  drag(e, (dx, dy, ev) => {
    let p = { x: moving.x + dx, y: moving.y + dy };
    if (ev.shiftKey) {
      const ang = Math.round(Math.atan2(p.y - fixed.y, p.x - fixed.x) / (Math.PI / 12)) * (Math.PI / 12);
      const len = Math.hypot(p.x - fixed.x, p.y - fixed.y);
      p = { x: fixed.x + Math.cos(ang) * len, y: fixed.y + Math.sin(ang) * len };
    }
    const frame = which === "start" ? frameFromScreenSegment(geom, p, fixed, obj.frame.h) : frameFromScreenSegment(geom, fixed, p, obj.frame.h);
    updateObject(obj.id, { frame }, key);
  });
}
