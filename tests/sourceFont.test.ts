import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { composeDocument, type ComposeInput } from "@/pdf/compose";
import { loadFontProgram, parseFontProgram, registerFontProgram, unloadFontProgram } from "@/pdf/fontProgram";
import { layoutText } from "@/pdf/textLayout";
import type { PageRef, TextObject } from "@/model/types";
import { pageText, textLines } from "./helpers";

/**
 * Edited text reusing the document's own font (docs/PLAN_FUENTES_ORIGINALES.md, step 12).
 * In the app the bytes come from pdf.js' conversion of the embedded font; a plain TrueType
 * (Liberation Sans, metric-compatible with Helvetica) goes through the same code paths.
 */

const LIBERATION = new URL("../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf", import.meta.url);
const FONT_ID = "doc-font";
const fontBytes = () => new Uint8Array(readFileSync(LIBERATION));
const documentFont = () => ({ bytes: fontBytes(), name: "LiberationSans" });

const BLANK: PageRef = { id: "blank", sourceId: null, sourceIndex: 0, baseRotation: 0, rotation: 0, view: [0, 0, 400, 300], crop: null };

function compose(objects: TextObject[], font?: ComposeInput["font"]): Promise<Uint8Array> {
  return composeDocument({
    sources: {},
    pages: [BLANK],
    objects,
    asset: () => {
      throw new Error("no assets");
    },
    redact: async (bytes) => bytes,
    font,
  });
}

/** A text object laid out like the editor does, so its frame matches what the export measures. */
function textObject(text: string, extra: Partial<TextObject> = {}): TextObject {
  const base = { text, font: "helvetica" as const, bold: false, italic: false, size: 20, lineHeight: 1.2, sourceFont: FONT_ID, useSourceFont: true, justifyWidth: null, ...extra };
  const lay = layoutText(base);
  return {
    id: `t-${text}`,
    pageId: BLANK.id,
    kind: "text",
    frame: { cx: 150, cy: 100, w: lay.width, h: lay.height, rot: 0 },
    opacity: 1,
    color: "#000000",
    align: "left",
    background: null,
    replaces: null,
    ...base,
  };
}

/** Name of the font MuPDF paints each character of the page with. */
function glyphFonts(bytes: Uint8Array): { ch: string; font: string }[] {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const page = doc.loadPage(0);
  const out: { ch: string; font: string }[] = [];
  const device = new mupdf.Device({
    fillText(text) {
      text.walk({
        showGlyph(font, _trm, _glyph, unicode) {
          out.push({ ch: String.fromCodePoint(unicode), font: font.getName() });
        },
      });
    },
  });
  try {
    page.run(device, mupdf.Matrix.identity);
    device.close();
  } finally {
    device.destroy();
  }
  return out;
}

const painted = (bytes: Uint8Array) => glyphFonts(bytes).filter((g) => g.ch.trim());

