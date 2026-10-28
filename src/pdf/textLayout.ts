import { StandardFontEmbedder } from "@cantoo/pdf-lib";
import { standardFontName } from "./fonts";
import { fontProgram, type GlyphSource } from "./fontProgram";
import type { FontFamily, TextObject } from "@/model/types";

/**
 * Text box layout shared by the on-screen editor and the PDF export, so a text object is
 * exported exactly where it was seen. Widths come from the AFM metrics of the 14 standard
 * fonts (Arial / Times New Roman / Courier New are metric-compatible on screen) or from the
 * document's own font program when the text reuses it.
 */

/** Inner padding of a text box, in points. */
export const TEXT_PADDING = 2;

/**
 * Vertical metrics of the on-screen fonts (hhea ascent/descent as a fraction of the font
 * size). CSS centres this content area inside each line box; the export does the same.
 */
export const FONT_VMETRICS: Record<FontFamily, { ascent: number; descent: number }> = {
  helvetica: { ascent: 0.905, descent: 0.212 },
  times: { ascent: 0.891, descent: 0.216 },
  courier: { ascent: 0.833, descent: 0.3 },
};

/** Extra word spacing beyond this (× font size) looks broken: the line keeps its natural width. */
const MAX_WORD_SPACING = 1.5;

type Style = Pick<TextObject, "font" | "bold" | "italic"> & Partial<Pick<TextObject, "sourceFont" | "useSourceFont">>;

const standardSources = new Map<string, GlyphSource>();

function standardSource(style: Pick<TextObject, "font" | "bold" | "italic">): GlyphSource {
  const name = standardFontName(style.font, style.bold, style.italic);
  let source = standardSources.get(name);
  if (!source) {
    // StandardFonts values are the same strings as the embedder's FontNames.
    const embedder = StandardFontEmbedder.for(name as unknown as Parameters<typeof StandardFontEmbedder.for>[0]);
    const cache = new Map<string, number>();
    source = {
      has: () => true,
      advance(ch) {
        let w = cache.get(ch);
        if (w === undefined) {
          w = embedder.widthOfTextAtSize(ch, 1000);
          cache.set(ch, w);
        }
        return w;
      },
      ...FONT_VMETRICS[style.font],
    };
    standardSources.set(name, source);
  }
  return source;
}

/**
 * Fonts a text is drawn with, in order: each character uses the first one that has it (the
 * browser does the same with the CSS font-family list). The last one takes everything.
 */
export function fontChain(style: Style): GlyphSource[] {
  const program = style.useSourceFont ? fontProgram(style.sourceFont) : undefined;
  const standard = standardSource(style);
  return program ? [program, standard] : [standard];
}

/** A piece of a line drawn with one font. `x` is measured from the line start. */
export interface TextSpan {
  text: string;
  /** Index in `fontChain()`. */
  font: number;
  x: number;
  /** Advance of `text` alone (word spacing excluded). */
  width: number;
}

/** Characters CSS `word-spacing` applies to (space and no-break space). */
export const isSpace = (ch: string) => ch === " " || ch === "\u00a0";

/**
 * Split a line into spans by font. With word spacing, spans also end after each space so the
 * export can place every word itself (PDF word spacing does not apply to two-byte fonts).
 */
export function splitSpans(text: string, chain: GlyphSource[], size: number, wordSpacing = 0): { spans: TextSpan[]; width: number } {
  const spans: TextSpan[] = [];
  let x = 0;
  let cur: TextSpan | null = null;
  let breakNext = false;
  for (const ch of text.normalize("NFC")) {
    const font = chain.findIndex((f, i) => i === chain.length - 1 || f.has(ch));
    const w = (chain[font].advance(ch) * size) / 1000;
    if (!cur || cur.font !== font || breakNext) {
      cur = { text: "", font, x, width: 0 };
      spans.push(cur);
    }
    cur.text += ch;
    cur.width += w;
    x += w;
    breakNext = false;
    if (isSpace(ch) && wordSpacing) {
      x += wordSpacing;
      breakNext = true;
    }
  }
  return { spans, width: x };
}

/** Advance width WITHOUT kerning: pdf-lib's drawText does not kern, and the editor disables it. */
export function textWidth(text: string, style: Style, size: number): number {
  return splitSpans(text, fontChain(style), size).width;
}

/** Characters of `o.text` the document font lacks (they are drawn with the fallback). */
export function missingGlyphs(o: Pick<TextObject, "text"> & Style): string[] {
  const chain = fontChain(o);
  if (chain.length < 2) return [];
  return [...new Set(o.text.normalize("NFC"))].filter((ch) => ch.trim() && !chain[0].has(ch));
}

export interface TextLayout {
  /** Box size in points, padding included. */
  width: number;
  height: number;
  lines: { text: string; width: number; spans: TextSpan[] }[];
  /** Height of one line box. */
  lineHeight: number;
  /** Distance from the top of a line box to its baseline. */
  baseline: number;
  /** Extra advance after each space (points), see `TextObject.justifyWidth`. */
  wordSpacing: number;
}

type LayoutInput = Pick<TextObject, "text" | "font" | "bold" | "italic" | "size" | "lineHeight"> &
  Partial<Pick<TextObject, "sourceFont" | "useSourceFont" | "justifyWidth">>;

/** Word spacing that stretches a single line to `justifyWidth` (0 when it does not apply). */
function justifySpacing(o: LayoutInput, chain: GlyphSource[]): number {
  if (!o.justifyWidth || o.text.includes("\n")) return 0;
  const spaces = [...o.text].filter(isSpace).length;
  if (!spaces) return 0;
  const extra = (o.justifyWidth - splitSpans(o.text, chain, o.size).width) / spaces;
  return extra > 0 && extra <= o.size * MAX_WORD_SPACING ? extra : 0;
}

export function layoutText(o: LayoutInput): TextLayout {
  const chain = fontChain(o);
  const wordSpacing = justifySpacing(o, chain);
  const lines = o.text.split(/\r?\n/).map((text) => ({ text, ...splitSpans(text, chain, o.size, wordSpacing) }));
  const lineHeight = o.size * o.lineHeight;
  // CSS sizes line boxes with the first (primary) font of the font-family list.
  const { ascent, descent } = chain[0];
  const baseline = ((o.lineHeight - (ascent + descent)) / 2 + ascent) * o.size;
  const content = Math.max(o.size * 0.6, ...lines.map((l) => l.width));
  return {
    width: content + 2 * TEXT_PADDING,
    height: lines.length * lineHeight + 2 * TEXT_PADDING,
    lines,
    lineHeight,
    baseline,
    wordSpacing,
  };
}

/** Horizontal start of a line inside a box of width `boxWidth` centred on 0. */
export function lineStartX(align: TextObject["align"], boxWidth: number, lineWidth: number): number {
  if (align === "center") return -lineWidth / 2;
  if (align === "right") return boxWidth / 2 - TEXT_PADDING - lineWidth;
  return -boxWidth / 2 + TEXT_PADDING;
}
