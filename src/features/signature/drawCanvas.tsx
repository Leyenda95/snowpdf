import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Eraser, Undo2 } from "lucide-react";
import { Button, Slider } from "@/ui";
import { InkPicker } from "./InkPicker";
import { drawAllStrokes, drawStroke, drawStrokeSegment, drawStrokeTail, nextWidth, type Stroke } from "./strokes";
import type { SignatureKind, SignatureSource } from "./types";
import { t } from "@/i18n";

const PAD_HEIGHT = 220;
/** Resolution multiplier used when exporting, independent of the screen's pixel ratio. */
const EXPORT_SCALE = 3;

export interface DrawCanvasProps {
  kind: SignatureKind;
  color: string;
  onColorChange: (color: string) => void;
  onSourceChange: (source: SignatureSource | null) => void;
}

export function DrawCanvas({ kind, color, onColorChange, onSourceChange }: DrawCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(640);
  const [thickness, setThickness] = useState(3);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [drawing, setDrawing] = useState(false);

  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const live = useRef<{ stroke: Stroke; pointerId: number; lastT: number } | null>(null);
  const sizeRef = useRef({ width: 640, dpr: 1 });

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { dpr } = sizeRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    drawAllStrokes(ctx, strokesRef.current);
    if (live.current) drawStroke(ctx, live.current.stroke);
  }, []);

  // Track the available width; the backing store follows CSS size * devicePixelRatio.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const apply = () => {
      const w = Math.floor(wrap.clientWidth);
      const canvas = canvasRef.current;
      if (w <= 0 || !canvas) return; // hidden tab: keep what we have
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(PAD_HEIGHT * dpr);
      sizeRef.current = { width: w, dpr };
      setWidth(w);
      redraw();
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [redraw]);

  useEffect(redraw, [strokes, redraw]);

  // Publish the export function whenever the drawing changes.
  useEffect(() => {
    if (strokes.length === 0) {
      onSourceChange(null);
      return;
    }
    onSourceChange(() => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(sizeRef.current.width * EXPORT_SCALE);
      canvas.height = Math.round(PAD_HEIGHT * EXPORT_SCALE);
      const ctx = canvas.getContext("2d")!;
      ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
      drawAllStrokes(ctx, strokes);
      return canvas;
    });
  }, [strokes, onSourceChange]);

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const addSample = (e: PointerEvent) => {
    const cur = live.current;
    const ctx = canvasRef.current?.getContext("2d");
    if (!cur || !ctx) return;
    const { x, y } = localPoint(e);
    const pts = cur.stroke.points;
    const prev = pts[pts.length - 1] ?? null;
    if (prev && Math.hypot(x - prev.x, y - prev.y) < 0.6) return;
    const dt = e.timeStamp - cur.lastT;
    cur.lastT = e.timeStamp;
    const w = nextWidth(thickness, prev, x, y, dt, e.pressure, e.pointerType === "pen");
    pts.push({ x, y, w });
    drawStrokeSegment(ctx, cur.stroke, pts.length - 1);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (live.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = localPoint(e);
    const w = nextWidth(thickness, null, x, y, 0, e.pressure, e.pointerType === "pen");
    live.current = { stroke: { color, points: [{ x, y, w }] }, pointerId: e.pointerId, lastT: e.timeStamp };
    setDrawing(true);
    const ctx = e.currentTarget.getContext("2d");
    if (ctx) drawStrokeSegment(ctx, live.current.stroke, 0);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const cur = live.current;
    if (!cur || cur.pointerId !== e.pointerId) return;
    e.preventDefault();
    const native = e.nativeEvent;
    const batch = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    if (batch.length > 1) for (const sample of batch) addSample(sample);
    else addSample(native);
  };

  const finish = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const cur = live.current;
    if (!cur || cur.pointerId !== e.pointerId) return;
    live.current = null;
    setDrawing(false);
    const ctx = e.currentTarget.getContext("2d");
    if (ctx) drawStrokeTail(ctx, cur.stroke);
    setStrokes((list) => [...list, cur.stroke]);
  };

  const baselineTop = PAD_HEIGHT * 0.72;

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={wrapRef}
        className="relative select-none overflow-hidden rounded-xl border border-line-strong bg-white shadow-inner"
        style={{ height: PAD_HEIGHT }}
      >
        {/* Baseline guide, kept outside the canvas so it never ends up in the exported image. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-6 border-b border-dashed border-slate-300"
          style={{ top: baselineTop }}
        />
        {strokes.length === 0 && !drawing && (
          <p className="pointer-events-none absolute inset-x-0 top-6 text-center text-sm text-slate-400">
            {kind === "firma" ? t("Dibuja tu firma aquí") : t("Dibuja tus iniciales aquí")}
          </p>
        )}
        <canvas
          ref={canvasRef}
          aria-label={t("Superficie de dibujo")}
          className="absolute inset-0 cursor-crosshair"
          style={{ width, height: PAD_HEIGHT, touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <InkPicker value={color} onChange={onColorChange} />
        <Slider
          className="w-44"
          label={t("Grosor")}
          min={1}
          max={8}
          step={0.5}
          value={thickness}
          onChange={setThickness}
          format={(v) => `${v} px`}
        />
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={Undo2}
            disabled={strokes.length === 0}
            onClick={() => setStrokes((l) => l.slice(0, -1))}
          >
            {t("Deshacer trazo")}
          </Button>
          <Button size="sm" variant="secondary" icon={Eraser} disabled={strokes.length === 0} onClick={() => setStrokes([])}>
            {t("Borrar")}
          </Button>
        </div>
      </div>
    </div>
  );
}
