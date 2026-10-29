import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, degrees } from "@cantoo/pdf-lib";
import { textChars } from "@/pdf/mupdf/ops";

const TEXT = "alvaroliebana.com, LinkedIn, github.com/leyenda95";

async function pdf(rotation = 0): Promise<{ bytes: Uint8Array; width: (s: string) => number }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.setRotation(degrees(rotation));
  page.drawText(TEXT, { x: 50, y: 700, size: 10, font });
  return {
    bytes: await doc.save(),
    // pdf-lib applies kerning in widthOfTextAtSize but draws without it: sum plain advances.
    width: (s) => [...s].reduce((sum, ch) => sum + font.widthOfTextAtSize(ch, 10), 0),
  };
}

describe("mupdf textChars", () => {
  it.each([0, 90])("reports glyph origins in user space (page rotation %i)", async (rot) => {
    const { bytes, width } = await pdf(rot);
    const chars = textChars(bytes, 0);
    expect(chars.map((c) => c.c).join("").replace(/\s/g, "")).toBe(TEXT.replace(/\s/g, ""));
    const at = TEXT.indexOf("L");
    const l = chars.filter((c) => c.c.trim())[TEXT.slice(0, at).replace(/\s/g, "").length];
    expect(l.c).toBe("L");
    expect(Math.abs(l.x - (50 + width(TEXT.slice(0, at))))).toBeLessThan(0.2);
    expect(l.y).toBeCloseTo(700, 1);
    expect(l.ex - l.x).toBeCloseTo(width("L"), 1);
    expect(l.ey).toBeCloseTo(700, 1);
  });
});
