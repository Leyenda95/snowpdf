import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts, type PDFFont } from "@cantoo/pdf-lib";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadFontProgram, unloadFontProgram } from "@/pdf/fontProgram";
import { fontChain, layoutText, missingGlyphs, splitSpans, textWidth } from "@/pdf/textLayout";
import type { TextObject } from "@/model/types";

const LIBERATION = new URL("../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf", import.meta.url);
const HELVETICA = { font: "helvetica", bold: false, italic: false } as const;

function layoutInput(text: string, extra: Partial<TextObject> = {}) {
  return { text, ...HELVETICA, size: 10, lineHeight: 1.2, ...extra };
}

describe("text layout without a document font (regression)", () => {
  let helvetica: PDFFont;
  let bold: PDFFont;
  beforeAll(async () => {
    const doc = await PDFDocument.create();
    helvetica = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  });

  // The layout does not kern (pdf-lib's drawText does not either, and the editor disables it):
  // the AFM width of a text is the sum of its letters.
  const afm = (font: PDFFont, text: string, size: number) => [...text].reduce((n, ch) => n + font.widthOfTextAtSize(ch, size), 0);

  it("textWidth equals the Helvetica AFM width", () => {
    expect(textWidth("Hola", HELVETICA, 10)).toBeCloseTo(helvetica.widthOfTextAtSize("Hola", 10), 6);
    for (const [text, size] of [["Hola", 10], ["Hola España ¿qué tal?", 17.5], ["WAVE", 40]] as const) {
      expect(textWidth(text, HELVETICA, size)).toBeCloseTo(afm(helvetica, text, size), 6);
    }
    expect(textWidth("Hola", { ...HELVETICA, bold: true }, 10)).toBeCloseTo(bold.widthOfTextAtSize("Hola", 10), 6);
  });

  it("layoutText sizes the box from the AFM widths and the CSS line box", () => {
    const lay = layoutText(layoutInput("Hola\nmundo!"));
    expect(lay.lines.map((l) => l.text)).toEqual(["Hola", "mundo!"]);
    expect(lay.lines[0].width).toBeCloseTo(helvetica.widthOfTextAtSize("Hola", 10), 6);
    expect(lay.lines[1].width).toBeCloseTo(afm(helvetica, "mundo!", 10), 6);
    expect(lay.width).toBeCloseTo(afm(helvetica, "mundo!", 10) + 4, 6);
    expect(lay.height).toBeCloseTo(2 * 12 + 4, 6);
    expect(lay.lineHeight).toBeCloseTo(12, 6);
    // (lineHeight - (ascent + descent)) / 2 + ascent, with the hhea metrics of Helvetica.
    expect(lay.baseline).toBeCloseTo(((1.2 - (0.905 + 0.212)) / 2 + 0.905) * 10, 6);
    expect(lay.wordSpacing).toBe(0);
    expect(lay.lines[0].spans).toHaveLength(1);
  });

  it("ignores a source font that is not loaded", () => {
    const plain = layoutText(layoutInput("Hola mundo"));
    const withId = layoutText(layoutInput("Hola mundo", { sourceFont: "nope", useSourceFont: true }));
    expect(withId).toEqual(plain);
    expect(fontChain({ ...HELVETICA, sourceFont: "nope", useSourceFont: true })).toHaveLength(1);
    expect(missingGlyphs({ ...layoutInput("ñandú"), sourceFont: "nope", useSourceFont: true })).toEqual([]);
  });
});

