import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useDocStore } from "@/model/docStore";
import type { PageRef } from "@/model/types";
import { MAX_ZOOM, MIN_ZOOM, useEditorStore } from "../editorStore";
import { baseSize, type PageGeometry } from "./geometry";
import { PageView } from "./PageView";
import { notifyViewerScroll, viewerZoom } from "./viewerScroll";
import { clearTouchSelection, useTouchSelection } from "../touchSelection";

const PAD = 24;

/** Phone layout: the viewer is full-bleed under floating bars, so it pads its content instead. */
export interface ViewerInsets {
  /** Room for the floating header (px). */
  top: number;
  /** Room for the floating toolbar (px, the safe-area is added on top). */
  bottom: number;
  /** Side padding (px). */
  x: number;
  /** Gap between pages (px). */
  gap: number;
}

/**
 * Header 3rem + toolbar 3.5rem plus a little air; a phone on its side (short viewport) gets slimmer
 * bars: 2.5rem + 3rem. The bars are sized in rem, which follows the Android font size (index.html).
 */
export function phoneInsets(short: boolean): ViewerInsets {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return short
    ? { top: Math.round(2.5 * rem) + 8, bottom: Math.round(3 * rem) + 8, x: 6, gap: 8 }
    : { top: Math.round(3 * rem) + 8, bottom: Math.round(3.5 * rem) + 8, x: 6, gap: 8 };
}
export const SHORT_QUERY = "(max-height: 480px)";

/** Interactive things a tap must leave alone (links, form fields, objects and their handles). */
export const TAP_EXCLUDED =
  "a,button,input,textarea,select,label,[contenteditable],[data-object-id],[data-handle],[data-link],.annotationLayer section,.annotationLayer a";

interface ViewerProps {
  overlay: (page: PageRef, index: number, geom: PageGeometry) => ReactNode;
  underlay?: (page: PageRef, geom: PageGeometry) => ReactNode;
  textInteractive: boolean;
  formsInteractive: boolean;
  onOpenExternal: (url: string) => void;
  className?: string;
  /** Phone layout (see `ViewerInsets`): enables taps, double-tap zoom and overlay-bar padding. */
  insets?: ViewerInsets;
  /** Phone: a single tap that nothing else claimed (toggles immersive mode). */
  onTap?: () => void;
}

/**
 * Pending scroll correction so a zoom keeps the point under the cursor/finger fixed. The point is
 * stored relative to the page under it (index + fraction of its box): padding and gaps between
 * pages don't scale with the zoom, so a plain "scroll * ratio" would drift by tens of pixels.
 */
interface Anchor {
  /** Page slot under the point, or null (fall back to scaling the scroll offsets). */
  index: number | null;
  fx: number;
  fy: number;
  /** The point, relative to the viewer's top-left corner. */
  sx: number;
  sy: number;
  ratio: number;
}

let anchorRequest: Anchor | null = null;

/** After the next zoom commit, animate from how this page looked before (FLIP). */
let flipRequest: { index: number; rect: DOMRect } | null = null;

/** Like AndroidPdfViewer (MJ PDF): 400 ms with Android's DecelerateInterpolator (ease-out quad). */
const ZOOM_ANIM_MS = 380;
const ZOOM_EASE = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";
/** Double-tap zoom, relative to fit width (AndroidPdfViewer's mid zoom). */
const DOUBLE_TAP_ZOOM = 1.75;
/**
 * While a zoom animates, the text/annotation layers are hidden (thousands of spans to scale for
 * nothing): only the bitmaps move, as in GrapheneOS's pdf.js viewer.
 */
const ZOOMING_CLASS = "snow-zooming";

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Page slot under a client y (or the vertically nearest one). */
function slotAt(el: HTMLElement, y: number): { slot: HTMLElement; rect: DOMRect } | null {
  let best: { slot: HTMLElement; rect: DOMRect; d: number } | null = null;
  for (const slot of el.querySelectorAll<HTMLElement>("[data-slot-index]")) {
    const rect = slot.getBoundingClientRect();
    if (rect.height <= 0) continue;
    const d = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    if (!best || d < best.d) best = { slot, rect, d };
    if (d === 0) break;
  }
  return best && { slot: best.slot, rect: best.rect };
}

