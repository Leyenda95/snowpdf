import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AnnotationLayer,
  AnnotationMode,
  RenderingCancelledException,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist";
import { getSource } from "@/model/registry";
import { displayRotation, type PageRef } from "@/model/types";
import { PDF_TO_CSS } from "@/render/pdfjs";
import { enqueueRender } from "@/render/renderQueue";
import { SnowLinkService } from "@/render/linkService";
import { attachTextSelection } from "@/render/textSelection";
import { pageGeometry, type PageGeometry } from "./geometry";
import { t } from "@/i18n";
import { useIsMobile } from "@/ui";
import { subscribeViewerScroll, viewerZoom } from "./viewerScroll";

const MAX_CANVAS_PIXELS = 4096 * 4096;
/**
 * Phone: the full-page bitmap is capped at about one screen's worth of device pixels (a page at
 * fit width never exceeds it). Zooming in then keeps that bitmap as a backdrop and only the visible
 * region is redrawn sharp (detail canvas), instead of re-rendering whole pages at every zoom.
 */
function phoneCanvasCap(): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.max(2 ** 21, window.innerWidth * window.innerHeight * dpr * dpr);
}
/** Detail canvas: margin around the viewport (fraction of it, each side) and refresh slack. */
const DETAIL_MARGIN = 0.15;
const DETAIL_SLACK = 0.05;
const DETAIL_DEBOUNCE_MS = 150;
const MAX_DETAIL_PIXELS = 2 ** 23;

function outputScaleFor(width: number, height: number, maxPixels = MAX_CANVAS_PIXELS): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.min(dpr, Math.sqrt(maxPixels / Math.max(1, width * height)));
}

/** High-resolution bitmap of part of a page, in CSS px of the page at `zoom`. */
interface DetailBitmap {
  canvas: HTMLCanvasElement;
  zoom: number;
  x: number;
  y: number;
  w: number;
  h: number;
  out: number;
}

function placeDetail(d: DetailBitmap, zoom: number): void {
  const k = zoom / d.zoom;
  const { canvas } = d;
  canvas.style.left = `${d.x * k}px`;
  canvas.style.top = `${d.y * k}px`;
  // The region's exact CSS size (the bitmap was rounded to whole pixels): stays aligned with the text layer.
  canvas.style.width = `${d.w * k}px`;
  canvas.style.height = `${d.h * k}px`;
}

/** True while a pinch / double-tap preview scales the content: detail renders wait. */
function viewerBusy(scroller: HTMLElement): boolean {
  // A double-tap animation, or a pinch preview (CSS-scaled content).
  const content = scroller.firstElementChild as HTMLElement | null;
  return viewerZoom.animating || (!!content && content.style.transform !== "");
}

/**
 * Largest bitmap size <= `size` whose CSS size (size / dpr) the browser can lay out exactly. CSS
 * lengths are kept in 1/64 px units: at 125 % a 991 px bitmap would get a 792.797 px box instead
 * of 792.8, one device pixel would be dropped or doubled. The few device pixels lost at the
 * right/bottom edge show the page's white background.
 */
function layoutExactSize(size: number, dpr: number): number {
  for (let n = size; n > size - 64 && n > 0; n--) {
    const units = (n / dpr) * 64;
    if (Math.abs(units - Math.round(units)) < 1e-6) return n;
  }
  return size;
}

/** Bitmap of a rendered page and the zoom it was drawn at. */
interface PageBitmap {
  canvas: HTMLCanvasElement;
  zoom: number;
  /** Bitmap pixels per CSS px (the device pixel ratio unless the canvas size was capped). */
  out: number;
  /** What it shows (source page, rotation, pixel ratio): a different key always re-renders. */
  key: string;
}

/**
 * Shows the bitmap one bitmap pixel per device pixel. The browser already snaps a canvas box to
 * whole device pixels, but at fractional scales (Windows at 125 %, 150 %...) the CSS -> device
 * conversion is never exactly 1:1, so it resamples the canvas with a smoothing filter: small text
 * looks blurry. `pixelated` makes it copy the pixels instead. While a zoom is pending the old
 * bitmap is stretched, smoothly.
 */
