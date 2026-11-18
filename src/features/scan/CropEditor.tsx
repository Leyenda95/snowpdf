import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { Camera, Check } from "lucide-react";
import { fullQuad, isConvexQuad, type Point, type Quad } from "@/pdf/scan/raster";
import type { Raster } from "@/pdf/inpaint";
import { Button } from "@/ui";
import { t } from "@/i18n";
import { RasterCanvas } from "./RasterCanvas";
import { paintRaster } from "./scanImage";
import { useScanStore, type ScanPage } from "./scanStore";

/** Free space kept around the picture so the corner handles stay reachable. */
const PAD = 28;
const HANDLE_HIT = 48;
const HANDLE_DOT = 22;
const LOUPE = 112;
const LOUPE_ZOOM = 2.5;

interface Size {
  w: number;
  h: number;
}

interface Drag {
  index: number;
  pointerId: number;
  /** Corner minus pointer, in screen pixels, fixed at pointerdown. */
  dx: number;
  dy: number;
}

/** Size of an element, kept up to date. */
function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Image pixel (centre) -> position inside the displayed picture. */
const toScreen = (p: Point, scale: number): Point => ({ x: (p.x + 0.5) * scale, y: (p.y + 0.5) * scale });

/** Adjusting the four corners of the sheet on the current photo. */
export function CropEditor({ page }: { page: ScanPage }) {
  const { preview, quad } = page;
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const stage = useElementSize(stageRef);
  const [drag, setDrag] = useState<Drag | null>(null);

  const scale = Math.max(0, Math.min((stage.w - 2 * PAD) / preview.width, (stage.h - 2 * PAD) / preview.height));
  const dispW = preview.width * scale;
  const dispH = preview.height * scale;
  const left = (stage.w - dispW) / 2;
  const top = (stage.h - dispH) / 2;

  const corners = quad.map((p) => toScreen(p, scale));

  const onPointerDown = (index: number) => (e: ReactPointerEvent<SVGGElement>) => {
    if (e.button !== 0 || !boxRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = boxRef.current.getBoundingClientRect();
    const c = corners[index];
    setDrag({ index, pointerId: e.pointerId, dx: c.x - (e.clientX - r.left), dy: c.y - (e.clientY - r.top) });
  };

  const onPointerMove = (e: ReactPointerEvent<SVGGElement>) => {
    if (!drag || e.pointerId !== drag.pointerId || !boxRef.current || scale <= 0) return;
    const r = boxRef.current.getBoundingClientRect();
    const sx = e.clientX - r.left + drag.dx;
    const sy = e.clientY - r.top + drag.dy;
    const x = Math.min(preview.width - 1, Math.max(0, sx / scale - 0.5));
    const y = Math.min(preview.height - 1, Math.max(0, sy / scale - 0.5));
    const current = useScanStore.getState().pages.find((p) => p.id === page.id);
    if (!current) return;
    const candidate = current.quad.map((p, i) => (i === drag.index ? { x, y } : p)) as Quad;
    if (isConvexQuad(candidate)) useScanStore.getState().update(page.id, { quad: candidate });
  };

  const endDrag = (e: ReactPointerEvent<SVGGElement>) => {
    if (drag && e.pointerId === drag.pointerId) setDrag(null);
  };

  const quadPath = `M${corners.map((c) => `${c.x} ${c.y}`).join(" L")} Z`;
  const dimPath = `M0 0 H${dispW} V${dispH} H0 Z ${quadPath}`;

  const dragged = drag ? quad[drag.index] : null;
  const loupeOnRight = drag ? left + corners[drag.index].x < stage.w / 2 : false;

  const setQuad = (q: Quad) => useScanStore.getState().update(page.id, { quad: q });

  return (
    <>
      {/*
        touch-action goes on the stage, not on the handles: Chrome ignores it on the inner elements
        of an SVG, takes the drag for a pan and cancels the pointer after a few pixels. Nothing
        here scrolls, so the whole stage can opt out.
      */}
      <div ref={stageRef} className="relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-canvas">
        {scale > 0 && (
          <div ref={boxRef} className="absolute" style={{ left, top, width: dispW, height: dispH }}>
            <RasterCanvas raster={preview} className="block size-full select-none" />
            <svg className="absolute inset-0 size-full" style={{ overflow: "visible" }} width={dispW} height={dispH}>
              <path d={dimPath} fillRule="evenodd" fill="black" fillOpacity={0.45} />
              <path d={quadPath} fill="none" stroke="var(--color-brand-500)" strokeWidth={2} strokeLinejoin="round" />
              {corners.map((c, i) => (
                <g
                  key={i}
                  style={{ cursor: drag?.index === i ? "grabbing" : "grab" }}
                  onPointerDown={onPointerDown(i)}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onLostPointerCapture={endDrag}
                >
                  <circle cx={c.x} cy={c.y} r={HANDLE_HIT / 2} fill="transparent" />
                  <circle cx={c.x} cy={c.y} r={HANDLE_DOT / 2 - 1} fill="white" stroke="var(--color-brand-500)" strokeWidth={2} />
                </g>
              ))}
            </svg>
          </div>
        )}
        {dragged && scale > 0 && (
          <Loupe preview={preview} center={dragged} scale={scale} className={loupeOnRight ? "right-3" : "left-3"} />
        )}
      </div>

      <p className="border-t border-line bg-surface px-3 pt-2 text-center text-xs text-muted">{t("Arrastra las esquinas hasta los bordes de la hoja. La foto se guarda entera: puedes volver a ajustarlas cuando quieras.")}</p>
      <div
        className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 bg-surface px-3 pt-2"
        style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="px-2 text-sm" disabled={!page.auto} onClick={() => page.auto && setQuad(page.auto)}>
            {t("Automático")}
          </Button>
          <Button variant="ghost" size="sm" className="px-2 text-sm" onClick={() => setQuad(fullQuad(preview.width, preview.height))}>
            {t("Toda la foto")}
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" icon={Camera} className="px-2.5" onClick={() => useScanStore.getState().camera(page.id)}>
            {t("Repetir foto")}
          </Button>
          <Button size="sm" variant="primary" icon={Check} className="px-2.5" onClick={() => useScanStore.getState().show(page.id, "review")}>
            {t("Continuar")}
          </Button>
        </div>
      </div>
    </>
  );
}

/** Magnified view of the photo around the corner being dragged. */
function Loupe({ preview, center, scale, className }: { preview: Raster; center: Point; scale: number; className: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const source = useMemo(() => {
    const c = document.createElement("canvas");
    paintRaster(c, preview);
    return c;
  }, [preview]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const size = Math.round(LOUPE * dpr);
    if (canvas.width !== size) canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, size, size);
    // Region of the photo shown: LOUPE screen pixels at LOUPE_ZOOM times the on-screen scale.
    const span = LOUPE / (scale * LOUPE_ZOOM);
    const k = size / span;
    const sx = center.x + 0.5 - span / 2;
    const sy = center.y + 0.5 - span / 2;
    // Clip the region to the photo by hand; the rest stays black.
    const x0 = Math.max(0, sx);
    const y0 = Math.max(0, sy);
    const x1 = Math.min(preview.width, sx + span);
    const y1 = Math.min(preview.height, sy + span);
    if (x1 > x0 && y1 > y0) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(source, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * k, (y0 - sy) * k, (x1 - x0) * k, (y1 - y0) * k);
    }
    // Crosshair.
    const mid = size / 2;
    const arm = 8 * dpr;
    ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue("--color-brand-500").trim() || "#ff4f1f";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(mid - arm, mid);
    ctx.lineTo(mid + arm, mid);
    ctx.moveTo(mid, mid - arm);
    ctx.lineTo(mid, mid + arm);
    ctx.stroke();
  }, [source, center.x, center.y, scale, preview.width, preview.height]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute top-3 rounded-full border-2 border-white shadow-pop ${className}`}
      style={{ width: LOUPE, height: LOUPE }}
    />
  );
}