function anchorAt(el: HTMLElement, x: number, y: number, ratio: number): Anchor {
  const view = el.getBoundingClientRect();
  const hit = slotAt(el, y);
  return {
    index: hit ? Number(hit.slot.dataset.slotIndex) : null,
    fx: hit ? (x - hit.rect.left) / hit.rect.width : 0,
    fy: hit ? (y - hit.rect.top) / hit.rect.height : 0,
    sx: x - view.left,
    sy: y - view.top,
    ratio,
  };
}

/** Keeps a page position (page index + fraction of its height at the top line) across a re-fit. */
let refitRequest: { index: number; frac: number } | null = null;

function captureRefit(el: HTMLElement, top: number): void {
  const line = el.getBoundingClientRect().top + top;
  for (const slot of el.querySelectorAll<HTMLElement>("[data-slot-index]")) {
    const r = slot.getBoundingClientRect();
    if (r.bottom > line && r.height > 0) {
      refitRequest = { index: Number(slot.dataset.slotIndex), frac: (line - r.top) / r.height };
      return;
    }
  }
}

function fitZoomFor(el: HTMLElement, pages: PageRef[], fit: "width" | "page", currentPage: number, insets?: ViewerInsets): number {
  const sizes = pages.map(baseSize);
  const maxW = Math.max(...sizes.map((s) => s.width));
  const cur = sizes[Math.min(currentPage, sizes.length - 1)];
  // Phone scrollbars overlay the content, so nothing is reserved for them there.
  const availW = el.clientWidth - (insets ? insets.x * 2 : PAD * 2 + 16);
  const availH = el.clientHeight - (insets ? insets.top + insets.bottom : PAD * 2);
  return fit === "width" ? Math.min(availW / maxW, 2) : Math.min(availW / cur.width, availH / cur.height);
}

/** Zoom around a point of the viewer (client coordinates), or its centre. */
export function zoomViewerTo(next: number, client?: { x: number; y: number }, fit: "width" | "page" | null = null): void {
  const el = document.querySelector<HTMLElement>("[data-viewer-scroll]");
  const { zoom, setZoom } = useEditorStore.getState();
  const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
  if (el) {
    const r = el.getBoundingClientRect();
    anchorRequest = anchorAt(el, client?.x ?? r.left + r.width / 2, client?.y ?? r.top + r.height / 2, target / zoom);
  }
  setZoom(target, fit);
}

