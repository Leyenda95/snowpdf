import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useDocStore } from "@/model/docStore";
import { usePrefs } from "@/model/prefs";
import { addObjects, updateObject } from "@/model/docActions";
import { getAsset, getSource, newId } from "@/model/registry";
import type { EditorObject, FontAsset, Frame, InkObject, PageRef, PdfBox, TextObject } from "@/model/types";
import { boxOverlapRatio, boxToFrame, userToFrame } from "@/pdf/objectGeometry";
import { linkBoxes, normalizeBox, sameBox } from "@/pdf/textLinks";
import { pdfjsFont, resolveSourceFont, type PdfjsFont } from "@/render/sourceFonts";
import { getTextRuns, groupLines, getPageChars, runNeedsSplit, splitRunsAtBoxes, type TextLine, type TextRun } from "@/render/textContent";
import { useEditorStore, type EditorTool } from "../editorStore";
import {
  createEraser,
  createImage,
  createLine,
  createShape,
  createSymbol,
  createText,
  defaultImageWidth,
  formatDate,
  frameFromScreenRect,
  frameFromScreenSegment,
  frameStyle,
} from "../objects";
import type { PageGeometry } from "../viewer/geometry";
import { createReplacement, rememberReplacement, replacedBoxOf } from "./editText";
import { prefetchErasedPreview } from "./erasedPreview";
import { drag, moveGesture } from "./gestures";
import { ObjectContextMenu, useOrderShortcuts } from "./ObjectContextMenu";
import { ObjectView } from "./ObjectView";
import { SelectionFrame } from "./SelectionFrame";
import { TextEditor } from "./TextEditor";

/** Tools that stay active after creating an object (repeated marks are the norm). */
const STICKY: EditorTool[] = ["ink", "highlight", "symbol", "redact", "whiteout", "erase", "date"];
const RECT_TOOLS: EditorTool[] = ["rect", "ellipse", "whiteout", "redact", "erase", "highlight"];
/** Strokes drawn within this time join the same drawing object. */
const INK_JOIN_MS = 1800;

type Draft =
  | { kind: "rect"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "line"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "ink"; points: number[] };

/** What a click would act on in "edit text" mode: an original line or an existing text object. */
type EditTarget = { kind: "line"; line: TextLine } | { kind: "object"; obj: TextObject };

/** A line counts as replaced when an edit already covers at least this share of its box. */
const REPLACED_COVERAGE = 0.5;

/** A Link annotation of the original page: pdf.js annotation id, normalised rect (user space), target URL if any. */
interface PageLink {
  id: string;
  rect: PdfBox;
  url: string | null;
}

async function loadPageLinks(sourceId: string, sourceIndex: number): Promise<PageLink[]> {
  try {
    const pg = await getSource(sourceId).pdf.getPage(sourceIndex + 1);
    const anns = await pg.getAnnotations();
    return anns
      .filter((a) => a.subtype === "Link" && Array.isArray(a.rect) && a.rect.length === 4)
      .map((a) => ({ id: String(a.id), rect: normalizeBox(a.rect), url: typeof a.url === "string" ? a.url : null }));
  } catch {
    return [];
  }
}

/** Lines of a page; runs are cut at the edges of link rectangles so each line knows which characters are links. */
async function loadLines(sourceId: string, index: number, runs: TextRun[], boxes: PdfBox[]): Promise<TextLine[]> {
  const needsChars = boxes.length > 0 && runs.some((r) => runNeedsSplit(r, boxes));
  const chars = needsChars ? await getPageChars(sourceId, index) : [];
  return groupLines(splitRunsAtBoxes(runs, boxes, chars), boxes);
}

/** The pdf.js link hover (yellow wash and soft glow), reproduced for the relocated hit areas. */
const LINK_HOVER = { background: "rgb(255 255 0 / 0.2)", boxShadow: "0 2px 10px rgb(255 255 0 / 0.2)" };

let lastInk: { id: string; pageId: string; at: number } | null = null;

function finishCreation(tool: EditorTool, created: EditorObject): void {
  const ed = useEditorStore.getState();
  if (STICKY.includes(tool)) return;
  ed.setTool("select");
  ed.select([created.id]);
}

