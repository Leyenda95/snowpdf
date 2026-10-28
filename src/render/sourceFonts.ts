import type { PDFPageProxy } from "pdfjs-dist";
import { getFont, putFont } from "@/model/registry";
import type { FontAsset } from "@/model/types";
import { parseFontProgram } from "@/pdf/fontProgram";
import { fontChain, splitSpans } from "@/pdf/textLayout";
import type { TextLine } from "./textContent";
import { t } from "@/i18n";

/**
 * Reuse the fonts embedded in an opened PDF for "edit existing text"
 * (docs/PLAN_FUENTES_ORIGINALES.md). pdf.js already converts every embedded font to OpenType
 * with a Unicode cmap; with `fontExtraProperties` it keeps those bytes and the font name.
 */

/** The part of pdf.js' FontFaceObject this module reads. */
export interface PdfjsFont {
  data?: Uint8Array;
  name?: string;
  bold?: boolean;
  italic?: boolean;
  black?: boolean;
  isType3Font?: boolean;
  isInvalidPDFjsFont?: boolean;
  missingFile?: boolean;
  vertical?: boolean;
  cssFontInfo?: unknown;
  systemFontInfo?: unknown;
  isMonospace?: boolean;
  isSerifFont?: boolean;
}

/** pdf.js font behind a text run. Fonts arrive when the page renders: wait a little for them. */
export function pdfjsFont(page: PDFPageProxy, fontName: string, timeoutMs = 1500): Promise<PdfjsFont | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      page.commonObjs.get(fontName, (font: unknown) => {
        clearTimeout(timer);
        // Failed fonts resolve to their error message.
        resolve(font && typeof font === "object" ? (font as PdfjsFont) : null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** "ABCDEF+Calibri-Bold" -> "Calibri-Bold". */
function plainName(font: PdfjsFont): string {
  return (font.name ?? "").replace(/^[A-Z]{6}\+/, "");
}

/** "TimesNewRomanPS-BoldMT" -> "Times New Roman". */
export function familyName(name: string): string {
  const base = name.split(/[-,]/)[0].replace(/(PSMT|MT|PS)$/, "") || name;
  return base.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Bold/italic of a pdf.js font (flags are always sent; the name only with extra properties). */
export function fontStyleFlags(font: PdfjsFont | null): { name: string; bold: boolean; italic: boolean } {
  const name = font ? plainName(font) : "";
  const lower = name.toLowerCase();
  return {
    name,
    bold: !!(font?.bold || font?.black) || /bold|black|heavy|semibold|demi/.test(lower),
    italic: !!font?.italic || /italic|oblique/.test(lower),
  };
}

const cache = new Map<string, Promise<FontAsset | null>>();

/**
 * The document font a line is written with, as a reusable FontAsset, or null when it cannot be
 * reused faithfully (the text then uses the closest standard font, as before).
 */
export function resolveSourceFont(sourceId: string, line: TextLine, font: PdfjsFont): Promise<FontAsset | null> {
  const key = `${sourceId}:${line.fontName}`;
  const hit = cache.get(key);
  if (hit) {
    // A closed tab releases its fonts: look the font up again then.
    return hit.then((asset) => (asset && !getFont(asset.id) ? (cache.delete(key), resolveSourceFont(sourceId, line, font)) : asset));
  }
  const pending = load(line, font).catch((err) => {
    console.debug("Fuente del documento no reutilizable:", err instanceof Error ? err.message : err);
    return null;
  });
  cache.set(key, pending);
  return pending;
}

async function load(line: TextLine, font: PdfjsFont): Promise<FontAsset | null> {
  if (font.isType3Font) throw new Error("Type3");
  if (font.missingFile) throw new Error("no incrustada");
  if (font.vertical) throw new Error("vertical");
  if (font.isInvalidPDFjsFont || font.cssFontInfo || font.systemFontInfo || !font.data?.length) throw new Error("sin datos");

  // Own copy: independent of pdf.js' lifetime (cleanup, closing the document).
  const bytes = font.data.slice();
  const program = await parseFontProgram(bytes);
  const style = fontStyleFlags(font);

  // Coverage: the extracted text and the font must agree (PDFs without ToUnicode do not).
  const chars = [...line.text.normalize("NFC")].filter((ch) => ch.trim());
  if (!chars.length) throw new Error("línea vacía");
  const covered = chars.filter((ch) => program.has(ch));
  if (covered.length < chars.length * 0.9) throw new Error(`cobertura ${covered.length}/${chars.length}`);

  // Blank glyphs: OCR text layers use invisible fonts on purpose.
  const unique = [...new Set(covered)];
  if (unique.filter((ch) => program.hasOutline(ch)).length < unique.length * 0.9) throw new Error("glifos vacíos");

  // Scale: an unusual FontMatrix would make the text bigger or smaller than the original.
  // Justified lines are wider than their natural width, hence the asymmetric range.
  const fallback = fontChain({ font: "helvetica", bold: style.bold, italic: style.italic })[0];
  const natural = splitSpans(line.text, [program, fallback], line.size).width;
  const ratio = line.frame.w / (natural || 1);
  if (ratio < 0.75 || ratio > 1.6) throw new Error(`escala ${ratio.toFixed(2)}`);

  const vertical = program.ascent + program.descent;
  if (!(vertical > 0.5 && vertical < 2.5)) throw new Error("métricas verticales");

  const name = style.name || t("Fuente del documento");
  // pdf.js writes its own OS/2 table for some formats: trust the name flags over a plain 400.
  const weight = program.weight && program.weight !== 400 ? program.weight : style.bold ? 700 : 400;
  const family = style.name ? familyName(style.name) : name;
  return putFont({ name, family, bytes, weight, bold: weight >= 600, italic: style.italic, origin: "document" }, program);
}