export function Viewer({ overlay, underlay, textInteractive, formsInteractive, onOpenExternal, className, insets, onTap }: ViewerProps) {
  const pages = useDocStore((s) => s.doc.pages);
  const zoom = useEditorStore((s) => s.zoom);
  const fit = useEditorStore((s) => s.fit);
  const scrollRequest = useEditorStore((s) => s.scrollRequest);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState<ReadonlySet<string>>(new Set());
  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set());
  const insetsRef = useRef(insets);
  insetsRef.current = insets;
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const phone = !!insets;
  const phoneRef = useRef(phone);
  phoneRef.current = phone;

  // Fit modes follow the container size.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !fit || pages.length === 0) return;
    let initial = true;
    const apply = () => {
      const { currentPage } = useEditorStore.getState();
      const z = fitZoomFor(el, pages, fit, currentPage, insetsRef.current);
      const s = useEditorStore.getState();
      if (Math.abs(s.zoom - z) > 0.001) {
        // Phone rotation: stay on the same part of the same page after the re-fit.
        if (insetsRef.current && !initial) captureRefit(el, insetsRef.current.top);
        s.setZoom(z, fit);
      }
      initial = false;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, pages]);

  // Keep the anchor point fixed after a zoom, then play a pending FLIP animation.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    const a = anchorRequest;
    anchorRequest = null;
    const flip = flipRequest;
    flipRequest = null;
    if (!el || !content) return;
    if (a) {
      const slot = a.index === null ? null : el.querySelector<HTMLElement>(`[data-slot-index="${a.index}"]`);
      if (slot) {
        const view = el.getBoundingClientRect();
        const r = slot.getBoundingClientRect();
        el.scrollLeft += r.left + a.fx * r.width - (view.left + a.sx);
        el.scrollTop += r.top + a.fy * r.height - (view.top + a.sy);
      } else {
        el.scrollLeft = (el.scrollLeft + a.sx) * a.ratio - a.sx;
        el.scrollTop = (el.scrollTop + a.sy) * a.ratio - a.sy;
      }
    }
    const slot = flip && el.querySelector<HTMLElement>(`[data-slot-index="${flip.index}"]`);
    if (!flip || !slot) return;
    // Start drawn exactly as before (the new layout scaled back), then ease into the new layout.
    // Only used when zooming out: the inverse transform enlarges, so the scroll range never shrinks.
    const r1 = slot.getBoundingClientRect();
    const c = content.getBoundingClientRect();
    const k = flip.rect.width / r1.width;
    const tx = flip.rect.left - c.left - k * (r1.left - c.left);
    const ty = flip.rect.top - c.top - k * (r1.top - c.top);
    content.style.transition = "none";
    content.style.transformOrigin = "0 0";
    content.style.willChange = "transform";
    content.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
    content.classList.add(ZOOMING_CLASS);
    void content.offsetWidth;
    viewerZoom.animating = true;
    content.style.transition = `transform ${ZOOM_ANIM_MS}ms ${ZOOM_EASE}`;
    content.style.transform = "";
    const end = () => {
      content.style.transition = "";
      content.style.transformOrigin = "";
      content.style.willChange = "";
      content.classList.remove(ZOOMING_CLASS);
      viewerZoom.animating = false;
    };
    const timer = setTimeout(end, ZOOM_ANIM_MS + 30);
    // Another zoom before it finished: leave no transition behind for it.
    return () => {
      clearTimeout(timer);
      end();
    };
  }, [zoom]);

  // Re-fit with a remembered page position (rotation, double-tap back to fit width).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const r = refitRequest;
    refitRequest = null;
    const slot = r && el?.querySelector<HTMLElement>(`[data-slot-index="${r.index}"]`);
    if (!el || !r || !slot) return;
    el.scrollTop = slot.offsetTop + r.frac * slot.offsetHeight - (insetsRef.current?.top ?? 0);
  }, [zoom]);

  // Ctrl + wheel zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const z = useEditorStore.getState().zoom;
      zoomViewerTo(z * Math.exp(-e.deltaY * 0.0018), { x: e.clientX, y: e.clientY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Two-finger pinch zoom (touch only). While the fingers move, the content is only scaled with a
  // CSS transform (cheap); the real zoom is committed once, when the pinch ends.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const touchPointers = new Set<number>();
    /** `ox, oy`: transform origin in content px (the content point kept under the fingers). */
    let pinch: { d0: number; mx0: number; my0: number; z0: number; sl0: number; st0: number; s: number; ox: number; oy: number } | null = null;

    const mid = (e: TouchEvent) => {
      const a = e.touches[0];
      const b = e.touches[1];
      return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, d: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)) };
    };
    const reset = () => {
      content.style.transform = "";
      content.style.transformOrigin = "";
      content.style.willChange = "";
      content.classList.remove(ZOOMING_CLASS);
    };

    // Pointer events: keep the page overlays (drawing, moving objects) from seeing the second finger.
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      touchPointers.add(e.pointerId);
      if (touchPointers.size >= 2) e.stopPropagation();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" && (pinch || touchPointers.size >= 2)) e.stopPropagation();
    };
    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerType === "touch") touchPointers.delete(e.pointerId);
    };

    // Touch events keep firing while the browser pans natively (pointer events get cancelled then).
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinch || viewerZoom.animating) return;
      const m = mid(e);
      const r = el.getBoundingClientRect();
      const ox = el.scrollLeft + m.x - r.left;
      const oy = el.scrollTop + m.y - r.top;
      pinch = { d0: m.d, mx0: m.x, my0: m.y, z0: useEditorStore.getState().zoom, sl0: el.scrollLeft, st0: el.scrollTop, s: 1, ox, oy };
      content.style.transformOrigin = `${ox}px ${oy}px`;
      content.style.willChange = "transform";
      content.classList.add(ZOOMING_CLASS);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length < 2) return;
      const m = mid(e);
      const s = Math.min(MAX_ZOOM / pinch.z0, Math.max(MIN_ZOOM / pinch.z0, m.d / pinch.d0));
      pinch.s = s;
      content.style.transform = `scale(${s})`;
      if (e.cancelable) {
        // Otherwise the browser is already panning with the fingers' midpoint on its own.
        e.preventDefault();
        el.scrollLeft = pinch.sl0 - (m.x - pinch.mx0);
        el.scrollTop = pinch.st0 - (m.y - pinch.my0);
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!pinch || e.touches.length >= 2) return;
      const p = pinch;
      pinch = null;
      reset();
      if (Math.abs(p.s - 1) <= 0.005) return;
      // The scaled preview keeps the transform origin fixed while panning only moves the scroll,
      // so anchoring the real zoom at the origin's current screen position lands on the same view.
      const r = el.getBoundingClientRect();
      zoomViewerTo(p.z0 * p.s, { x: r.left + p.ox - el.scrollLeft, y: r.top + p.oy - el.scrollTop });
    };

    el.addEventListener("pointerdown", onPointerDown, true);
    el.addEventListener("pointermove", onPointerMove, true);
    el.addEventListener("pointerup", onPointerEnd, true);
    el.addEventListener("pointercancel", onPointerEnd, true);
    el.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    el.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    el.addEventListener("touchend", onTouchEnd, true);
    el.addEventListener("touchcancel", onTouchEnd, true);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown, true);
      el.removeEventListener("pointermove", onPointerMove, true);
      el.removeEventListener("pointerup", onPointerEnd, true);
      el.removeEventListener("pointercancel", onPointerEnd, true);
      el.removeEventListener("touchstart", onTouchStart, true);
      el.removeEventListener("touchmove", onTouchMove, true);
      el.removeEventListener("touchend", onTouchEnd, true);
      el.removeEventListener("touchcancel", onTouchEnd, true);
      reset();
    };
  }, []);

  // Phone taps: single tap (immersive toggle) and double tap (zoom between fit width and DOUBLE_TAP_ZOOM times it).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !phone) return;
    // Android's own gesture constants: double-tap timeout 300 ms, double-tap slop ~100 dp.
    const TAP_MS = 350;
    const TAP_PX = 10;
    const DOUBLE_MS = 300;
    const DOUBLE_PX = 80;
    const active = new Set<number>();
    let down: { id: number; x: number; y: number; t: number; blocked: boolean; clearsSelection: boolean } | null = null;
    let first: { x: number; y: number; t: number; timer: ReturnType<typeof setTimeout> } | null = null;
    let suppressTouchEnd = false;

    const idle = () => {
      const s = useEditorStore.getState();
      return (s.tool === "select" || s.tool === "hand") && !s.placing && !s.editingId;
    };
    const flushFirst = () => {
      if (!first) return;
      clearTimeout(first.timer);
      first = null;
      onTapRef.current?.();
    };

    const doubleTap = (x: number, y: number) => {
      const s = useEditorStore.getState();
      const content = contentRef.current;
      const fz = fitZoomFor(el, useDocStore.getState().doc.pages, "width", s.currentPage, insetsRef.current);
      // Two states only, like Google Drive: at (or below) fit width a double tap zooms in; zoomed in
      // by any amount (double tap or pinch), it goes back to fit width.
      const zoomIn = s.zoom <= fz * 1.05;
      const z1 = zoomIn ? Math.min(MAX_ZOOM, fz * DOUBLE_TAP_ZOOM) : fz;
      const animate = !!content && !prefersReducedMotion();
      if (!zoomIn) {
        // Back to fit width: commit first, then FLIP from the zoomed look (see the zoom layout effect).
        const hit = animate ? slotAt(el, y) : null;
        if (hit) flipRequest = { index: Number(hit.slot.dataset.slotIndex), rect: hit.rect };
        zoomViewerTo(fz, { x, y }, "width");
        return;
      }
      if (!content || !animate) {
        zoomViewerTo(z1, { x, y });
        return;
      }
      // Zoom in: scale the current layout up around the finger (it only grows, so the scroll range
      // can't clamp), then commit the real zoom anchored at the same point, like a pinch.
      const k = z1 / s.zoom;
      const r = el.getBoundingClientRect();
      const ox = el.scrollLeft + x - r.left;
      const oy = el.scrollTop + y - r.top;
      viewerZoom.animating = true;
      content.style.transition = "none";
      content.style.transformOrigin = `${ox}px ${oy}px`;
      content.style.willChange = "transform";
      content.classList.add(ZOOMING_CLASS);
      void content.offsetWidth;
      content.style.transition = `transform ${ZOOM_ANIM_MS}ms ${ZOOM_EASE}`;
      content.style.transform = `scale(${k})`;
      setTimeout(() => {
        content.style.transition = "none";
        content.style.transform = "";
        content.style.transformOrigin = "";
        content.style.willChange = "";
        viewerZoom.animating = false;
        // The viewer went away meanwhile (tab switched, document closed): nothing to zoom.
        if (!el.isConnected) return;
        zoomViewerTo(z1, { x: r.left + ox - el.scrollLeft, y: r.top + oy - el.scrollTop });
        requestAnimationFrame(() => {
          content.style.transition = "";
          content.classList.remove(ZOOMING_CLASS);
        });
      }, ZOOM_ANIM_MS);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      active.add(e.pointerId);
      if (active.size > 1) {
        down = null;
        return;
      }
      const sel = window.getSelection();
      const target = e.target instanceof Element ? e.target : null;
      // An active touch text selection behaves like a window selection: a tap only clears it.
      const clearsSelection = !!useTouchSelection.getState().sel && !target?.closest("[data-handle]");
      // A tap that clears an object selection only deselects (EditorPage handles it on pointerdown, after this).
      const blocked =
        viewerZoom.animating ||
        !idle() || !!target?.closest(TAP_EXCLUDED) || useEditorStore.getState().selection.length > 0 || (!!sel && !sel.isCollapsed) || clearsSelection;
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), blocked, clearsSelection };
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      active.delete(e.pointerId);
      const d = down;
      if (!d || d.id !== e.pointerId) return;
      down = null;
      const now = performance.now();
      if (d.clearsSelection && now - d.t <= TAP_MS && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= TAP_PX) clearTouchSelection();
      if (d.blocked || now - d.t > TAP_MS || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_PX) return;
      if (first && d.t - first.t < DOUBLE_MS && Math.hypot(e.clientX - first.x, e.clientY - first.y) < DOUBLE_PX) {
        clearTimeout(first.timer);
        first = null;
        suppressTouchEnd = true;
        doubleTap(e.clientX, e.clientY);
        return;
      }
      flushFirst();
      first = { x: e.clientX, y: e.clientY, t: now, timer: setTimeout(flushFirst, DOUBLE_MS) };
    };
    const onCancel = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      active.delete(e.pointerId);
      down = null;
    };
    // Keep the browser from treating the second tap as a click / word selection.
    const onTouchEnd = (e: TouchEvent) => {
      if (!suppressTouchEnd) return;
      suppressTouchEnd = false;
      if (e.cancelable) e.preventDefault();
    };

    el.addEventListener("pointerdown", onDown, true);
    el.addEventListener("pointerup", onUp, true);
    el.addEventListener("pointercancel", onCancel, true);
    el.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("pointerup", onUp, true);
      el.removeEventListener("pointercancel", onCancel, true);
      el.removeEventListener("touchend", onTouchEnd, true);
      if (first) clearTimeout(first.timer);
    };
  }, [phone]);

  // Which pages are near (render) and in view (render first).
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const track = (setter: typeof setNear) => (entries: IntersectionObserverEntry[]) =>
      setter((prev) => {
        const next = new Set(prev);
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.slotId!;
          if (e.isIntersecting) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    const nearObs = new IntersectionObserver(track(setNear), { root, rootMargin: phoneRef.current ? "100% 0px 100% 0px" : "150% 0px 150% 0px" });
    const visObs = new IntersectionObserver(track(setVisible), { root });
    root.querySelectorAll("[data-slot-id]").forEach((el) => {
      nearObs.observe(el);
      visObs.observe(el);
    });
    return () => {
      nearObs.disconnect();
      visObs.disconnect();
    };
  }, [pages]);

  // Current page = the one crossing the upper third of the viewport.
  const frame = useRef(0);
  const onScroll = useCallback(() => {
    notifyViewerScroll();
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const root = scrollRef.current;
      if (!root) return;
      const { scroll, setScroll } = useEditorStore.getState();
      if (root.scrollTop !== scroll.top || root.scrollLeft !== scroll.left) setScroll({ top: root.scrollTop, left: root.scrollLeft });
      const top = insetsRef.current?.top ?? 0;
      const line = root.getBoundingClientRect().top + top + (root.clientHeight - top - (insetsRef.current?.bottom ?? 0)) / 3;
      const slots = root.querySelectorAll<HTMLElement>("[data-slot-index]");
      for (const el of slots) {
        const r = el.getBoundingClientRect();
        if (r.bottom + 8 >= line) {
          const index = Number(el.dataset.slotIndex);
          if (useEditorStore.getState().currentPage !== index) useEditorStore.getState().setCurrentPage(index);
          break;
        }
      }
    });
  }, []);

  // On mount (tab switch, back from another view) return to the last offset, unless a page was requested.
  useLayoutEffect(() => {
    const root = scrollRef.current;
    const { scroll, scrollRequest: pending } = useEditorStore.getState();
    if (!root || pending !== null) return;
    root.scrollTop = scroll.top;
    root.scrollLeft = scroll.left;
  }, []);

  // "Go to page" requests.
  useLayoutEffect(() => {
    if (scrollRequest === null) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-slot-index="${scrollRequest}"]`);
    if (el) scrollRef.current!.scrollTo({ top: el.offsetTop - (insetsRef.current ? insetsRef.current.top : PAD - 8), behavior: "auto" });
    useEditorStore.setState({ scrollRequest: null });
  }, [scrollRequest]);

  const goToSourcePage = useCallback((sourceId: string, sourceIndex: number) => {
    const i = useDocStore.getState().doc.pages.findIndex((p) => p.sourceId === sourceId && p.sourceIndex === sourceIndex);
    if (i >= 0) useEditorStore.getState().goToPage(i);
  }, []);

  return (
    <div
      ref={scrollRef}
      data-viewer-scroll
      onScroll={onScroll}
      style={{ touchAction: "pan-x pan-y" }}
      onContextMenu={phone ? (e) => e.preventDefault() : undefined}
      className={`relative overflow-auto bg-canvas ${phone ? "snow-touch-select" : ""} ${className ?? ""}`}
    >
      <div
        ref={contentRef}
        className={`flex w-max min-w-full flex-col ${insets ? "" : "gap-5"}`}
        style={
          insets
            ? { padding: `${insets.top}px ${insets.x}px calc(${insets.bottom}px + env(safe-area-inset-bottom))`, gap: insets.gap }
            : { padding: PAD }
        }
      >
        {pages.map((page, index) => (
          <div key={page.id} className="mx-auto" data-slot-id={page.id} data-slot-index={index}>
            <PageView
              page={page}
              index={index}
              zoom={zoom}
              active={near.has(page.id)}
              priority={visible.has(page.id) ? 0 : 1}
              textInteractive={textInteractive}
              formsInteractive={formsInteractive}
              overlay={(geom) => overlay(page, index, geom)}
              underlay={underlay ? (geom) => underlay(page, geom) : undefined}
              onGoToSourcePage={goToSourcePage}
              onOpenExternal={onOpenExternal}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
