import { newId } from "@/model/registry";
import type { FontAsset, FontFamily, PdfBox, TextObject } from "@/model/types";
import { frameToUser } from "@/pdf/objectGeometry";
import { TEXT_PADDING, isSpace, layoutText } from "@/pdf/textLayout";
import { fontStyleFlags, type PdfjsFont } from "@/render/sourceFonts";
import type { TextLine } from "@/render/textContent";
import type { PageGeometry } from "../viewer/geometry";

/**
 * "Edit existing text": turn a line of the original page into an editable text object that
 * replaces it (the original glyphs are removed for real on export). The text reuses the
 * document's font when possible; the closest standard font covers the rest.
 */

/** Typical justified lines add well under this (× font size) to each space. */
const MAX_JUSTIFY_SPACING = 1;

/** Closest standard font: the fallback for letters the document font lacks (or all of them). */
export function guessFont(line: TextLine, font: PdfjsFont | null): { font: FontFamily; bold: boolean; italic: boolean } {
  const { name, bold, italic } = fontStyleFlags(font);
  const lower = name.toLowerCase();
  const mono = /courier|mono|consol/.test(lower) || line.family === "monospace";
  const serif = !mono && ((/times|serif|roman|georgia|garamond|cambria|book|minion/.test(lower) && !/sans/.test(lower)) || line.family === "serif");
  return { font: mono ? "courier" : serif ? "times" : "helvetica", bold, italic };
}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Foreground (text) and background colours inside a rectangle of the rendered page. */
export function sampleColors(canvas: HTMLCanvasElement | null, rect: { x: number; y: number; w: number; h: number }): { fg: string; bg: string } {
  const fallback = { fg: "#000000", bg: "#ffffff" };
  if (!canvas) return fallback;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return fallback;
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const w = Math.min(canvas.width - x, Math.ceil(rect.w));
  const h = Math.min(canvas.height - y, Math.ceil(rect.h));
  if (w < 2 || h < 2) return fallback;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(x, y, w, h).data;
  } catch {
    return fallback;
  }
  // Background: most frequent (quantised) colour on the border of the box.
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  const add = (i: number) => {
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const c = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n++;
    c.r += data[i];
    c.g += data[i + 1];
    c.b += data[i + 2];
    counts.set(key, c);
  };
  for (let i = 0; i < w; i++) {
    add(i * 4);
    add(((h - 1) * w + i) * 4);
  }
  for (let j = 0; j < h; j++) {
    add(j * w * 4);
    add((j * w + w - 1) * 4);
  }
  const top = [...counts.values()].sort((p, q) => q.n - p.n)[0];
  const bg = { r: top.r / top.n, g: top.g / top.n, b: top.b / top.n };
  // Foreground: average of the 8 % of pixels that differ most from the background.
  const dist: { d: number; i: number }[] = [];
  for (let i = 0; i < data.length; i += 4) {
    dist.push({ d: (data[i] - bg.r) ** 2 + (data[i + 1] - bg.g) ** 2 + (data[i + 2] - bg.b) ** 2, i });
  }
  dist.sort((p, q) => q.d - p.d);
  const take = dist.slice(0, Math.max(1, Math.floor(dist.length * 0.08)));
  if (take[0].d < 900) return { fg: "#000000", bg: hex(bg.r, bg.g, bg.b) };
  const sum = take.reduce((acc, { i }) => ({ r: acc.r + data[i], g: acc.g + data[i + 1], b: acc.b + data[i + 2] }), { r: 0, g: 0, b: 0 });
  const fg = { r: sum.r / take.length, g: sum.g / take.length, b: sum.b / take.length };
  // Anti-aliasing tints dark text with the background: snap near-black to black.
  const nearBlack = Math.max(fg.r, fg.g, fg.b) < 70;
  return { fg: nearBlack ? "#000000" : hex(fg.r, fg.g, fg.b), bg: hex(bg.r, bg.g, bg.b) };
}

function grow(box: PdfBox, by: number): PdfBox {
  return [box[0] - by, box[1] - by, box[2] + by, box[3] + by];
}

export function createReplacement(
  pageId: string,
  line: TextLine,
  geom: PageGeometry,
  canvas: HTMLCanvasElement | null,
  font: PdfjsFont | null,
  source: FontAsset | null,
): TextObject {
  const fallback = guessFont(line, font);
  const style = {
    ...fallback,
    // The document font is already bold/italic: the fallback must match it.
    ...(source ? { bold: source.bold, italic: source.italic } : {}),
    size: Math.max(4, Math.round(line.size * 2) / 2),
    lineHeight: 1.2,
    sourceFont: source?.id ?? null,
    useSourceFont: !!source,
    documentFont: source?.id ?? null,
  };
  // A line of a justified paragraph is wider than its natural width: keep that width by
  // stretching the spaces, as the original does.
  const natural = layoutText({ text: line.text, ...style }).width - 2 * TEXT_PADDING;
  const spaces = [...line.text].filter(isSpace).length;
  const extra = spaces ? (line.frame.w - natural) / spaces : 0;
  const justifyWidth = extra > style.size * 0.02 && extra <= style.size * MAX_JUSTIFY_SPACING ? line.frame.w : null;
  const lay = layoutText({ text: line.text, ...style, justifyWidth });

  // Colours from the rendered bitmap, inside the line's box.
  let colors = { fg: "#000000", bg: "#ffffff" };
  if (canvas) {
    const k = canvas.width / geom.full.width;
    const corners = [
      [line.box[0], line.box[1]],
      [line.box[2], line.box[3]],
    ].map(([x, y]) => geom.full.toView(x, y));
    const x0 = Math.min(corners[0].x, corners[1].x);
    const y0 = Math.min(corners[0].y, corners[1].y);
    colors = sampleColors(canvas, {
      x: x0 * k,
      y: y0 * k,
      w: Math.abs(corners[1].x - corners[0].x) * k,
      h: Math.abs(corners[1].y - corners[0].y) * k,
    });
  }

  // Place the new box so its first baseline and left edge coincide with the original line.
  // groupLines() centres the line frame 0.33·size above the baseline.
  const baselineY = -0.33 * line.size;
  const local = {
    x: -line.frame.w / 2 + lay.width / 2 - TEXT_PADDING,
    y: baselineY - lay.height / 2 + TEXT_PADDING + lay.baseline,
  };
  const c = frameToUser(line.frame, local);
  return {
    id: newId("obj"),
    pageId,
    kind: "text",
    frame: { cx: c.x, cy: c.y, w: lay.width, h: lay.height, rot: line.frame.rot },
    opacity: 1,
    text: line.text,
    ...style,
    justifyWidth,
    color: colors.fg,
    align: "left",
    background: colors.bg,
    replaces: [grow(line.box, 0.4)],
  };
}