function placeBitmap(bitmap: PageBitmap, zoom: number): void {
  const { canvas, out } = bitmap;
  const k = zoom / bitmap.zoom;
  const exact = k === 1 && out === (window.devicePixelRatio || 1);
  canvas.style.width = `${canvas.width / out}px`;
  canvas.style.height = `${canvas.height / out}px`;
  canvas.style.transform = k === 1 ? "" : `scale(${k})`;
  canvas.style.imageRendering = exact ? "pixelated" : "";
}

/**
 * Current device pixel ratio, updated when it changes: the window moved to a monitor with another
 * Windows scale, the scale was changed, or the window got its final scale after the page was
 * drawn. A bitmap drawn for the old ratio would be shown stretched (pixelated) until re-rendered.
 */
function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    // The query only matches the ratio it was built with: listen again after every change.
    const query = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = () => setDpr(window.devicePixelRatio || 1);
    query.addEventListener("change", onChange);
    // Backup: moving the window to another monitor also resizes it.
    window.addEventListener("resize", onChange);
    // It may have changed between the first render and this effect.
    if ((window.devicePixelRatio || 1) !== dpr) onChange();
    return () => {
      query.removeEventListener("change", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, [dpr]);
  return dpr;
}

const fieldObjectsCache = new WeakMap<PDFDocumentProxy, Promise<Map<string, object[]> | null>>();
function fieldObjects(pdf: PDFDocumentProxy) {
  let p = fieldObjectsCache.get(pdf);
  if (!p) {
    p = pdf.getFieldObjects().catch(() => null);
    fieldObjectsCache.set(pdf, p);
  }
  return p;
}

export interface PageViewProps {
  page: PageRef;
  index: number;
  zoom: number;
  /** Render canvas and layers (page is in or near the viewport). */
  active: boolean;
  /** Lower renders first. */
  priority: number;
  /** Text layer receives the pointer (selection, highlight tool). */
  textInteractive: boolean;
  /** Form fields and links receive the pointer. */
  formsInteractive: boolean;
  overlay?: (geom: PageGeometry) => ReactNode;
  /** Drawn right above the bitmap, below the pdf.js layers (blend modes reach the page). */
  underlay?: (geom: PageGeometry) => ReactNode;
  onGoToSourcePage?: (sourceId: string, sourceIndex: number) => void;
  onOpenExternal?: (url: string) => void;
  className?: string;
}