describe("text layout with a document font", () => {
  afterEach(() => unloadFontProgram("liberation"));
  const load = () => loadFontProgram("liberation", new Uint8Array(readFileSync(LIBERATION)));
  const style = { ...HELVETICA, sourceFont: "liberation", useSourceFont: true };

  it("puts the document font first in the chain, only when used", async () => {
    await load();
    expect(fontChain(style)).toHaveLength(2);
    expect(fontChain({ ...style, useSourceFont: false })).toHaveLength(1);
    expect(fontChain({ ...style, sourceFont: null })).toHaveLength(1);
  });

  it("measures with the document font and takes its vertical metrics", async () => {
    const program = await load();
    expect(textWidth("H", style, 10)).toBeCloseTo((program.advance("H") * 10) / 1000, 6);
    const lay = layoutText({ ...layoutInput("Hola"), ...style });
    const { ascent, descent } = program;
    expect(lay.baseline).toBeCloseTo(((1.2 - (ascent + descent)) / 2 + ascent) * 10, 6);
  });

  it("splits a line into spans by font when a letter is missing", async () => {
    const program = await load();
    const chain = fontChain(style);
    const { spans, width } = splitSpans("ab漢cd", chain, 10);
    expect(spans.map((s) => [s.text, s.font])).toEqual([
      ["ab", 0],
      ["漢", 1],
      ["cd", 0],
    ]);
    // Spans are laid out one after the other.
    expect(spans[0].x).toBe(0);
    expect(spans[1].x).toBeCloseTo(spans[0].width, 6);
    expect(spans[2].x).toBeCloseTo(spans[0].width + spans[1].width, 6);
    expect(width).toBeCloseTo(spans.reduce((n, s) => n + s.width, 0), 6);
    // The missing letter is measured with the fallback font, not with the document font (0).
    expect(program.advance("漢")).toBe(0);
    expect(spans[1].width).toBeGreaterThan(0);
    expect(missingGlyphs({ ...layoutInput("ab 漢 cd 漢"), ...style })).toEqual(["漢"]);
    expect(missingGlyphs({ ...layoutInput("Hola España"), ...style })).toEqual([]);
  });

  it("keeps one span for a line the document font covers entirely", async () => {
    await load();
    const lay = layoutText({ ...layoutInput("Hola España"), ...style });
    expect(lay.lines[0].spans).toHaveLength(1);
    expect(lay.lines[0].spans[0].font).toBe(0);
  });
});

describe("justifyWidth", () => {
  const natural = (text: string) => layoutText(layoutInput(text)).lines[0].width;

  it("stretches the spaces of a single line to the requested width", () => {
    const base = natural("a b c");
    const lay = layoutText(layoutInput("a b c", { justifyWidth: base + 20 }));
    expect(lay.wordSpacing).toBeCloseTo(10, 6);
    expect(lay.lines[0].width).toBeCloseTo(base + 20, 6);
    expect(lay.width).toBeCloseTo(base + 20 + 4, 6);
    // Spans end after every space so the export can place each word itself.
    expect(lay.lines[0].spans.map((s) => s.text)).toEqual(["a ", "b ", "c"]);
    expect(lay.lines[0].spans[1].x).toBeCloseTo(lay.lines[0].spans[0].width + 10, 6);
  });

  it("counts no-break spaces too", () => {
    const base = natural("a b");
    expect(layoutText(layoutInput("a b", { justifyWidth: base + 6 })).wordSpacing).toBeCloseTo(6, 6);
  });

  it("ignores multi-line text", () => {
    const lay = layoutText(layoutInput("a b\nc d", { justifyWidth: 200 }));
    expect(lay.wordSpacing).toBe(0);
    expect(lay.lines.map((l) => l.width)).toEqual([natural("a b"), natural("c d")]);
  });

  it("does nothing without spaces, when already wider, or when unset", () => {
    expect(layoutText(layoutInput("abc", { justifyWidth: 200 })).wordSpacing).toBe(0);
    expect(layoutText(layoutInput("a b c", { justifyWidth: 1 })).wordSpacing).toBe(0);
    expect(layoutText(layoutInput("a b c", { justifyWidth: null })).wordSpacing).toBe(0);
  });

  it("refuses a stretch above 1.5 x size per space", () => {
    const base = natural("a b c");
    // size 10 -> at most 15 extra points per space; two spaces.
    expect(layoutText(layoutInput("a b c", { justifyWidth: base + 30 })).wordSpacing).toBeCloseTo(15, 6);
    const lay = layoutText(layoutInput("a b c", { justifyWidth: base + 31 }));
    expect(lay.wordSpacing).toBe(0);
    expect(lay.lines[0].width).toBeCloseTo(base, 6);
  });
});
