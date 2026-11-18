import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Copy, Highlighter } from "lucide-react";
import { addObjects } from "@/model/docActions";
import type { PageRef } from "@/model/types";
import { allRange, caretAt, rangeBoxes, rangeText, type Box, type TextIndex } from "@/render/charSelection";
import { getTextIndex } from "@/render/pageTextIndex";
import { t } from "@/i18n";
import { toast, useEscapeLayer } from "@/ui";
import { useEditorStore } from "../editorStore";
import { createShape, frameFromScreenRect } from "../objects";
import { clearTouchSelection, useTouchSelection } from "../touchSelection";
import type { PageGeometry } from "../viewer/geometry";
import { SHORT_QUERY, phoneInsets } from "../viewer/Viewer";
import { subscribeViewerScroll } from "../viewer/viewerScroll";

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const HANDLE = 22;
const TARGET = 44;
const EDGE_PX = 48;
const SCROLL_STEP = 8;
const BAR_GAP = 10;
const SELECTION_FILL = "rgb(59 130 246 / 0.3)";

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Copy through the async API, falling back to a hidden textarea (the WebView origin may not be a secure context). */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through.
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;font-size:16px";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    ta.remove();
  }
}

/** The selection of one page: glyph rects, the two handles and the floating action bar. */
export function TouchSelectionLayer({ page, geom }: { page: PageRef; geom: PageGeometry }) {
  const sel = useTouchSelection((s) => s.sel);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const geomRef = useRef(geom);
  geomRef.current = geom;
  const [index, setIndex] = useState<TextIndex | null>(null);
  const [dragging, setDragging] = useState(false);
  const [tick, setTick] = useState(0);
  const [bar, setBar] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef<{ id: number; fixed: number; ox: number; oy: number; cx: number; cy: number; raf: number } | null>(null);

  // Back button / Escape clears it.
  useEscapeLayer(true, clearTouchSelection);

  const sourceId = sel?.sourceId;
  const sourceIndex = sel?.sourceIndex;
  useEffect(() => {
    if (sourceId === undefined || sourceIndex === undefined) return;
    let alive = true;
    getTextIndex(sourceId, sourceIndex).then(
      (t) => alive && setIndex(t),
      () => alive && clearTouchSelection(),
    );
    return () => {
      alive = false;
    };
  }, [sourceId, sourceIndex]);

  // The action bar follows the scroll.
  useEffect(() => subscribeViewerScroll(() => setTick((n) => n + 1)), []);
  useEffect(
    () => () => {
      if (drag.current) cancelAnimationFrame(drag.current.raf);
    },
    [],
  );

  /** Screen-space (overlay px) rectangles, one per line; page rotation turns user boxes, so take the 4 corners. */
  const rects = useMemo<Rect[]>(() => {
    if (!sel || !index) return [];
    return rangeBoxes(index, sel.range).map((b: Box) => {
      const pts = [
        geom.visible.toView(b.x0, b.y0),
        geom.visible.toView(b.x1, b.y0),
        geom.visible.toView(b.x0, b.y1),
        geom.visible.toView(b.x1, b.y1),
      ];
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
    });
  }, [sel, index, geom]);
  const first = rects[0];
  const last = rects[rects.length - 1];

  // Position of the action bar: above the first rect, below the last one when there's no room.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const scroller = root?.closest<HTMLElement>("[data-viewer-scroll]");
    if (!root || !scroller || !first || !last || dragging) return;
    const rr = root.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    const insets = phoneInsets(window.matchMedia(SHORT_QUERY).matches);
    const w = barRef.current?.offsetWidth || 232;
    const h = barRef.current?.offsetHeight || 44;
    const minTop = sr.top + insets.top - rr.top;
    const maxTop = sr.bottom - insets.bottom - rr.top - h;
    const above = first.top - BAR_GAP - h;
    const below = last.bottom + HANDLE + BAR_GAP;
    const useBelow = above < minTop;
    const rect = useBelow ? last : first;
    setBar({
      top: clamp(useBelow ? below : above, minTop, maxTop),
      left: clamp((rect.left + rect.right) / 2, sr.left - rr.left + 8 + w / 2, sr.right - rr.left - 8 - w / 2),
    });
  }, [first?.left, first?.top, first?.right, last?.bottom, last?.left, last?.right, last?.top, dragging, tick, geom]);

  if (!sel || !index || !first || !last) return null;

  const local = (cx: number, cy: number) => {
    const r = rootRef.current!.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  };

  /** Moves the dragged end to the caret under the (offset) finger. */
  const update = () => {
    const d = drag.current;
    const cur = useTouchSelection.getState().sel;
    if (!d || !cur || !rootRef.current) return;
    const p = local(d.cx, d.cy);
    const u = geomRef.current.visible.toUser(p.x + d.ox, p.y + d.oy);
    const c = caretAt(index, u.x, u.y);
    // Never empty; crossing the fixed end swaps which end the handle drives.
    if (c === d.fixed) return;
    const range = { start: Math.min(c, d.fixed), end: Math.max(c, d.fixed) };
    if (range.start !== cur.range.start || range.end !== cur.range.end) useTouchSelection.getState().set({ ...cur, range });
  };

  const autoscroll = () => {
    const d = drag.current;
    if (!d) return;
    const scroller = rootRef.current?.closest<HTMLElement>("[data-viewer-scroll]");
    if (scroller) {
      const r = scroller.getBoundingClientRect();
      if (d.cy < r.top + EDGE_PX) scroller.scrollTop -= SCROLL_STEP;
      else if (d.cy > r.bottom - EDGE_PX) scroller.scrollTop += SCROLL_STEP;
      update();
    }
    d.raf = requestAnimationFrame(autoscroll);
  };

  const stopDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    cancelAnimationFrame(d.raf);
    drag.current = null;
    setDragging(false);
  };

  const handleDown = (which: "start" | "end") => (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // The text anchor of the handle (mid-line at the selection end): the selection follows it, not the finger.
    const rect = which === "start" ? first : last;
    const ax = which === "start" ? rect.left : rect.right;
    const ay = (rect.top + rect.bottom) / 2;
    const p = local(e.clientX, e.clientY);
    drag.current = {
      id: e.pointerId,
      fixed: which === "start" ? sel.range.end : sel.range.start,
      ox: ax - p.x,
      oy: ay - p.y,
      cx: e.clientX,
      cy: e.clientY,
      raf: 0,
    };
    setDragging(true);
    drag.current.raf = requestAnimationFrame(autoscroll);
  };
  const handleMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.cx = e.clientX;
    d.cy = e.clientY;
    update();
  };

  const copy = async () => {
    await copyText(rangeText(index, sel.range));
    toast.success(t("Texto copiado"));
    clearTouchSelection();
  };
  const highlight = () => {
    const styles = useEditorStore.getState().styles;
    addObjects(rects.map((r) => createShape("highlight", page.id, frameFromScreenRect(geom, r.left, r.top, r.right, r.bottom), styles)));
    clearTouchSelection();
  };
  const selectAll = () => {
    const range = allRange(index);
    if (range.end > range.start) useTouchSelection.getState().set({ ...sel, range });
  };

  const handleBox = (left: number, top: number, shape: string, which: "start" | "end") => (
    <div
      data-handle
      onPointerDown={handleDown(which)}
      onPointerMove={handleMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      className="absolute grid place-items-center"
      style={{ left: left - (TARGET - HANDLE) / 2, top: top - (TARGET - HANDLE) / 2, width: TARGET, height: TARGET, pointerEvents: "auto", touchAction: "none" }}
    >
      <div className="bg-primary" style={{ width: HANDLE, height: HANDLE, borderRadius: shape }} />
    </div>
  );

  const barButton = "flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-fg active:bg-surface-3";

  return (
    <div ref={rootRef} className="absolute inset-0" style={{ pointerEvents: "none", zIndex: 20 }}>
      {rects.map((r, i) => (
        <div key={i} className="absolute" style={{ left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top, background: SELECTION_FILL, pointerEvents: "none" }} />
      ))}
      {handleBox(first.left - HANDLE, first.bottom, "50% 0 50% 50%", "start")}
      {handleBox(last.right, last.bottom, "0 50% 50% 50%", "end")}
      {!dragging && (
        <div
          ref={barRef}
          data-handle
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute flex items-center gap-0.5 rounded-full border border-line bg-surface p-0.5 shadow-pop"
          style={{ left: bar?.left ?? 0, top: bar?.top ?? 0, transform: "translateX(-50%)", pointerEvents: "auto", visibility: bar ? "visible" : "hidden" }}
        >
          <button type="button" className={barButton} onClick={() => void copy()}>
            <Copy size={16} aria-hidden />
            {t("Copiar")}
          </button>
          <button type="button" className={barButton} onClick={highlight}>
            <Highlighter size={16} aria-hidden />
            {t("Resaltar")}
          </button>
          <button type="button" className={barButton} onClick={selectAll}>
            {t("Todo")}
          </button>
        </div>
      )}
    </div>
  );
}
