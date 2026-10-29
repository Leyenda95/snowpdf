import type { Msg } from "@/i18n";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { getSource } from "@/model/registry";
import { callMupdf } from "@/pdf/mupdf/client";
import type { Frame, PdfBox } from "@/model/types";
import { frameBBox } from "@/pdf/objectGeometry";
import { textWidth } from "@/pdf/textLayout";

/**
 * Page text as positioned runs in user space (from pdf.js), grouped into lines for
 * "edit existing text" and searched for the search panel / search & redact.
 */

export interface TextRun {
  str: string;
  /** Baseline origin, user space. */
  x: number;
  y: number;
  /** Unit vector along the baseline. */
  dx: number;
  dy: number;
  /** Advance length along the baseline. */
  width: number;
  size: number;
  /** Horizontal scale of the glyphs relative to their height (Tz / condensed text matrix). */
  hScale: number;
  fontName: string;
  /** Generic family reported by pdf.js ("serif", "sans-serif", "monospace"). */
  family: string;
}

const cache = new Map<string, Promise<TextRun[]>>();

/** Horizontal scale of a pdf.js text transform: baseline-axis length over glyph-height-axis length. */
export function runHScale(a: number, b: number, c: number, d: number): number {
  const v = Math.hypot(c, d);
  const h = Math.hypot(a, b);
  return v > 0 && h > 0 ? h / v : 1;
}

export function getTextRuns(sourceId: string, index: number): Promise<TextRun[]> {
  const key = `${sourceId}:${index}`;
  let runs = cache.get(key);
  if (!runs) {
    runs = (async () => {
      const page = await getSource(sourceId).pdf.getPage(index + 1);
      const tc = await page.getTextContent();
      const out: TextRun[] = [];
      for (const raw of tc.items) {
        const item = raw as TextItem;
        if (typeof item.str !== "string" || !item.str.trim() || !item.transform) continue;
        const [a, b, c, d, e, f] = item.transform as number[];
        const len = Math.hypot(a, b) || 1;
        out.push({
          str: item.str,
          x: e,
          y: f,
          dx: a / len,
          dy: b / len,
          width: item.width,
          size: Math.hypot(c, d) || item.height || 10,
          hScale: runHScale(a, b, c, d),
          fontName: item.fontName,
          family: tc.styles[item.fontName]?.fontFamily ?? "sans-serif",
        });
      }
      return out;
    })();
    runs.catch(() => cache.delete(key));
    cache.set(key, runs);
  }
  return runs;
}

const charsCache = new Map<string, Promise<CharInfo[]>>();

/** Exact glyph positions of a page (MuPDF), cached; empty when unavailable (the split then estimates). */
export function getPageChars(sourceId: string, index: number): Promise<CharInfo[]> {
  const key = `${sourceId}:${index}`;
  let chars = charsCache.get(key);
  if (!chars) {
    chars = callMupdf("textChars", { bytes: getSource(sourceId).bytes, pageIndex: index }).catch(() => []);
    charsCache.set(key, chars);
  }
  return chars;
}

export function clearTextCache(sourceId?: string): void {
  if (!sourceId) {
    cache.clear();
    charsCache.clear();
    return;
  }
  for (const map of [cache, charsCache]) for (const key of map.keys()) if (key.startsWith(`${sourceId}:`)) map.delete(key);
}

/** Frame covering characters [from, to) of a run (glyph box ≈ descent 0.22, ascent 0.88). */
export function runFrame(run: TextRun, from = 0, to = run.str.length): Frame {
  // Split the run's advance proportionally to real glyph widths (Helvetica/Times/Courier
  // metrics by family): much closer than assuming equal-width characters.
  const style = { font: run.family === "serif" ? "times" : run.family === "monospace" ? "courier" : "helvetica", bold: false, italic: false } as const;
  const total = textWidth(run.str, style, 1) || 1;
  const a0 = (run.width * textWidth(run.str.slice(0, from), style, 1)) / total;
  const a1 = (run.width * textWidth(run.str.slice(0, to), style, 1)) / total;
  const mid = (a0 + a1) / 2;
  const up = run.size * 0.33; // centre of the glyph box above the baseline
  return {
    cx: run.x + run.dx * mid - run.dy * up,
    cy: run.y + run.dy * mid + run.dx * up,
    w: Math.max(1, a1 - a0),
    h: run.size * 1.1,
    rot: (Math.atan2(run.dy, run.dx) * 180) / Math.PI,
  };
}

/** One glyph as reported by MuPDF (see the `textChars` op): origin and end of its advance, user space. */
export interface CharInfo {
  c: string;
  x: number;
  y: number;
  ex: number;
  ey: number;
}