export function PageOverlay({ page, index, geom }: { page: PageRef; index: number; geom: PageGeometry }) {
  const objects = useDocStore((s) => s.doc.objects);
  const mine = useMemo(() => objects.filter((o) => o.pageId === page.id), [objects, page.id]);
  const tool = useEditorStore((s) => s.tool);
  const selection = useEditorStore((s) => s.selection);
  const editingId = useEditorStore((s) => s.editingId);
  const placing = useEditorStore((s) => s.placing);
  const flash = useEditorStore((s) => (s.flash?.pageId === page.id ? s.flash : null));
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => {
      if (useEditorStore.getState().flash?.at === flash.at) useEditorStore.getState().setFlash(null);
    }, 2600);
    return () => clearTimeout(t);
  }, [flash]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [lines, setLines] = useState<TextLine[] | null>(null);
  const [hover, setHover] = useState<EditTarget | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  useOrderShortcuts();

  // Selecting objects must only show their frames: drop any native text selection (text boxes, pdf.js layer).
  useEffect(() => {
    if (tool !== "select" || editingId || !selection.length) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const a = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
    if (a?.closest("textarea,input")) return;
    sel.removeAllRanges();
  }, [selection, tool, editingId]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = rootRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pageCanvas = () => rootRef.current?.closest(".snow-page")?.querySelector<HTMLCanvasElement>("canvas.snow-page-canvas") ?? null;

  // ---- links of the original page, and the ones carried by edited text
  const [pageLinks, setPageLinks] = useState<PageLink[]>([]);
  useEffect(() => {
    let alive = true;
    if (!page.sourceId) setPageLinks([]);
    else void loadPageLinks(page.sourceId, page.sourceIndex).then((ls) => alive && setPageLinks(ls));
    return () => {
      alive = false;
    };
  }, [page.sourceId, page.sourceIndex]);
  const [hoverLink, setHoverLink] = useState<string | null>(null);

  // One entry per original link a replacement carries: hit-tested over the characters it covers.
  const carried = useMemo(() => {
    const out: { key: string; link: PageLink; box: PdfBox | null }[] = [];
    for (const o of mine) {
      if (o.kind !== "text" || !o.links) continue;
      linkBoxes(o).forEach(({ rect, box }, i) => {
        const link = pageLinks.find((l) => sameBox(l.rect, rect));
        if (link) out.push({ key: `${o.id}-${i}`, link, box });
      });
    }
    return out;
  }, [mine, pageLinks]);
  const hiddenIds = [...new Set(carried.map((c) => c.link.id))].sort().join("\n");

  // Hide the annotation-layer sections of those links (pdf.js keeps drawing them at the old
  // rectangle); re-applied whenever the layer is rebuilt (zoom, rotation, page change).
  useEffect(() => {
    const layer = rootRef.current?.closest(".snow-page")?.querySelector<HTMLElement>(".annotationLayer");
    if (!layer || !hiddenIds) return;
    const ids = new Set(hiddenIds.split("\n"));
    const sections = () => layer.querySelectorAll<HTMLElement>("[data-annotation-id]");
    const apply = () => sections().forEach((el) => (el.style.visibility = ids.has(el.dataset.annotationId ?? "") ? "hidden" : ""));
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(layer, { childList: true });
    return () => {
      observer.disconnect();
      sections().forEach((el) => (el.style.visibility = ""));
    };
  }, [hiddenIds, page.sourceId, page.sourceIndex]);

  const openLink = (id: string) => {
    const layer = rootRef.current?.closest(".snow-page")?.querySelector(".annotationLayer");
    // The hidden original anchor runs the app's link handling (confirmation, navigation).
    layer?.querySelector<HTMLElement>(`[data-annotation-id="${CSS.escape(id)}"] a`)?.click();
  };

  // ---- text lines for "edit text" and the magic eraser (a click erases the line)
  const linesTool = tool === "editText" || tool === "erase";
  useEffect(() => {
    setHover(null);
    if (!linesTool || !page.sourceId) {
      setLines(null);
      return;
    }
    let alive = true;
    const sourceId = page.sourceId;
    const linkBoxes = loadPageLinks(sourceId, page.sourceIndex).then((ls) => ls.map((l) => l.rect));
    Promise.all([getTextRuns(sourceId, page.sourceIndex), linkBoxes])
      .then(([runs, boxes]) => loadLines(sourceId, page.sourceIndex, runs, boxes))
      .then((ls) => alive && setLines(ls))
      .catch(() => alive && setLines([]));
    return () => {
      alive = false;
    };
  }, [linesTool, page.sourceId, page.sourceIndex]);

  // Original lines of text under a point of the overlay (not ones already replaced by an edit).
  const linesAt = (p: { x: number; y: number }): { line: TextLine; score: number }[] => {
    if (!lines) return [];
    const u = geom.visible.toUser(p.x, p.y);
    const replaced = mine.flatMap((o) => (o.kind === "text" && o.replaces ? o.replaces : []));
    const found: { line: TextLine; score: number }[] = [];
    for (const l of lines) {
      const q = userToFrame(l.frame, u);
      if (Math.abs(q.x) > l.frame.w / 2 + 2 || Math.abs(q.y) > l.frame.h / 2) continue;
      if (replaced.some((b) => boxOverlapRatio(b, l.box) >= REPLACED_COVERAGE)) continue;
      found.push({ line: l, score: Math.abs(q.y) / (l.frame.h / 2) });
    }
    return found;
  };
  const lineAt = (p: { x: number; y: number }): TextLine | null => linesAt(p)[0]?.line ?? null;

  // "Edit text": the line or text object whose centre is closest to the point (objects win ties).
  const editTargetAt = (p: { x: number; y: number }): EditTarget | null => {
    const u = geom.visible.toUser(p.x, p.y);
    let best: { target: EditTarget; score: number } | null = null;
    for (const o of mine) {
      if (o.kind !== "text") continue;
      const q = userToFrame(o.frame, u);
      if (Math.abs(q.x) > o.frame.w / 2 || Math.abs(q.y) > o.frame.h / 2) continue;
      const score = Math.abs(q.y) / (o.frame.h / 2);
      if (!best || score < best.score) best = { target: { kind: "object", obj: o }, score };
    }
    for (const c of linesAt(p)) {
      if (!best || c.score < best.score) best = { target: { kind: "line", line: c.line }, score: c.score };
    }
    return best?.target ?? null;
  };

  // Warm up the preview of the hovered line so the replacement does not flash a flat patch.
  const hoveredLine = tool === "editText" && hover?.kind === "line" ? hover.line : null;
  useEffect(() => {
    if (!hoveredLine || !lines) return;
    const timer = setTimeout(() => prefetchErasedPreview(page, replacedBoxOf(hoveredLine, lines)), 120);
    return () => clearTimeout(timer);
  }, [hoveredLine, lines, page.sourceId, page.sourceIndex]);

  // Frame (upright on screen) of a text line grown 0.4 pt, like the one "edit text" replaces.
  const eraseFrameOf = (line: TextLine): Frame => {
    const a = geom.visible.toView(line.box[0] - 0.4, line.box[1] - 0.4);
    const b = geom.visible.toView(line.box[2] + 0.4, line.box[3] + 0.4);
    return frameFromScreenRect(geom, a.x, a.y, b.x, b.y);
  };

  // ---- highlight: select text on the text layer, or drag an area where there is none
  useEffect(() => {
    if (tool !== "highlight") return;
    const pageEl = rootRef.current?.closest<HTMLElement>(".snow-page");
    if (!pageEl) return;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      if (!start) return;
      const styles = useEditorStore.getState().styles;
      const sel = window.getSelection();
      const pr = pageEl.getBoundingClientRect();
      const created: EditorObject[] = [];
      if (sel && !sel.isCollapsed && sel.rangeCount) {
        const rects = Array.from(sel.getRangeAt(0).getClientRects())
          .filter((r) => r.width > 1 && r.height > 1 && r.right > pr.left && r.left < pr.right && r.bottom > pr.top && r.top < pr.bottom)
          .map((r) => ({ x0: r.left - pr.left, y0: r.top - pr.top, x1: r.right - pr.left, y1: r.bottom - pr.top }));
        // Merge pieces of the same visual line.
        const merged: typeof rects = [];
        for (const r of rects.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
          const last = merged[merged.length - 1];
          const sameLine = last && Math.abs((last.y0 + last.y1) / 2 - (r.y0 + r.y1) / 2) < Math.min(last.y1 - last.y0, r.y1 - r.y0) * 0.5;
          if (sameLine && r.x0 <= last.x1 + 6) {
            last.x1 = Math.max(last.x1, r.x1);
            last.y0 = Math.min(last.y0, r.y0);
            last.y1 = Math.max(last.y1, r.y1);
          } else merged.push({ ...r });
        }
        for (const r of merged) created.push(createShape("highlight", page.id, frameFromScreenRect(geom, r.x0, r.y0, r.x1, r.y1), styles));
        sel.removeAllRanges();
      } else if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) {
        created.push(
          createShape("highlight", page.id, frameFromScreenRect(geom, start.x - pr.left, start.y - pr.top, e.clientX - pr.left, e.clientY - pr.top), styles),
        );
      }
      if (created.length) addObjects(created);
    };
    pageEl.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    return () => {
      pageEl.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, [tool, page.id, geom]);

  // ---- creation surface
  const surfaceActive = placing !== null || ["hand", "text", "editText", "line", "arrow", "ink", "symbol", "date", ...RECT_TOOLS].includes(tool);
  const surfaceActiveHere = surfaceActive && tool !== "highlight";

  const onSurfaceDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // The viewer clears the selection on background clicks; this click belongs to the tool.
    e.stopPropagation();
    // The preventDefault() calls below keep focus where it was: release the properties field
    // so keyboard shortcuts (Ctrl+Z, Supr...) reach the document.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const ed = useEditorStore.getState();
    const styles = ed.styles;
    const p = local(e);
    ed.setCurrentPage(index);

    if (placing) {
      e.preventDefault();
      const asset = getAsset(placing.assetId);
      const obj = createImage(page.id, geom, p, asset, defaultImageWidth(page, asset, placing.signature), placing.signature);
      addObjects([obj]);
      ed.setPlacing(null);
      ed.setTool("select");
      ed.select([obj.id]);
      return;
    }

    switch (tool) {
      case "hand": {
        const scroller = rootRef.current?.closest<HTMLElement>("[data-viewer-scroll]");
        if (!scroller) return;
        let lx = 0;
        let ly = 0;
        drag(
          e,
          (dx, dy) => {
            scroller.scrollBy(-(dx - lx), -(dy - ly));
            lx = dx;
            ly = dy;
          },
          undefined,
          0,
        );
        return;
      }
      case "text": {
        e.preventDefault();
        const obj = createText(page.id, geom, { x: p.x, y: p.y - styles.text.size * geom.scale * 0.6 }, styles.text);
        addObjects([obj]);
        ed.setTool("select");
        ed.setEditing(obj.id);
        return;
      }
      case "date": {
        e.preventDefault();
        const obj = createText(page.id, geom, { x: p.x, y: p.y - styles.text.size * geom.scale * 0.6 }, styles.text, formatDate(styles.date.format));
        addObjects([obj]);
        return;
      }
      case "symbol": {
        e.preventDefault();
        addObjects([createSymbol(page.id, geom, p, styles.symbol.symbol, styles)]);
        return;
      }
      case "editText": {
        e.preventDefault();
        const target = editTargetAt(p);
        if (!target) return;
        if (target.kind === "object") {
          // A click edits the text, a drag moves it.
          const id = target.obj.id;
          moveGesture(e, [id], geom, () => ed.setEditing(id));
          return;
        }
        const line = target.line;
        const sourceId = page.sourceId;
        if (!sourceId) return;
        void (async () => {
          // Font lookup never blocks the edit: on any failure the closest standard font is used.
          let font: PdfjsFont | null = null;
          let source: FontAsset | null = null;
          try {
            font = await pdfjsFont(await getSource(sourceId).pdf.getPage(page.sourceIndex + 1), line.fontName);
            if (font && usePrefs.getState().useSourceFont) source = await resolveSourceFont(sourceId, line, font);
          } catch {
            // Keep the fallback.
          }
          // Links already carried by another replacement are not claimed twice.
          const free = pageLinks.map((l) => (carried.some((c) => sameBox(c.link.rect, l.rect)) ? null : l.rect));
          const obj = createReplacement(page.id, line, geom, pageCanvas(), font, source, lines ?? [], free);
          rememberReplacement(obj, useDocStore.getState().dirty);
          addObjects([obj]);
          setHover(null);
          ed.setEditing(obj.id);
        })();
        return;
      }
      case "line":
      case "arrow": {
        setDraft({ kind: "line", x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        drag(
          e,
          (dx, dy, ev) => {
            let x1 = p.x + dx;
            let y1 = p.y + dy;
            if (ev.shiftKey) {
              const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
              const len = Math.hypot(dx, dy);
              x1 = p.x + Math.cos(ang) * len;
              y1 = p.y + Math.sin(ang) * len;
            }
            setDraft({ kind: "line", x0: p.x, y0: p.y, x1, y1 });
          },
          (moved, ev) => {
            setDraft(null);
            const end = moved ? local(ev) : { x: p.x + 120 * geom.scale, y: p.y };
            const obj = createLine(tool, page.id, frameFromScreenSegment(geom, p, end, 6), useEditorStore.getState().styles);
            addObjects([obj]);
            finishCreation(tool, obj);
          },
          0,
        );
        return;
      }
      case "ink": {
        const points = [p.x, p.y];
        setDraft({ kind: "ink", points });
        drag(
          e,
          (_dx, _dy, ev) => {
            const q = local(ev);
            points.push(q.x, q.y);
            setDraft({ kind: "ink", points: [...points] });
          },
          () => {
            setDraft(null);
            commitInk(points);
          },
          0,
        );
        return;
      }
      default:
        if (RECT_TOOLS.includes(tool)) {
          setDraft({ kind: "rect", x0: p.x, y0: p.y, x1: p.x, y1: p.y });
          drag(
            e,
            (dx, dy, ev) => {
              let w = dx;
              let h = dy;
              if (ev.shiftKey) {
                const m = Math.max(Math.abs(w), Math.abs(h));
                w = Math.sign(w || 1) * m;
                h = Math.sign(h || 1) * m;
              }
              setDraft({ kind: "rect", x0: p.x, y0: p.y, x1: p.x + w, y1: p.y + h });
            },
            (moved, ev) => {
              setDraft(null);
              const kind = tool as "rect" | "ellipse" | "whiteout" | "redact" | "highlight";
              let frame;
              const q = local(ev);
              // For the eraser a hand that slips a few pixels is still a click.
              const dragged = moved && (tool !== "erase" || Math.hypot(q.x - p.x, q.y - p.y) > 4);
              if (dragged) {
                frame = frameFromScreenRect(geom, p.x, p.y, q.x, q.y);
              } else if (tool === "erase") {
                // A click erases the line of text under it; elsewhere it does nothing.
                const line = lineAt(p);
                if (!line) return;
                frame = eraseFrameOf(line);
              } else {
                const [w, h] = kind === "rect" || kind === "ellipse" ? [120, 80] : [140, 22];
                frame = frameFromScreenRect(geom, p.x - (w * geom.scale) / 2, p.y - (h * geom.scale) / 2, p.x + (w * geom.scale) / 2, p.y + (h * geom.scale) / 2);
              }
              if (frame.w < 2 || frame.h < 2) return;
              const obj = tool === "erase" ? createEraser(page.id, frame) : createShape(kind, page.id, frame, useEditorStore.getState().styles);
              addObjects([obj]);
              finishCreation(tool, obj);
            },
            0,
          );
        }
    }
  };

  /** Points are overlay px; strokes drawn shortly after each other join the same object. */
  const commitInk = (points: number[]) => {
    const styles = useEditorStore.getState().styles.ink;
    const doc = useDocStore.getState().doc;
    const recent = lastInk && lastInk.pageId === page.id && Date.now() - lastInk.at < INK_JOIN_MS ? doc.objects.find((o) => o.id === lastInk!.id) : undefined;
    const prev = recent?.kind === "ink" && recent.frame.rot === geom.rotation ? recent : undefined;
    // Gather all strokes in screen px.
    const strokes: number[][] = [];
    if (prev) {
      const f = frameStyle(prev.frame, geom);
      const left = Number(f.left);
      const top = Number(f.top);
      const w = Number(f.width);
      const h = Number(f.height);
      for (const s of prev.strokes) strokes.push(s.map((v, i) => (i % 2 === 0 ? left + v * w : top + v * h)));
    }
    strokes.push(points);
    const xs = strokes.flatMap((s) => s.filter((_, i) => i % 2 === 0));
    const ys = strokes.flatMap((s) => s.filter((_, i) => i % 2 === 1));
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const bw = Math.max(1, Math.max(...xs) - x0);
    const bh = Math.max(1, Math.max(...ys) - y0);
    const frame = frameFromScreenRect(geom, x0, y0, x0 + bw, y0 + bh);
    const norm = strokes.map((s) => s.map((v, i) => (i % 2 === 0 ? (v - x0) / bw : (v - y0) / bh)));
    if (prev) {
      updateObject(prev.id, { frame, strokes: norm } as Partial<InkObject>);
      lastInk = { id: prev.id, pageId: page.id, at: Date.now() };
    } else {
      const obj: InkObject = {
        id: newId("obj"),
        pageId: page.id,
        kind: "ink",
        frame,
        opacity: styles.opacity,
        strokes: norm,
        color: styles.color,
        strokeWidth: styles.strokeWidth,
      };
      addObjects([obj]);
      lastInk = { id: obj.id, pageId: page.id, at: Date.now() };
    }
  };

  const onSurfaceMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = local(e);
    if (placing) setGhost(p);
    if (linesTool && lines) {
      if (tool === "editText") setHover(editTargetAt(p));
      else {
        const line = lineAt(p);
        setHover(line ? { kind: "line", line } : null);
      }
    }
  };

  // Right click in "edit text" mode on an edited text: same menu as an object (delete = restore the original).
  const onSurfaceContext = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (tool !== "editText" || placing) return;
    e.preventDefault();
    e.stopPropagation();
    const target = editTargetAt(local(e));
    if (target?.kind !== "object") return;
    const ed = useEditorStore.getState();
    ed.setCurrentPage(index);
    ed.select([target.obj.id]);
    window.getSelection()?.removeAllRanges();
    setMenu({ x: e.clientX, y: e.clientY, ids: [target.obj.id] });
  };

  const objectsInteractive = tool === "select" && !placing;
  const cursor = placing
    ? "copy"
    : tool === "hand"
      ? "grab"
      : tool === "text" || tool === "date"
        ? "text"
        : tool === "editText"
          ? hover
            ? "text"
            : "default"
          : "crosshair";

  const ghostAsset = placing ? getAsset(placing.assetId) : null;
  const ghostW = ghostAsset ? defaultImageWidth(page, ghostAsset, placing!.signature) * geom.scale : 0;

  return (
    <div ref={rootRef} className="absolute inset-0" style={{ pointerEvents: "none" }}>
      {surfaceActiveHere && (
        <div
          className="absolute inset-0"
          style={{ pointerEvents: "auto", cursor, touchAction: "none" }}
          onPointerDown={onSurfaceDown}
          onContextMenu={onSurfaceContext}
          onPointerMove={onSurfaceMove}
          onPointerLeave={() => {
            setGhost(null);
            setHover(null);
          }}
        />
      )}

      {carried.map((c) => {
        if (!c.box) return null;
        const active = tool === "select" && !editingId && !placing;
        return (
          <div
            key={`link-${c.key}`}
            title={c.link.url ?? undefined}
            style={{
              ...frameStyle(boxToFrame(c.box), geom),
              pointerEvents: active ? "auto" : "none",
              cursor: active ? "pointer" : undefined,
              borderRadius: 4,
              ...(active && hoverLink === c.key ? LINK_HOVER : null),
            }}
            onPointerEnter={() => setHoverLink(c.key)}
            onPointerLeave={() => setHoverLink((cur) => (cur === c.key ? null : cur))}
            onClick={() => openLink(c.link.id)}
          />
        );
      })}

      {mine.map((o) => {
        const editing = editingId === o.id && o.kind === "text";
        // With the text tool the object takes the click; "edit text" resolves hits on the surface.
        // Edited text is page content outside "edit text": clicks fall through to the page (links, text).
        const pageContent = o.kind === "text" && !!o.replaces && tool !== "editText" && !editing;
        const editableText = o.kind === "text" && !o.replaces && tool === "text";
        const interactive = (objectsInteractive && !pageContent) || editableText || editing;
        return (
          <div
            key={o.id}
            data-object-id={o.id}
            style={{
              ...frameStyle(o.frame, geom),
              pointerEvents: interactive ? "auto" : "none",
              cursor: editing ? "text" : interactive ? "move" : undefined,
              touchAction: "none",
            }}
            onPointerDown={
              interactive && !editing
                ? (e) => {
                    if (e.button !== 0) return;
                    const ed = useEditorStore.getState();
                    ed.setCurrentPage(index);
                    if (editableText) {
                      e.stopPropagation();
                      ed.setTool("select");
                      ed.setEditing(o.id);
                      return;
                    }
                    if (e.shiftKey) {
                      // Shift+click would otherwise extend the native text selection.
                      e.preventDefault();
                      e.stopPropagation();
                      window.getSelection()?.removeAllRanges();
                      const onThisPage = ed.selection.filter((id) => mine.some((m) => m.id === id));
                      ed.select(onThisPage.includes(o.id) ? onThisPage.filter((id) => id !== o.id) : [...onThisPage, o.id]);
                      return;
                    }
                    const ids = ed.selection.includes(o.id) ? ed.selection.filter((id) => mine.some((m) => m.id === id)) : [o.id];
                    ed.select(ids);
                    moveGesture(e, ids, geom);
                  }
                : undefined
            }
            onContextMenu={
              objectsInteractive && !editing
                ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const ed = useEditorStore.getState();
                    ed.setCurrentPage(index);
                    const sel = ed.selection.filter((id) => objects.some((m) => m.id === id));
                    const ids = sel.includes(o.id) ? sel : [o.id];
                    if (!sel.includes(o.id)) ed.select(ids);
                    window.getSelection()?.removeAllRanges();
                    setMenu({ x: e.clientX, y: e.clientY, ids });
                  }
                : undefined
            }
            onDoubleClick={o.kind === "text" && !pageContent ? () => useEditorStore.getState().setEditing(o.id) : undefined}
          >
            {editing ? <TextEditor obj={o} scale={geom.scale} /> : o.kind === "highlight" ? null : <ObjectView obj={o} scale={geom.scale} />}
          </div>
        );
      })}

      {tool === "select" &&
        !editingId &&
        mine.filter((o) => selection.includes(o.id) && !(o.kind === "text" && o.replaces)).map((o) => <SelectionFrame key={`sel-${o.id}`} obj={o} geom={geom} overlayEl={rootRef.current} />)}

      {menu && <ObjectContextMenu x={menu.x} y={menu.y} ids={menu.ids} onClose={() => setMenu(null)} />}

      {flash?.frames.map((f, i) => (
        <div
          key={`flash-${flash.at}-${i}`}
          className="animate-pulse"
          style={{ ...frameStyle({ ...f, w: f.w + 4, h: f.h + 3 }, geom), pointerEvents: "none", background: "rgb(250 204 21 / 0.45)", outline: "2px solid #f59e0b", borderRadius: 2 }}
        />
      ))}

      {hover && !(hover.kind === "object" && hover.obj.id === editingId) && (
        <div
          style={{
            ...frameStyle(hover.kind === "line" ? hover.line.frame : (mine.find((m) => m.id === hover.obj.id)?.frame ?? hover.obj.frame), geom),
            pointerEvents: "none",
            outline: "1.5px dashed #0b7cf5",
            background: "rgb(11 124 245 / 0.07)",
            borderRadius: 2,
          }}
        />
      )}

      {draft?.kind === "rect" && (
        <div
          style={{
            position: "absolute",
            left: Math.min(draft.x0, draft.x1),
            top: Math.min(draft.y0, draft.y1),
            width: Math.abs(draft.x1 - draft.x0),
            height: Math.abs(draft.y1 - draft.y0),
            pointerEvents: "none",
            border: "1.5px dashed #0b7cf5",
            background: tool === "whiteout" ? "#ffffff" : tool === "highlight" ? "rgb(250 204 21 / 0.4)" : "rgb(11 124 245 / 0.06)",
            borderRadius: tool === "ellipse" ? "50%" : 0,
          }}
        />
      )}
      {draft && draft.kind !== "rect" && (
        <svg className="absolute inset-0 h-full w-full overflow-visible" style={{ pointerEvents: "none" }}>
          {draft.kind === "line" ? (
            <line x1={draft.x0} y1={draft.y0} x2={draft.x1} y2={draft.y1} stroke="#0b7cf5" strokeWidth={2} strokeDasharray="5 4" />
          ) : (
            <polyline
              points={draft.points.join(" ")}
              fill="none"
              stroke={useEditorStore.getState().styles.ink.color}
              strokeWidth={useEditorStore.getState().styles.ink.strokeWidth * geom.scale}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      )}

      {ghost && ghostAsset && (
        <img
          src={ghostAsset.url}
          alt=""
          style={{
            position: "absolute",
            left: ghost.x - ghostW / 2,
            top: ghost.y - (ghostW * ghostAsset.height) / ghostAsset.width / 2,
            width: ghostW,
            opacity: 0.6,
            pointerEvents: "none",
            outline: "1px dashed #0b7cf5",
          }}
        />
      )}
    </div>
  );
}
