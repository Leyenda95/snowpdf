import type { Font } from "@pdf-lib/fontkit";

/**
 * Font programs reused from opened PDFs (see docs/PLAN_FUENTES_ORIGINALES.md). The bytes are
 * pdf.js' OpenType conversion of an embedded font, whose cmap maps Unicode to glyphs, so the
 * same program measures text here, renders it on screen (FontFace) and is embedded on export.
 */

/** What text layout needs from a font: coverage, advances and vertical metrics. */
export interface GlyphSource {
  has(ch: string): boolean;
  /** Advance width in 1/1000 em, without kerning. */
  advance(ch: string): number;
  /** Fractions of the em, both positive. */
  ascent: number;
  descent: number;
}

export interface FontProgram extends GlyphSource {
  /** True when the glyph for `ch` draws something (OCR text layers use blank fonts). */
  hasOutline(ch: string): boolean;
  /** OS/2 weight class (400 regular, 700 bold), or null when the font does not say. */
  weight: number | null;
}

type Fontkit = { create(buffer: Uint8Array): Font };

let fontkit: Promise<Fontkit> | null = null;

/** fontkit is heavy: load it only when a document font is actually used. */
export function loadFontkit(): Promise<Fontkit> {
  fontkit ??= import("@pdf-lib/fontkit").then((m) => ((m as unknown as { default?: Fontkit }).default ?? (m as unknown as Fontkit)));
  return fontkit;
}

/** pdf.js maps raw character codes to these private-use ranges: they are not real text. */
function isPrivateUse(cp: number): boolean {
  return (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000;
}

function weightClass(font: Font): number | null {
  try {
    const w = (font as unknown as { "OS/2"?: { usWeightClass?: number } })["OS/2"]?.usWeightClass;
    return w && w >= 1 && w <= 1000 ? w : null;
  } catch {
    return null;
  }
}

export async function parseFontProgram(bytes: Uint8Array): Promise<FontProgram> {
  const font = (await loadFontkit()).create(bytes);
  const em = font.unitsPerEm || 1000;
  const advances = new Map<string, number>();
  const has = (ch: string) => {
    const cp = ch.codePointAt(0);
    return cp !== undefined && !isPrivateUse(cp) && font.hasGlyphForCodePoint(cp);
  };
  return {
    has,
    advance(ch) {
      let w = advances.get(ch);
      if (w === undefined) {
        w = has(ch) ? (font.glyphForCodePoint(ch.codePointAt(0)!).advanceWidth * 1000) / em : 0;
        advances.set(ch, w);
      }
      return w;
    },
    ascent: font.ascent / em,
    descent: Math.abs(font.descent) / em,
    weight: weightClass(font),
    hasOutline(ch) {
      if (!has(ch)) return false;
      try {
        const box = font.glyphForCodePoint(ch.codePointAt(0)!).path.cbox;
        return box.maxX > box.minX && box.maxY > box.minY;
      } catch {
        return false;
      }
    },
  };
}

const programs = new Map<string, FontProgram>();

export function registerFontProgram(id: string, program: FontProgram): void {
  programs.set(id, program);
}

export async function loadFontProgram(id: string, bytes: Uint8Array): Promise<FontProgram> {
  let program = programs.get(id);
  if (!program) {
    program = await parseFontProgram(bytes);
    programs.set(id, program);
  }
  return program;
}

/** Synchronous lookup for layout; undefined when the font is not loaded (= use the fallback). */
export function fontProgram(id: string | null | undefined): FontProgram | undefined {
  return id ? programs.get(id) : undefined;
}

export function unloadFontProgram(id: string): void {
  programs.delete(id);
}
