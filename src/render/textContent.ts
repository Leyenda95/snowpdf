import type { Msg } from "@/i18n";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { getSource } from "@/model/registry";
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
  fontName: string;
  /** Generic family reported by pdf.js ("serif", "sans-serif", "monospace"). */
  family: string;
}

const cache = new Map<string, Promise<TextRun[]>>();

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

export function clearTextCache(sourceId?: string): void {
  if (!sourceId) return cache.clear();
  for (const key of cache.keys()) if (key.startsWith(`${sourceId}:`)) cache.delete(key);
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

export interface TextLine {
  text: string;
  frame: Frame;
  box: PdfBox;
  size: number;
  fontName: string;
  family: string;
  runs: TextRun[];
}

/** Group runs into visual lines (same direction, same baseline, horizontally adjacent). */
export function groupLines(runs: TextRun[]): TextLine[] {
  const keyed = runs.map((r) => ({
    r,
    angle: Math.round((Math.atan2(r.dy, r.dx) * 180) / Math.PI),
    perp: -r.x * r.dy + r.y * r.dx,
    along: r.x * r.dx + r.y * r.dy,
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
    for (const it of items) {
      const gap = it.along - prevEnd;
      if (text && gap > it.r.size * 0.18 && !text.endsWith(" ") && !it.r.str.startsWith(" ")) text += " ";
      text += it.r.str;
      prevEnd = it.along + it.r.width;
    }
    const size = items.map((i) => i.r.size).sort((a, b) => a - b)[Math.floor(items.length / 2)];
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
    lines.push({ text: text.trim(), frame, box: frameBBox(frame), size, fontName: main.fontName, family: main.family, runs: items.map((i) => i.r) });
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