describe("exporting text with the document font", () => {
  afterEach(() => unloadFontProgram(FONT_ID));

  it("embeds the document font and the text reads back intact", async () => {
    await loadFontProgram(FONT_ID, fontBytes());
    const out = await compose([textObject("Hola España")], documentFont);

    expect(pageText(out).trim()).toBe("Hola España");
    const glyphs = painted(out);
    expect(glyphs.map((g) => g.ch).join("")).toBe("HolaEspaña");
    // Every letter is drawn with the document font, none with Helvetica (ñ included).
    for (const g of glyphs) expect(g.font).toMatch(/LiberationSans/);
    expect(textLines(out)[0].fontName).toMatch(/LiberationSans/);
  });

  it("places the line where the layout says, with the width of the document font", async () => {
    const program = await loadFontProgram(FONT_ID, fontBytes());
    const obj = textObject("Hola España");
    const out = await compose([obj], documentFont);
    const line = textLines(out)[0];
    const expected = layoutText(obj).lines[0].width;
    // The layout measures with the font program (not Helvetica) and the export agrees to within MuPDF's rounding.
    expect(expected).toBeCloseTo([..."Hola España"].reduce((n, ch) => n + (program.advance(ch) * 20) / 1000, 0), 6);
    expect(Math.abs(line.bbox.w - expected)).toBeLessThan(2);
    // Left aligned: the line starts at the padding inside the frame.
    expect(Math.abs(line.bbox.x - (obj.frame.cx - obj.frame.w / 2 + 2))).toBeLessThan(2);
  });

  it("draws the letters the document font lacks with the standard fallback", async () => {
    // A font program that lacks "ñ", as a subset font would; the bytes are the full font.
    const full = await parseFontProgram(fontBytes());
    registerFontProgram(FONT_ID, { ...full, has: (ch) => ch !== "ñ" && full.has(ch) });
    const out = await compose([textObject("Hola España")], documentFont);

    expect(pageText(out).trim()).toBe("Hola España");
    const glyphs = painted(out);
    expect(glyphs.map((g) => g.ch).join("")).toBe("HolaEspaña");
    for (const g of glyphs) {
      if (g.ch === "ñ") expect(g.font).toMatch(/Helvetica/);
      else expect(g.font).toMatch(/LiberationSans/);
    }
  });

  it("replaces what the standard font cannot encode with a question mark", async () => {
    await loadFontProgram(FONT_ID, fontBytes());
    const out = await compose([textObject("ab漢cd")], documentFont);
    expect(pageText(out).trim()).toBe("ab?cd");
    const fonts = Object.fromEntries(painted(out).map((g) => [g.ch, g.font]));
    expect(fonts["a"]).toMatch(/LiberationSans/);
    expect(fonts["?"]).toMatch(/Helvetica/);
  });

  it("falls back to Helvetica when the font is not available", async () => {
    await loadFontProgram(FONT_ID, fontBytes());
    for (const font of [() => null, undefined]) {
      const out = await compose([textObject("Hola España")], font);
      expect(pageText(out).trim()).toBe("Hola España");
      const glyphs = painted(out);
      expect(glyphs).toHaveLength("HolaEspaña".length);
      for (const g of glyphs) {
        expect(g.font).toMatch(/Helvetica/);
        expect(g.font).not.toMatch(/Liberation/);
      }
    }
  });

  it("draws with the fallback when the object does not use the source font", async () => {
    await loadFontProgram(FONT_ID, fontBytes());
    const out = await compose([textObject("Hola", { useSourceFont: false })], documentFont);
    for (const g of painted(out)) expect(g.font).toMatch(/Helvetica/);
  });
});

describe("exporting justified text", () => {
  afterEach(() => unloadFontProgram(FONT_ID));

  it("stretches the line to justifyWidth", async () => {
    await loadFontProgram(FONT_ID, fontBytes());
    const natural = layoutText(textObject("uno dos tres")).lines[0].width;
    const justifyWidth = natural + 30;
    const obj = textObject("uno dos tres", { justifyWidth });
    expect(obj.frame.w).toBeCloseTo(justifyWidth + 4, 6);

    const plain = textLines(await compose([textObject("uno dos tres")], documentFont))[0];
    const out = await compose([obj], documentFont);
    const lines = textLines(out);
    expect(lines).toHaveLength(1);
    expect(lines[0].text.trim()).toBe("uno dos tres");
    expect(Math.abs(lines[0].bbox.w - justifyWidth)).toBeLessThan(1.5);
    expect(lines[0].bbox.w - plain.bbox.w).toBeGreaterThan(25);
    // The line starts at the left edge of the (wider) frame content.
    expect(Math.abs(lines[0].bbox.x - (obj.frame.cx - obj.frame.w / 2 + 2))).toBeLessThan(1.5);
  });

  it("justifies the fallback font too", async () => {
    await loadFontProgram(FONT_ID, fontBytes());
    const natural = layoutText(textObject("uno dos tres", { useSourceFont: false })).lines[0].width;
    const justifyWidth = natural + 30;
    const obj = textObject("uno dos tres", { useSourceFont: false, justifyWidth });
    const lines = textLines(await compose([obj], () => null));
    expect(lines).toHaveLength(1);
    expect(Math.abs(lines[0].bbox.w - justifyWidth)).toBeLessThan(1.5);
  });
});
