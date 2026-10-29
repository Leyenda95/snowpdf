import type { PdfBox, TextLink, TextObject } from "@/model/types";
import { frameBBox, frameToUser } from "./objectGeometry";
import { TEXT_PADDING, fontChain, layoutText, lineStartX, splitSpans } from "./textLayout";

/**
 * Links that follow an edited line of text ("edit text" replacements): the Link annotations
 * whose text a replacement carries are re-fitted to the new text.
 */

/** Rectangles closer than this (points, per edge) count as the same one. */
export const LINK_RECT_TOLERANCE = 0.5;

/** A link belongs to a line when at least this share of the link lies inside the (grown) line box. */
export const LINK_LINE_COVERAGE = 0.8;

/** Normalised (min/max) copy of a rectangle given in any corner order. */
export function normalizeBox(r: ArrayLike<number>): PdfBox {
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}

export function sameBox(a: PdfBox, b: PdfBox, tol = LINK_RECT_TOLERANCE): boolean {
  return a.every((v, i) => Math.abs(v - b[i]) <= tol);
}

/**
 * Keep link ranges attached to their characters when `oldText` becomes `newText`. The edit is
 * the span between the common prefix and the common suffix; ranges before it stay, ranges
 * after it shift, typing right at the end of (or inside) a link grows it, and removed text
 * shrinks it (an emptied range keeps start === end). `caret` (the caret position after the change)
 * pins down the edit when equal characters make it ambiguous.
 */
export function shiftLinkRanges(links: TextLink[] | null, oldText: string, newText: string, caret?: number): TextLink[] | null {
  if (!links?.length || oldText === newText) return links;
  const minLen = Math.min(oldText.length, newText.length);
  let p = 0;
  while (p < minLen && oldText[p] === newText[p]) p++;
  let oldB: number;
  let newB: number;
  if (caret !== undefined && caret >= 0 && caret <= newText.length && oldText.endsWith(newText.slice(caret))) {
    // The caret after the change tells where the edit ended: no ambiguity between equal characters.
    const s = newText.length - caret;
    p = Math.min(p, caret, oldText.length - s);
    oldB = oldText.length - s;
    newB = caret;
  } else {
    let s = 0;
    while (s < minLen - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++;
    oldB = oldText.length - s;
    newB = newText.length - s;
  }
  const delta = newB - oldB;
  const insertion = oldB === p;
  return links.map((l) => {
    let { start, end } = l;
    if (insertion) {
      if (p <= start) {
        start += delta;
        end += delta;
      } else if (p <= end) end += delta;
    } else if (end <= p) {
      // Wholly before the edit.
    } else if (start >= oldB) {
      start += delta;
      end += delta;
    } else {
      const a = start <= p ? start : newB;
      const b = end >= oldB ? end + delta : p;
      start = a;
      end = b;
      if (end <= start) start = end = Math.min(start, p);
    }
    return { ...l, start, end };
  });
}

/**
 * Where each link range of a text object lies now, in user space: `box` is null when the range is
 * empty (its text was removed). Uses the same layout as the screen and the export, so it matches
 * what is drawn; multi-line text gives the union of the pieces on each line.
 */
export function linkBoxes(obj: TextObject): { rect: PdfBox; box: PdfBox | null }[] {
  if (!obj.links?.length) return [];
  const lay = layoutText(obj);
  const chain = fontChain(obj);
  const hScale = obj.hScale ?? 1;
  const f = obj.frame;
  const lineStarts: number[] = [];
  let at = 0;
  for (const line of obj.text.split(/\r?\n/)) {
    lineStarts.push(at);
    at += line.length;
    if (obj.text[at] === "\r") at++;
    at++;
  }
  return obj.links.map((l) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    lay.lines.forEach((line, i) => {
      const a = Math.max(l.start, lineStarts[i]) - lineStarts[i];
      const b = Math.min(l.end, lineStarts[i] + line.text.length) - lineStarts[i];
      if (b <= a) return;
      const before = splitSpans(line.text.slice(0, a), chain, obj.size, lay.wordSpacing, hScale).width;
      const upto = splitSpans(line.text.slice(0, b), chain, obj.size, lay.wordSpacing, hScale).width;
      const left = lineStartX(obj.align, f.w, line.width);
      const top = f.h / 2 - TEXT_PADDING - i * lay.lineHeight;
      x0 = Math.min(x0, left + before);
      x1 = Math.max(x1, left + upto);
      y0 = Math.min(y0, top - lay.lineHeight);
      y1 = Math.max(y1, top);
    });
    if (!(x1 > x0)) return { rect: l.rect, box: null };
    const pts = [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ].map((q) => frameToUser(f, q));
    const xs = pts.map((q) => q.x);
    const ys = pts.map((q) => q.y);
    return { rect: l.rect, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as PdfBox };
  });
}

/** User-space bounding box of the text's content area: the frame minus its padding, rotated with it. */
export function textInkBox(obj: TextObject): PdfBox {
  const f = obj.frame;
  return frameBBox({ ...f, w: Math.max(0, f.w - 2 * TEXT_PADDING), h: Math.max(0, f.h - 2 * TEXT_PADDING) });
}
