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

const MAX_CANVAS_PIXELS = 4096 * 4096;

function outputScaleFor(width: number, height: number): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height)));
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
  const [error, setError] = useState<string | null>(null);
  const bitmap = useRef<PageBitmap | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // A change re-renders the canvas (effect dependency) for the new ratio.
  const dpr = useDevicePixelRatio();

  useLayoutEffect(() => {
    if (bitmap.current) placeBitmap(bitmap.current, zoom);
  }, [zoom, dpr]);

  // Zooming stretches the current bitmap instantly; the sharp re-render waits for a pause.
  useEffect(() => {
    if (zoom === renderZoom) return;
    const t = setTimeout(() => setRenderZoom(zoom), 160);
    return () => clearTimeout(t);
  }, [zoom, renderZoom]);

  // ---- canvas
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!active || !page.sourceId) {
      host.replaceChildren();
      bitmap.current = null;
      return;
    }
    let cancelled = false;
    let task: RenderTask | null = null;
    const job = enqueueRender(async () => {
      if (cancelled) return;
      const pdfPage = await getSource(page.sourceId!).pdf.getPage(page.sourceIndex + 1);
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: renderZoom * PDF_TO_CSS, rotation });
      const out = outputScaleFor(viewport.width, viewport.height);
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
        bitmap.current = { canvas, zoom: renderZoom, out };
        placeBitmap(bitmap.current, zoomRef.current);
        setError(null);
      }
    }, priority);
    job.promise.catch((err) => {
      if (!cancelled && !(err instanceof RenderingCancelledException)) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
      job.cancel();
      task?.cancel();
    };
  }, [active, page.sourceId, page.sourceIndex, rotation, renderZoom, priority, dpr]);

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
        <div className="absolute inset-x-4 top-4 z-[4] rounded-lg bg-rose-50 p-3 text-sm text-rose-700 shadow">
          {t("No se pudo dibujar esta página:")} {error}
        </div>
      )}
      {overlay && <div className="snow-overlay">{overlay(geom)}</div>}
    </div>
  );
});