/** Bounding box of a run's glyph band (descent 0.22, ascent 0.88), user space. */
function runBand(r: TextRun): PdfBox {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [a, p] of [
    [0, -0.22],
    [r.width, -0.22],
    [0, 0.88],
    [r.width, 0.88],
  ]) {
    xs.push(r.x + r.dx * a - r.dy * p * r.size);
    ys.push(r.y + r.dy * a + r.dx * p * r.size);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const BAND_TOLERANCE = 1;

/** Whether a run straddles the edge of any box (it overlaps one without lying inside it). */
export function runNeedsSplit(r: TextRun, boxes: PdfBox[]): boolean {
  const b = runBand(r);
  return boxes.some((x) => {
    const touches = b[0] < x[2] && b[2] > x[0] && b[1] < x[3] && b[3] > x[1];
    const inside = b[0] >= x[0] - BAND_TOLERANCE && b[2] <= x[2] + BAND_TOLERANCE && b[1] >= x[1] - BAND_TOLERANCE * 4 && b[3] <= x[3] + BAND_TOLERANCE * 4;
    return touches && !inside;
  });
}

const isBlank = (ch: string) => /^\s$/u.test(ch);

/**
 * Cut runs at the edges of `boxes` (link rectangles) so a box never shares a run with text
 * outside it. Glyph positions come from `chars` (MuPDF) when they match the run's characters 1:1,
 * otherwise they are estimated with standard-font metrics. Runs that need no cut come back as is.
 */
export function splitRunsAtBoxes(runs: TextRun[], boxes: PdfBox[], chars: CharInfo[] = []): TextRun[] {
  if (!boxes.length) return runs;
  const out: TextRun[] = [];
  for (const run of runs) {
    out.push(...(runNeedsSplit(run, boxes) ? splitRun(run, boxes, chars) : [run]));
  }
  return out;
}

function splitRun(run: TextRun, boxes: PdfBox[], chars: CharInfo[]): TextRun[] {
  const str = run.str.normalize("NFC");
  const glyphs = Array.from(str);
  if (glyphs.length < 2) return [run];
  const s0 = run.x * run.dx + run.y * run.dy;
  const perp = -run.x * run.dy + run.y * run.dx;
  const alongOf = (x: number, y: number) => x * run.dx + y * run.dy - s0;

  // Extents [from, to] along the baseline (relative to the run's origin) of each glyph.
  let extents: [number, number][] | null = null;
  const real = chars
    .filter((ch) => {
      const a = alongOf(ch.x, ch.y);
      return Math.abs(-ch.x * run.dy + ch.y * run.dx - perp) < 0.35 * run.size && a >= -0.5 && a <= run.width + 0.5 && !isBlank(ch.c);
    })
    .sort((p, q) => alongOf(p.x, p.y) - alongOf(q.x, q.y));
  const idx = glyphs.map((g, i) => (isBlank(g) ? -1 : i)).filter((i) => i >= 0);
  if (real.length && real.length === idx.length && real.every((ch, k) => ch.c.normalize("NFC") === glyphs[idx[k]])) {
    extents = new Array(glyphs.length);
    idx.forEach((gi, k) => {
      extents![gi] = [alongOf(real[k].x, real[k].y), alongOf(real[k].ex, real[k].ey)];
    });
    // Blanks fill the gaps between their neighbours.
    for (let i = 0; i < glyphs.length; ) {
      if (extents[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < glyphs.length && !extents[j]) j++;
      const from = i > 0 ? extents[i - 1][1] : 0;
      const to = j < glyphs.length ? extents[j][0] : run.width;
      for (let k = i; k < j; k++) {
        extents[k] = [from + ((to - from) * (k - i)) / (j - i), from + ((to - from) * (k - i + 1)) / (j - i)];
      }
      i = j;
    }
  }
  if (!extents) {
    const style = { font: run.family === "serif" ? "times" : run.family === "monospace" ? "courier" : "helvetica", bold: false, italic: false } as const;
    const total = textWidth(str, style, 1) || 1;
    let prefix = "";
    let prev = 0;
    extents = glyphs.map((g) => {
      prefix += g;
      const end = (run.width * textWidth(prefix, style, 1)) / total;
      const e: [number, number] = [prev, end];
      prev = end;
      return e;
    });
  }

  // Box of every glyph (-1 = none). A blank only joins a box when both neighbours are in it.
  const boxOf = glyphs.map((_, i) => {
    if (isBlank(glyphs[i])) return -2;
    const mid = (extents![i][0] + extents![i][1]) / 2;
    const cx = run.x + run.dx * mid - run.dy * run.size * 0.33;
    const cy = run.y + run.dy * mid + run.dx * run.size * 0.33;
    return boxes.findIndex((b) => cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3]);
  });
  for (let i = 0; i < glyphs.length; i++) {
    if (boxOf[i] !== -2) continue;
    let p = i - 1;
    while (p >= 0 && boxOf[p] === -2) p--;
    let n = i + 1;
    while (n < glyphs.length && boxOf[n] === -2) n++;
    boxOf[i] = p >= 0 && n < glyphs.length && boxOf[p] === boxOf[n] ? boxOf[p] : -1;
  }

  const parts: TextRun[] = [];
  for (let i = 0; i < glyphs.length; ) {
    let j = i;
    while (j < glyphs.length && boxOf[j] === boxOf[i]) j++;
    const from = extents[i][0];
    const to = extents[j - 1][1];
    parts.push({ ...run, str: glyphs.slice(i, j).join(""), x: run.x + run.dx * from, y: run.y + run.dy * from, width: Math.max(0, to - from) });
    i = j;
  }
  return parts.length > 1 ? parts : [run];
}

/** A link rectangle's characters inside a line: `box` indexes the boxes given to groupLines, [start, end) offsets into `text`. */
export interface LineLinkRange {
  box: number;
  start: number;
  end: number;
}

export interface TextLine {
  text: string;
  frame: Frame;
  box: PdfBox;
  size: number;
  /** Median horizontal scale of its runs (see TextRun.hScale). */
  hScale: number;
  fontName: string;
  family: string;
  runs: TextRun[];
  /** Which characters of `text` lie inside which of the boxes given to groupLines (links). */
  linkRanges: LineLinkRange[];
}

/**
 * Group runs into visual lines (same direction, same baseline, horizontally adjacent).
 * `linkBoxes` (link rectangles) do not split lines: they only tell which characters of each line
 * sit inside which box (`linkRanges`; cut the runs at the boxes first, see splitRunsAtBoxes).
 */
export function groupLines(runs: TextRun[], linkBoxes: PdfBox[] = []): TextLine[] {
  const boxOf = (r: TextRun): number => {
    if (!linkBoxes.length) return -1;
    const mid = r.width / 2;
    const up = r.size * 0.33;
    const cx = r.x + r.dx * mid - r.dy * up;
    const cy = r.y + r.dy * mid + r.dx * up;
    return linkBoxes.findIndex((b) => cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3]);
  };
  const keyed = runs.map((r) => ({
    r,
    angle: Math.round((Math.atan2(r.dy, r.dx) * 180) / Math.PI),
    perp: -r.x * r.dy + r.y * r.dx,
    along: r.x * r.dx + r.y * r.dy,
    box: boxOf(r),
  }));
  keyed.sort((p, q) => p.angle - q.angle || q.perp - p.perp || p.along - q.along);

  const lines: TextLine[] = [];
  let cur: { items: typeof keyed; end: number } | null = null;
  const flush = () => {
    if (!cur) return;
    const items = cur.items;
    const first = items[0];
    let text = "";
    let prevEnd = first.along;
    const spans: { box: number; start: number; end: number }[] = [];
    for (const it of items) {
      const gap = it.along - prevEnd;
      if (text && gap > it.r.size * 0.18 && !text.endsWith(" ") && !it.r.str.startsWith(" ")) text += " ";
      spans.push({ box: it.box, start: text.length, end: text.length + it.r.str.length });
      text += it.r.str;
      prevEnd = it.along + it.r.width;
    }
    // Link ranges in the trimmed text. Pieces in the same box merge (blank pieces between them
    // are transparent); blanks belong to no link, so ranges are trimmed of them.
    const lead = text.length - text.trimStart().length;
    const trimmed = text.trim();
    const linkRanges: LineLinkRange[] = [];
    let open: LineLinkRange | null = null;
    for (const sp of spans) {
      if (sp.box < 0 || !text.slice(sp.start, sp.end).trim()) {
        if (sp.box < 0 && text.slice(sp.start, sp.end).trim()) open = null;
        continue;
      }
      let a = sp.start;
      let b = sp.end;
      while (a < b && isBlank(text[a])) a++;
      while (b > a && isBlank(text[b - 1])) b--;
      a = Math.max(0, a - lead);
      b = Math.min(trimmed.length, b - lead);
      if (b <= a) continue;
      if (open && open.box === sp.box) open.end = b;
      else {
        open = { box: sp.box, start: a, end: b };
        linkRanges.push(open);
      }
    }
    const size = items.map((i) => i.r.size).sort((a, b) => a - b)[Math.floor(items.length / 2)];
    const hScale = items.map((i) => i.r.hScale).sort((a, b) => a - b)[Math.floor(items.length / 2)] || 1;
    const start = first.along;
    const end = cur.end;
    const { dx, dy } = first.r;
    const mid = (start + end) / 2;
    const up = size * 0.33;
    const frame: Frame = {
      cx: mid * dx - first.perp * dy - dy * up,
      cy: mid * dy + first.perp * dx + dx * up,
      w: Math.max(1, end - start),
      h: size * 1.15,
      rot: first.angle,
    };
    // The line's font is the one covering most of its characters, not the first run's.
    const chars = new Map<string, { run: TextRun; n: number }>();
    for (const it of items) {
      const c = chars.get(it.r.fontName) ?? { run: it.r, n: 0 };
      c.n += it.r.str.length;
      chars.set(it.r.fontName, c);
    }
    const main = [...chars.values()].sort((p, q) => q.n - p.n)[0].run;
    lines.push({ text: trimmed, frame, box: frameBBox(frame), size, hScale, fontName: main.fontName, family: main.family, runs: items.map((i) => i.r), linkRanges });
    cur = null;
  };

  for (const k of keyed) {
    const last = cur?.items[cur.items.length - 1];
    const sameLine =
      last &&
      last.angle === k.angle &&
      Math.abs(last.perp - k.perp) < Math.max(last.r.size, k.r.size) * 0.35 &&
      k.along - cur!.end < Math.max(last.r.size, k.r.size) * 1.6 &&
      k.along - cur!.end > -Math.max(last.r.size, k.r.size) * 0.6;
    if (!sameLine) {
      flush();
      cur = { items: [k], end: k.along + k.r.width };
    } else {
      cur!.items.push(k);
      cur!.end = Math.max(cur!.end, k.along + k.r.width);
    }
  }
  flush();
  return lines;
}

