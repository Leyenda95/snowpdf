import { StandardFonts, type PDFDocument, type PDFFont } from "@cantoo/pdf-lib";
import type { FontFamily } from "@/model/types";

const NAMES: Record<FontFamily, [regular: StandardFonts, bold: StandardFonts, italic: StandardFonts, boldItalic: StandardFonts]> = {
  helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

export function standardFontName(family: FontFamily, bold: boolean, italic: boolean): StandardFonts {
  return NAMES[family][(bold ? 1 : 0) + (italic ? 2 : 0)];
}

/** CSS font stack whose metrics match each standard PDF font (used by the on-screen editor). */
export const CSS_FONT_STACKS: Record<FontFamily, string> = {
  helvetica: "Helvetica, Arial, 'Liberation Sans', sans-serif",
  times: "'Times New Roman', Times, 'Liberation Serif', serif",
  courier: "'Courier New', Courier, 'Liberation Mono', monospace",
};

/** CSS family name under which a document font (FontAsset) is registered with document.fonts. */
export function cssFontName(fontId: string): string {
  return `snow-font-${fontId}`;
}

/** font-family of a text object: its document font first (if used), then the standard stack. */
export function cssFontFamily(o: { font: FontFamily; sourceFont?: string | null; useSourceFont?: boolean }): string {
  const stack = CSS_FONT_STACKS[o.font];
  return o.useSourceFont && o.sourceFont ? `"${cssFontName(o.sourceFont)}", ${stack}` : stack;
}

const cache = new WeakMap<PDFDocument, Map<string, Promise<PDFFont>>>();

/** Embed (once per document) one of the 14 standard fonts. */
export function embedStandardFont(doc: PDFDocument, family: FontFamily, bold = false, italic = false): Promise<PDFFont> {
  let perDoc = cache.get(doc);
  if (!perDoc) {
    perDoc = new Map();
    cache.set(doc, perDoc);
  }
  const name = standardFontName(family, bold, italic);
  let font = perDoc.get(name);
  if (!font) {
    font = doc.embedFont(name);
    perDoc.set(name, font);
  }
  return font;
}

const charsetCache = new WeakMap<PDFFont, Set<number>>();

/**
 * Standard fonts use WinAnsi encoding (enough for Spanish and most Western languages).
 * Replace anything the font cannot encode with "?" instead of letting pdf-lib throw.
 */
export function encodableText(font: PDFFont, text: string): string {
  let set = charsetCache.get(font);
  if (!set) {
    set = new Set(font.getCharacterSet());
    charsetCache.set(font, set);
  }
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\n" || ch === "\r" || set.has(cp)) out += ch;
    else if (ch === "\t") out += "    ";
    else if (cp === 0x00a0) out += " ";
    else out += "?";
  }
  return out;
}
