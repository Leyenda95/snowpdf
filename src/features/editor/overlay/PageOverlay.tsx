import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useDocStore } from "@/model/docStore";
import { usePrefs } from "@/model/prefs";
import { addObjects, updateObject } from "@/model/docActions";
import { getAsset, getSource, newId } from "@/model/registry";
import type { EditorObject, FontAsset, Frame, InkObject, PageRef } from "@/model/types";
import { boxesIntersect, userToFrame } from "@/pdf/objectGeometry";
import { pdfjsFont, resolveSourceFont, type PdfjsFont } from "@/render/sourceFonts";
import { getTextRuns, groupLines, type TextLine } from "@/render/textContent";
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
import { createReplacement } from "./editText";
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
  const [hoverLine, setHoverLine] = useState<TextLine | null>(null);
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

  // ---- text lines for "edit text" and the magic eraser (a click erases the line)
  const linesTool = tool === "editText" || tool === "erase";
  useEffect(() => {
    setHoverLine(null);
    if (!linesTool || !page.sourceId) {
      setLines(null);
      return;
    }
    let alive = true;
    getTextRuns(page.sourceId, page.sourceIndex)
      .then((runs) => alive && setLines(groupLines(runs)))
      .catch(() => alive && setLines([]));
    return () => {
      alive = false;
    };
  }, [linesTool, page.sourceId, page.sourceIndex]);

  // The original line of text under a point of the overlay (not one already replaced by an edit).
  const lineAt = (p: { x: number; y: number }): TextLine | null => {
    if (!lines) return null;
    const u = geom.visible.toUser(p.x, p.y);
    const replaced = mine.flatMap((o) => (o.kind === "text" && o.replaces ? o.replaces : []));
    return (
      lines.find((l) => {
        const q = userToFrame(l.frame, u);
        return Math.abs(q.x) <= l.frame.w / 2 + 2 && Math.abs(q.y) <= l.frame.h / 2 && !replaced.some((b) => boxesIntersect(b, l.box));
      }) ?? null
    );
  };

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
        const line = hoverLine;
        const sourceId = page.sourceId;
        if (!line || !sourceId) return;
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
          const obj = createReplacement(page.id, line, geom, pageCanvas(), font, source);
          addObjects([obj]);
          setHoverLine(null);
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
    if (linesTool && lines) setHoverLine(lineAt(p));
  };

  const objectsInteractive = tool === "select" && !placing;
  const cursor = placing
    ? "copy"
    : tool === "hand"
      ? "grab"
      : tool === "text" || tool === "date"
        ? "text"
        : tool === "editText"
          ? hoverLine
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
          onPointerMove={onSurfaceMove}
          onPointerLeave={() => {
            setGhost(null);
            setHoverLine(null);
          }}
        />
      )}

      {mine.map((o) => {
        const editing = editingId === o.id && o.kind === "text";
        const editableText = o.kind === "text" && (tool === "text" || tool === "editText");
        const interactive = objectsInteractive || editableText || editing;
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
            onDoubleClick={o.kind === "text" ? () => useEditorStore.getState().setEditing(o.id) : undefined}
          >
            {editing ? <TextEditor obj={o} scale={geom.scale} /> : o.kind === "highlight" ? null : <ObjectView obj={o} scale={geom.scale} />}
          </div>
        );
      })}

      {tool === "select" &&
        !editingId &&
        mine.filter((o) => selection.includes(o.id)).map((o) => <SelectionFrame key={`sel-${o.id}`} obj={o} geom={geom} overlayEl={rootRef.current} />)}

      {menu && <ObjectContextMenu x={menu.x} y={menu.y} ids={menu.ids} onClose={() => setMenu(null)} />}

      {flash?.frames.map((f, i) => (
        <div
          key={`flash-${flash.at}-${i}`}
          className="animate-pulse"
          style={{ ...frameStyle({ ...f, w: f.w + 4, h: f.h + 3 }, geom), pointerEvents: "none", background: "rgb(250 204 21 / 0.45)", outline: "2px solid #f59e0b", borderRadius: 2 }}
        />
      ))}

      {hoverLine && (
        <div
          style={{
            ...frameStyle(hoverLine.frame, geom),
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