export const PageView = memo(function PageView(props: PageViewProps) {
  const { page, index, zoom, active, priority, textInteractive, formsInteractive, overlay, underlay, className } = props;
  const geom = useMemo(() => pageGeometry(page, zoom), [page, zoom]);
  const geomScale = useRef(geom.scale);
  geomScale.current = geom.scale;
  const rotation = displayRotation(page);
  const hostRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const annotRef = useRef<HTMLDivElement>(null);
  const textLayer = useRef<{ layer: TextLayer; pdfPage: PDFPageProxy } | null>(null);
  const annotLayer = useRef<{ layer: AnnotationLayer; pdfPage: PDFPageProxy } | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const [renderZoom, setRenderZoom] = useState(zoom);
  const phone = useIsMobile();
  // Phone: read at enqueue time, so a page scrolling into view doesn't restart its render.
  const priorityRef = useRef(priority);
  priorityRef.current = priority;
  const detail = useRef<DetailBitmap | null>(null);
  const scheduleDetail = useRef<() => void>(() => undefined);
  const [error, setError] = useState<string | null>(null);
  const bitmap = useRef<PageBitmap | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // A change re-renders the canvas (effect dependency) for the new ratio.
  const dpr = useDevicePixelRatio();

  useLayoutEffect(() => {
    if (bitmap.current) placeBitmap(bitmap.current, zoom);
    if (detail.current) placeDetail(detail.current, zoom);
  }, [zoom, dpr]);

  // Zooming stretches the current bitmap instantly; the sharp re-render waits for a pause.
  useEffect(() => {
    if (zoom === renderZoom) return;
    // Desktop: wait for a pause (Ctrl+wheel zooms continuously). Phone zooms are committed once,
    // when the pinch or double tap ends, so the sharp render can start right away.
    const t = setTimeout(() => setRenderZoom(zoom), phone ? 0 : 160);
    return () => clearTimeout(t);
  }, [zoom, renderZoom]);

  // ---- canvas
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!active || !page.sourceId) {
      host.replaceChildren();
      bitmap.current = null;
      detail.current = null;
      return;
    }
    const key = `${page.sourceId}:${page.sourceIndex}:${rotation}:${dpr}`;
    const prev = bitmap.current;
    if (phone && prev && prev.key === key) {
      // Phone: keep the current bitmap when a re-render would give about the same number of pixels
      // (it's capped): the detail canvas provides the sharpness. Typical for every zoom past fit width.
      const k = renderZoom / prev.zoom;
      const cssArea = (prev.canvas.width / prev.out) * (prev.canvas.height / prev.out) * k * k;
      const target = Math.min(cssArea * dpr * dpr, phoneCanvasCap());
      const have = prev.canvas.width * prev.canvas.height;
      if (have >= 0.6 * target && have <= 2 * target) return;
    }
    let cancelled = false;
    let task: RenderTask | null = null;
    const job = enqueueRender(async () => {
      if (cancelled) return;
      const pdfPage = await getSource(page.sourceId!).pdf.getPage(page.sourceIndex + 1);
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: renderZoom * PDF_TO_CSS, rotation });
      const out = outputScaleFor(viewport.width, viewport.height, phone ? phoneCanvasCap() : MAX_CANVAS_PIXELS);
      const canvas = document.createElement("canvas");
      canvas.className = "snow-page-canvas";
      canvas.width = Math.max(1, layoutExactSize(Math.floor(viewport.width * out), out));
      canvas.height = Math.max(1, layoutExactSize(Math.floor(viewport.height * out), out));
      task = pdfPage.render({
        canvas,
        viewport,
        transform: out !== 1 ? [out, 0, 0, out, 0, 0] : undefined,
        annotationMode: AnnotationMode.ENABLE_FORMS,
      });
      await task.promise;
      if (!cancelled) {
        host.replaceChildren(canvas);
        bitmap.current = { canvas, zoom: renderZoom, out, key };
        placeBitmap(bitmap.current, zoomRef.current);
        // Keep the previous detail (scaled) until the new one replaces it.
        if (detail.current) host.appendChild(detail.current.canvas);
        scheduleDetail.current();
        setError(null);
      }
    }, phone ? priorityRef.current : priority);
    job.promise.catch((err) => {
      if (!cancelled && !(err instanceof RenderingCancelledException)) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
      job.cancel();
      task?.cancel();
    };
  }, [active, page.sourceId, page.sourceIndex, rotation, renderZoom, phone ? 0 : priority, dpr, phone]);

  // ---- phone: sharp canvas for the part of the page on screen (the base canvas is capped)
  useEffect(() => {
    const host = hostRef.current;
    const scroller = host?.closest<HTMLElement>("[data-viewer-scroll]");
    if (!phone || !active || !page.sourceId || !host || !scroller) {
      scheduleDetail.current = () => undefined;
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let job: { cancel(): void } | null = null;
    let task: RenderTask | null = null;
    const dropDetail = () => {
      if (!detail.current) return;
      detail.current.canvas.remove();
      detail.current = null;
    };
    const cancelRender = () => {
      job?.cancel();
      task?.cancel();
      job = null;
      task = null;
    };

    /** Visible part of the page (CSS px of the page at the current zoom), grown by `grow` of the viewport. */
    const visibleRegion = (grow: number) => {
      const hr = host.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      const gx = sr.width * grow;
      const gy = sr.height * grow;
      const left = Math.max(sr.left - gx, hr.left);
      const top = Math.max(sr.top - gy, hr.top);
      const right = Math.min(sr.right + gx, hr.right);
      const bottom = Math.min(sr.bottom + gy, hr.bottom);
      if (right <= left || bottom <= top) return null;
      return { x0: left - hr.left, y0: top - hr.top, x1: right - hr.left, y1: bottom - hr.top };
    };

    const check = () => {
      timer = null;
      if (cancelled) return;
      const base = bitmap.current;
      // Wait for the zoom to settle (the base bitmap may be one drawn at another zoom, see above).
      if (!base || zoomRef.current !== renderZoom) return;
      if (viewerBusy(scroller)) {
        timer = setTimeout(check, DETAIL_DEBOUNCE_MS);
        return;
      }
      const dprNow = window.devicePixelRatio || 1;
      // Base bitmap pixels per CSS px at this zoom.
      const baseOut = (base.out * base.zoom) / renderZoom;
      const need = baseOut >= dprNow - 0.01 ? null : visibleRegion(DETAIL_SLACK);
      if (!need) {
        cancelRender();
        dropDetail();
        return;
      }
      const d = detail.current;
      if (d && d.zoom === renderZoom && need.x0 >= d.x && need.y0 >= d.y && need.x1 <= d.x + d.w && need.y1 <= d.y + d.h) return;
      const want = visibleRegion(DETAIL_MARGIN)!;
      const x = Math.floor(want.x0);
      const y = Math.floor(want.y0);
      const w = Math.max(1, Math.ceil(want.x1) - x);
      const h = Math.max(1, Math.ceil(want.y1) - y);
      cancelRender();
      const q = enqueueRender(async () => {
        if (cancelled) return;
        const pdfPage = await getSource(page.sourceId!).pdf.getPage(page.sourceIndex + 1);
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale: renderZoom * PDF_TO_CSS, rotation });
        const out = Math.min(dprNow, Math.sqrt(MAX_DETAIL_PIXELS / (w * h)));
        const canvas = document.createElement("canvas");
        canvas.className = "snow-page-detail";
        canvas.width = Math.max(1, Math.round(w * out));
        canvas.height = Math.max(1, Math.round(h * out));
        const rt = pdfPage.render({
          canvas,
          viewport,
          transform: [out, 0, 0, out, -x * out, -y * out],
          annotationMode: AnnotationMode.ENABLE_FORMS,
        });
        task = rt;
        await rt.promise;
        if (cancelled) return;
        const next: DetailBitmap = { canvas, zoom: renderZoom, x, y, w, h, out };
        placeDetail(next, zoomRef.current);
        detail.current?.canvas.remove();
        host.appendChild(canvas);
        detail.current = next;
      }, 0);
      job = q;
      q.promise.catch(() => undefined);
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, DETAIL_DEBOUNCE_MS);
    };
    scheduleDetail.current = schedule;
    const unsubscribe = subscribeViewerScroll(schedule);
    // A new zoom: look for a detail now (scrolling still debounces).
    if (bitmap.current) check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      cancelRender();
      unsubscribe();
      scheduleDetail.current = () => undefined;
    };
  }, [phone, active, page.sourceId, page.sourceIndex, rotation, renderZoom, dpr]);

  // ---- text layer (selection, highlight and edit-text tools, search)
  useEffect(() => {
    const div = textRef.current;
    if (!div || !active || !page.sourceId) return;
    let cancelled = false;
    let layer: TextLayer | null = null;
    let detach: (() => void) | null = null;
    (async () => {
      const pdfPage = await getSource(page.sourceId!).pdf.getPage(page.sourceIndex + 1);
      if (cancelled) return;
      div.replaceChildren();
      layer = new TextLayer({
        textContentSource: pdfPage.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
        container: div,
        viewport: pdfPage.getViewport({ scale: geomScale.current, rotation }),
      });
      await layer.render();
      if (cancelled) return;
      detach = attachTextSelection(div);
      textLayer.current = { layer, pdfPage };
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      layer?.cancel();
      detach?.();
      textLayer.current = null;
      div.replaceChildren();
    };
  }, [active, page.sourceId, page.sourceIndex, rotation]);

  // ---- annotation layer: fillable form fields and links
  useEffect(() => {
    const div = annotRef.current;
    if (!div || !active || !page.sourceId) return;
    let cancelled = false;
    let layer: AnnotationLayer | null = null;
    const sourceId = page.sourceId;
    (async () => {
      const { pdf } = getSource(sourceId);
      const pdfPage = await pdf.getPage(page.sourceIndex + 1);
      const [annotations, fields] = await Promise.all([pdfPage.getAnnotations({ intent: "display" }), fieldObjects(pdf)]);
      if (cancelled || annotations.length === 0) return;
      const viewport = pdfPage.getViewport({ scale: geomScale.current, rotation }).clone({ dontFlip: true });
      const linkService = new SnowLinkService(
        pdf,
        (i) => callbacks.current.onGoToSourcePage?.(sourceId, i),
        (url) => callbacks.current.onOpenExternal?.(url),
      );
      div.replaceChildren();
      layer = new AnnotationLayer({
        div,
        accessibilityManager: null,
        annotationCanvasMap: null,
        annotationEditorUIManager: null,
        page: pdfPage,
        viewport,
        structTreeLayer: null,
        commentManager: null,
        linkService,
        annotationStorage: pdf.annotationStorage,
      });
      await layer.render({
        annotations,
        viewport,
        div,
        page: pdfPage,
        linkService: linkService as never,
        renderForms: true,
        annotationStorage: pdf.annotationStorage,
        imageResourcesPath: "",
        enableScripting: false,
        hasJSActions: false,
        fieldObjects: fields,
      });
      if (cancelled) return;
      annotLayer.current = { layer, pdfPage };
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      layer?.destroy();
      annotLayer.current = null;
      div.replaceChildren();
    };
  }, [active, page.sourceId, page.sourceIndex, rotation]);

  // Keep layer internals in sync after a zoom pause (positions already scale via CSS vars).
  useEffect(() => {
    const t = textLayer.current;
    if (t) t.layer.update({ viewport: t.pdfPage.getViewport({ scale: renderZoom * PDF_TO_CSS, rotation }) });
    const a = annotLayer.current;
    if (a) {
      const viewport = a.pdfPage.getViewport({ scale: renderZoom * PDF_TO_CSS, rotation }).clone({ dontFlip: true });
      a.layer.update({ viewport } as Parameters<AnnotationLayer["update"]>[0]);
    }
  }, [renderZoom, rotation]);

  return (
    <div
      className={[
        "snow-page",
        textInteractive ? "" : "text-inert",
        formsInteractive ? "" : "forms-inert",
        className ?? "",
      ].join(" ")}
      style={{ width: geom.visible.width, height: geom.visible.height, ["--scale-factor" as string]: geom.scale }}
      data-page-index={index}
      data-page-id={page.id}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute" style={{ left: -geom.offsetX, top: -geom.offsetY, width: geom.full.width, height: geom.full.height }}>
          <div ref={hostRef} className="absolute inset-0" />
          <div ref={textRef} className="textLayer" />
          <div ref={annotRef} className="annotationLayer" />
        </div>
        {underlay && <div className="pointer-events-none absolute inset-0">{underlay(geom)}</div>}
      </div>
      {error && (
        <div className="absolute inset-x-4 top-4 z-[4] rounded-lg bg-rose-50 p-3 text-sm text-rose-700 shadow dark:bg-rose-950 dark:text-rose-200">
          {t("No se pudo dibujar esta página:")} {error}
        </div>
      )}
      {overlay && <div className="snow-overlay">{overlay(geom)}</div>}
    </div>
  );
});