/** Lower-case, accent-free form used for searching ("Canción" matches "cancion"). */
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export interface TextMatch {
  /** One frame per run the match spans. */
  frames: Frame[];
  snippet: string;
}

/**
 * Generic line matcher: `find` receives each visual line's text and returns [start, end)
 * character ranges; they are mapped back to frames over the runs they cover.
 */
function matchLines(runs: TextRun[], find: (text: string) => [number, number][]): TextMatch[] {
  const matches: TextMatch[] = [];
  for (const line of groupLines(runs)) {
    // Concatenate the line's runs, remembering where each run starts.
    let joined = "";
    const spans: { run: TextRun; start: number }[] = [];
    for (const run of line.runs) {
      if (joined && !joined.endsWith(" ") && !run.str.startsWith(" ")) joined += " ";
      spans.push({ run, start: joined.length });
      joined += run.str;
    }
    for (const [at, end] of find(joined)) {
      const frames: Frame[] = [];
      for (const { run, start } of spans) {
        const from = Math.max(at, start) - start;
        const to = Math.min(end, start + run.str.length) - start;
        if (to > from) frames.push(runFrame(run, from, to));
      }
      if (frames.length) matches.push({ frames, snippet: joined.slice(Math.max(0, at - 30), end + 30) });
    }
  }
  return matches;
}

