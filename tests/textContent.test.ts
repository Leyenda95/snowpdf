import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { textChars } from "@/pdf/mupdf/ops";
import { REDACT_PATTERNS, groupLines, runHScale, searchRuns, searchRunsPattern, splitRunsAtBoxes, type TextRun } from "@/render/textContent";

function run(str: string, x: number, y: number, size = 12, dir: [number, number] = [1, 0]): TextRun {
  return { str, x, y, dx: dir[0], dy: dir[1], width: str.length * size * 0.5, size, fontName: "f1", family: "sans-serif", hScale: 1 };
}

const pattern = (id: string) => REDACT_PATTERNS.find((p) => p.id === id)!.regex;

describe("text lines and search", () => {
  it("groups runs on the same baseline into one line, top to bottom", () => {
    const lines = groupLines([run("mundo", 100, 700), run("Hola", 60, 700), run("Segunda línea", 60, 680)]);
    expect(lines.map((l) => l.text)).toEqual(["Hola mundo", "Segunda línea"]);
    expect(lines[0].frame.rot).toBe(0);
  });

  it("keeps a row in one line and records which characters sit in which link box", () => {
    const runs = [run("Uno", 60, 700), run("Dos", 80, 700), run("Tres", 100, 700)];
    // Centres of the runs are at x ~ 69, 89, 110 (y ~ 702).
    const lines = groupLines(runs, [
      [60, 690, 78, 715],
      [80, 690, 98, 715],
      [100, 690, 125, 715],
    ]);
    expect(lines.map((l) => l.text)).toEqual(["UnoDosTres"]);
    expect(lines[0].linkRanges).toEqual([
      { box: 0, start: 0, end: 3 },
      { box: 1, start: 3, end: 6 },
      { box: 2, start: 6, end: 10 },
    ]);
    // Runs inside the same box merge into one range; boxes away from the text give none.
    expect(groupLines(runs, [[0, 690, 200, 715]])[0].linkRanges).toEqual([{ box: 0, start: 0, end: 10 }]);
    expect(groupLines(runs, [[200, 0, 300, 10]])[0].linkRanges).toEqual([]);
    expect(groupLines(runs)[0].linkRanges).toEqual([]);
  });

  it("derives the horizontal scale from the text transform; a line takes the median", () => {
    expect(runHScale(12, 0, 0, 12)).toBeCloseTo(1, 6);
    expect(runHScale(6, 0, 0, 12)).toBeCloseTo(0.5, 6);
    expect(runHScale(0, 6, -12, 0)).toBeCloseTo(0.5, 6);
    expect(runHScale(0, 0, 0, 0)).toBe(1);
    const lines = groupLines([{ ...run("Hola", 60, 700), hScale: 0.5 }, { ...run("mundo", 100, 700), hScale: 0.5 }, run("x", 140, 700)]);
    expect(lines[0].hScale).toBe(0.5);
  });

  it("keeps rotated text in its own line with its angle", () => {
    const lines = groupLines([run("Vertical", 300, 100, 12, [0, 1])]);
    expect(lines[0].frame.rot).toBe(90);
  });

  it("searches ignoring case and accents, across runs", () => {
    const runs = [run("Canción del", 60, 700), run("VERANO", 132, 700)];
    expect(searchRuns(runs, "cancion")).toHaveLength(1);
    expect(searchRuns(runs, "del verano")[0].frames).toHaveLength(2);
    expect(searchRuns(runs, "invierno")).toHaveLength(0);
  });

  it("finds Spanish sensitive data patterns", () => {
    const runs = [
      run("DNI 12345678Z, NIE X1234567L", 60, 700),
      run("IBAN ES91 2100 0418 4502 0005 1332", 60, 680),
      run("Escribe a ana.lopez@correo.es o llama al 612 345 678", 60, 660),
    ];
    expect(searchRunsPattern(runs, pattern("dni"))).toHaveLength(2);
    expect(searchRunsPattern(runs, pattern("iban"))).toHaveLength(1);
    expect(searchRunsPattern(runs, pattern("email"))[0].snippet).toContain("ana.lopez@correo.es");
    expect(searchRunsPattern(runs, pattern("phone"))).toHaveLength(1);
  });
});

describe("splitting runs at link boxes", () => {
  const PIECES = ["alvaroliebana.com", ", ", "LinkedIn", ", ", "github.com/leyenda95"];
  const SIZE = 10;

  async function cvRow() {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.drawText(PIECES.join(""), { x: 50, y: 700, size: SIZE, font });
    const adv = (s: string) => [...s].reduce((sum, ch) => sum + font.widthOfTextAtSize(ch, SIZE), 0);
    let x = 50;
    const boxes: [number, number, number, number][] = [];
    PIECES.forEach((p, i) => {
      if (i % 2 === 0) boxes.push([x, 698, x + adv(p), 709]);
      x += adv(p);
    });
    const row: TextRun = { str: PIECES.join(""), x: 50, y: 700, dx: 1, dy: 0, width: adv(PIECES.join("")), size: SIZE, hScale: 1, fontName: "f1", family: "sans-serif" };
    return { bytes: await doc.save(), boxes, row };
  }

  it("cuts one run into the link and non-link segments, with exact glyph positions", async () => {
    const { bytes, boxes, row } = await cvRow();
    const parts = splitRunsAtBoxes([row], boxes, textChars(bytes, 0));
    expect(parts.map((p) => p.str)).toEqual(PIECES);
    expect(parts[2].x).toBeCloseTo(boxes[1][0], 0);
    expect(parts.reduce((w, p) => w + p.width, 0)).toBeLessThanOrEqual(row.width + 0.01);
    const lines = groupLines(parts, boxes);
    expect(lines.map((l) => l.text)).toEqual(["alvaroliebana.com, LinkedIn, github.com/leyenda95"]);
    expect(lines[0].linkRanges).toEqual([
      { box: 0, start: 0, end: 17 },
      { box: 1, start: 19, end: 27 },
      { box: 2, start: 29, end: 49 },
    ]);
  });

  it("falls back to estimated metrics without usable glyph data", async () => {
    const { boxes, row } = await cvRow();
    expect(splitRunsAtBoxes([row], boxes).map((p) => p.str)).toEqual(PIECES);
    // Characters that do not match the run are ignored too.
    const junk = [{ c: "Z", x: 50, y: 700, ex: 56, ey: 700 }];
    expect(splitRunsAtBoxes([row], boxes, junk).map((p) => p.str)).toEqual(PIECES);
  });

  it("leaves runs inside a box or away from every box untouched", async () => {
    const { boxes, row } = await cvRow();
    const inside = { ...row, str: "alvaroliebana.com", width: boxes[0][2] - boxes[0][0] };
    const away = { ...row, y: 500 };
    const out = splitRunsAtBoxes([inside, away], boxes);
    expect(out[0]).toBe(inside);
    expect(out[1]).toBe(away);
  });
});
