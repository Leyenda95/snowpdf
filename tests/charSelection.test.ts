import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, degrees } from "@cantoo/pdf-lib";
import { textLayout } from "@/pdf/mupdf/ops";
import { allRange, caretAt, hitChar, indexLayout, rangeBoxes, rangeText, wordRange, type TextIndex } from "@/render/charSelection";

const LINES = ["Hello brave new world.", "Second line here,", "third one-", "liner."];

async function pdf(rotation = 0) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.setRotation(degrees(rotation));
  LINES.forEach((text, i) => page.drawText(text, { x: 50, y: 700 - i * 14, size: 12, font }));
  // A separate paragraph far below.
  page.drawText("Far away paragraph", { x: 50, y: 300, size: 12, font });
  const x = (line: number, upTo: string) => 50 + [...LINES[line].slice(0, LINES[line].indexOf(upTo))].reduce((s, ch) => s + font.widthOfTextAtSize(ch, 12), 0);
  return { bytes: await doc.save(), x };
}

function idx(t: TextIndex, start: number, end: number): string {
  return t.layout.chars.slice(start, end).join("");
}

describe("touch text selection over MuPDF glyph boxes", () => {
  it.each([0, 90])("reports glyph boxes in user space (page rotation %i)", async (rot) => {
    const { bytes, x } = await pdf(rot);
    const t = indexLayout(textLayout(bytes, 0));
    // The "b" of "brave": its box starts at its pen position on line 0 (baseline y = 700).
    const i = t.layout.chars.join("").indexOf("brave");
    const b = t.layout.boxes.slice(4 * i, 4 * i + 4);
    expect(Math.abs(b[0] - x(0, "brave"))).toBeLessThan(0.3);
    expect(b[1]).toBeLessThan(700);
    expect(b[3]).toBeGreaterThan(700 + 6);
  });

  it("long press: picks the glyph under the finger and grows it to the word", async () => {
    const { bytes, x } = await pdf();
    const t = indexLayout(textLayout(bytes, 0));
    const hit = hitChar(t, x(0, "brave") + 8, 703, 2); // "b" is 6.7 pt wide: this is the "r"
    expect(t.layout.chars[hit]).toBe("r");
    const w = wordRange(t, hit);
    expect(idx(t, w.start, w.end)).toBe("brave");
    // Within tolerance just below the line, nothing far away.
    expect(hitChar(t, x(0, "brave") + 3, 696, 4)).toBeGreaterThanOrEqual(0);
    expect(hitChar(t, 400, 500, 4)).toBe(-1);
  });

  it("handles: the caret snaps to the nearest glyph boundary of the nearest line", async () => {
    const { bytes, x } = await pdf();
    const t = indexLayout(textLayout(bytes, 0));
    const text = t.layout.chars.join("");
    // Just left of the middle of "S" on line 1 -> before "Second".
    expect(caretAt(t, x(1, "Second") + 1, 690)).toBe(text.indexOf("Second"));
    // Past the end of line 2 -> end of that line.
    const c = caretAt(t, 500, 674);
    expect(text.slice(c - 4, c)).toBe("one-");
  });

  it("copies joined lines (hyphenation, paragraphs) and boxes one rect per line", async () => {
    const { bytes } = await pdf();
    const t = indexLayout(textLayout(bytes, 0));
    const text = t.layout.chars.join("");
    const r = { start: text.indexOf("brave"), end: text.indexOf("liner.") + 6 };
    expect(rangeText(t, r)).toBe("brave new world. Second line here, third oneliner.");
    expect(rangeBoxes(t, r)).toHaveLength(4);
    expect(rangeText(t, allRange(t))).toContain("liner.\nFar away paragraph");
  });
});
