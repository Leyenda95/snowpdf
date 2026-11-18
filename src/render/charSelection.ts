import type { PageTextLayout } from "@/pdf/mupdf/ops";
import { joinSelectedLines, type SelectedLine } from "./textJoin";

/*
 * Touch text selection over exact glyph boxes (see the `textLayout` MuPDF op), modelled on the
 * selection of MJ PDF / AndroidPdfViewer and MuPDF's viewer: a long press picks the glyph under
 * the finger (with some tolerance) and grows it to the word; the handles move to the caret nearest
 * to them. Everything here is in PDF user space (points, y up) and pure.
 */

/** Glyph range [start, end) in reading order. */
export interface CharRange {
  start: number;
  end: number;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Layout plus the per-line boxes, computed once per page. */
export interface TextIndex {
  layout: PageTextLayout;
  lines: Box[];
  /** Line of each glyph. */
  lineOf: Int32Array;
}

export function indexLayout(layout: PageTextLayout): TextIndex {
  const n = layout.chars.length;
  const lineOf = new Int32Array(n);
  const lines: Box[] = [];
  const b = layout.boxes;
  for (let l = 0; l + 1 < layout.lineStarts.length; l++) {
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (let i = layout.lineStarts[l]; i < layout.lineStarts[l + 1]; i++) {
      lineOf[i] = l;
      box.x0 = Math.min(box.x0, b[4 * i]);
      box.y0 = Math.min(box.y0, b[4 * i + 1]);
      box.x1 = Math.max(box.x1, b[4 * i + 2]);
      box.y1 = Math.max(box.y1, b[4 * i + 3]);
    }
    lines.push(box);
  }
  return { layout, lines, lineOf };
}

function charBox(t: TextIndex, i: number): Box {
  const b = t.layout.boxes;
  return { x0: b[4 * i], y0: b[4 * i + 1], x1: b[4 * i + 2], y1: b[4 * i + 3] };
}

/** Distance from a point to a box (0 inside). */
function dist(box: Box, x: number, y: number): number {
  const dx = x < box.x0 ? box.x0 - x : x > box.x1 ? x - box.x1 : 0;
  const dy = y < box.y0 ? box.y0 - y : y > box.y1 ? y - box.y1 : 0;
  return Math.hypot(dx, dy);
}

const isBlank = (c: string) => /^\s*$/u.test(c);

/**
 * Glyph under a point, or the nearest non-blank one within `tolerance` (PDF units); -1 if none.
 * Used to start a selection with a long press.
 */
export function hitChar(t: TextIndex, x: number, y: number, tolerance: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let l = 0; l < t.lines.length; l++) {
    if (dist(t.lines[l], x, y) > tolerance) continue;
    for (let i = t.layout.lineStarts[l]; i < t.layout.lineStarts[l + 1]; i++) {
      if (isBlank(t.layout.chars[i])) continue;
      const d = dist(charBox(t, i), x, y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return bestD <= tolerance ? best : -1;
}

const WORD_CHAR = /^[\p{L}\p{N}\p{M}_'’]$/u;

/** The word containing glyph `i` (a lone symbol selects just itself). */
export function wordRange(t: TextIndex, i: number): CharRange {
  const { chars } = t.layout;
  if (!WORD_CHAR.test(chars[i])) return { start: i, end: i + 1 };
  const line = t.lineOf[i];
  const lineStart = t.layout.lineStarts[line];
  const lineEnd = t.layout.lineStarts[line + 1];
  let start = i;
  let end = i + 1;
  while (start > lineStart && WORD_CHAR.test(chars[start - 1])) start--;
  while (end < lineEnd && WORD_CHAR.test(chars[end])) end++;
  return { start, end };
}

/** The line nearest to a point: the one containing its y, else the vertically closest. */
function nearestLine(t: TextIndex, x: number, y: number): number {
  let best = -1;
  let bestKey = Infinity;
  for (let l = 0; l < t.lines.length; l++) {
    const box = t.lines[l];
    const dy = y < box.y0 ? box.y0 - y : y > box.y1 ? y - box.y1 : 0;
    const dx = x < box.x0 ? box.x0 - x : x > box.x1 ? x - box.x1 : 0;
    // Vertical distance first (lines are stacked), horizontal only to break ties (columns).
    const key = dy * 1000 + dx;
    if (key < bestKey) {
      bestKey = key;
      best = l;
    }
  }
  return best;
}

/**
 * Caret position (0..n, between glyphs) nearest to a point: the line under it, then the glyph
 * boundary closest in x. Used while dragging a selection handle.
 */
export function caretAt(t: TextIndex, x: number, y: number): number {
  const l = nearestLine(t, x, y);
  if (l < 0) return 0;
  const start = t.layout.lineStarts[l];
  const end = t.layout.lineStarts[l + 1];
  for (let i = start; i < end; i++) {
    const box = charBox(t, i);
    if (x < (box.x0 + box.x1) / 2) return i;
  }
  return end;
}

/** One box per line touched by the range (the union of its selected glyphs). */
export function rangeBoxes(t: TextIndex, r: CharRange): Box[] {
  const out: Box[] = [];
  if (r.end <= r.start) return out;
  let cur: Box | null = null;
  let curLine = -1;
  for (let i = r.start; i < r.end; i++) {
    const line = t.lineOf[i];
    const box = charBox(t, i);
    if (line !== curLine || !cur) {
      cur = { ...box };
      curLine = line;
      out.push(cur);
    } else {
      cur.x0 = Math.min(cur.x0, box.x0);
      cur.y0 = Math.min(cur.y0, box.y0);
      cur.x1 = Math.max(cur.x1, box.x1);
      cur.y1 = Math.max(cur.y1, box.y1);
    }
  }
  return out;
}

/** The selected text, lines joined like the desktop selection (paragraphs, hyphenation). */
export function rangeText(t: TextIndex, r: CharRange): string {
  // MuPDF's text blocks are paragraphs: join the lines inside each one, blocks with a line break.
  const blocks: SelectedLine[][] = [];
  let lastBlock = NaN;
  let i = r.start;
  while (i < r.end) {
    const line = t.lineOf[i];
    const end = Math.min(r.end, t.layout.lineStarts[line + 1]);
    const box = t.lines[line];
    const block = t.layout.lineBlocks[line];
    if (block !== lastBlock) blocks.push([]);
    lastBlock = block;
    blocks[blocks.length - 1].push({
      text: t.layout.chars.slice(i, end).join(""),
      inlineStart: box.x0,
      inlineEnd: box.x1,
      // Block axis grows downwards: flip PDF y.
      blockStart: -box.y1,
      blockEnd: -box.y0,
      group: 0,
    });
    i = end;
  }
  return blocks
    .map(joinSelectedLines)
    .filter((s) => s !== "")
    .join("\n");
}

/** The whole page. */
export function allRange(t: TextIndex): CharRange {
  return { start: 0, end: t.layout.chars.length };
}