/** Find `query` (accent/case-insensitive, may span runs of the same line) in a page. */
export function searchRuns(runs: TextRun[], query: string): TextMatch[] {
  const q = foldText(query.trim());
  if (!q) return [];
  return matchLines(runs, (text) => {
    // NFD folding can change string length; fold per character to keep indices aligned.
    const folded = Array.from(text, (ch) => foldText(ch).slice(0, 1) || ch).join("");
    const out: [number, number][] = [];
    for (let at = folded.indexOf(q); at !== -1; at = folded.indexOf(q, at + q.length)) out.push([at, at + q.length]);
    return out;
  });
}

/** Sensitive-data patterns for "search & redact" (Spanish formats first). `label` is Spanish source text. */
export const REDACT_PATTERNS: { id: string; label: Msg; regex: RegExp }[] = [
  { id: "email", label: "Correos electrónicos", regex: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { id: "phone", label: "Teléfonos", regex: /(?:\+\d{2}\s?)?(?:[6789]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}|[6789]\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2})\b/g },
  { id: "dni", label: "DNI / NIE", regex: /\b(?:\d{8}|[XYZ]\d{7})[\s-]?[A-HJ-NP-TV-Z]\b/gi },
  { id: "iban", label: "IBAN", regex: /\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]{4}){4,7}(?:[\s-]?[A-Z0-9]{1,3})?\b/g },
  { id: "card", label: "Tarjetas bancarias", regex: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g },
  { id: "date", label: "Fechas", regex: /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g },
];

export function searchRunsPattern(runs: TextRun[], regex: RegExp): TextMatch[] {
  return matchLines(runs, (text) => {
    const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
    return Array.from(text.matchAll(re), (m) => [m.index!, m.index! + m[0].length] as [number, number]);
  });
}
