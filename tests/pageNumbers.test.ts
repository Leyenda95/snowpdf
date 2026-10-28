import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "@cantoo/pdf-lib";
import {
  addPageNumbers,
  type NumberPosition,
  type PageNumberOptions,
} from "@/pdf/tools/pageNumbers";
import {
  displaySize,
  fieldNames,
  findLine,
  fontMetrics,
  makePdf,
  openPdf,
  pageLabels,
  pageText,
  textLines,
  textRuns,
  type TextRun,
} from "./helpers";

const SIZE: [number, number] = [300, 400];
const ROTATIONS = [0, 90, 180, 270];

const options = (o: Partial<PageNumberOptions> = {}): PageNumberOptions => ({
  position: "bottom-center",
  template: "Página {n} de {total}",
  startAt: 1,
  font: "helvetica",
  size: 12,
  color: "#000000",
  margin: 24,
  ...o,
});

/** Painted text that is not the fixtures' "P1" label. */
const numbers = (bytes: Uint8Array, page: number): TextRun[] => textRuns(bytes, page).filter((r) => !/^P\d+$/.test(r.text));

describe("addPageNumbers: text", () => {
  it("prints 'Página n de total' on every page", async () => {
    const out = await addPageNumbers(await makePdf({ pages: 3, size: SIZE }), options());
    expect(pageText(out, 0)).toContain("Página 1 de 3");
    expect(pageText(out, 1)).toContain("Página 2 de 3");
    expect(pageText(out, 2)).toContain("Página 3 de 3");
    expect(pageLabels(out)).toEqual(["P1", "P2", "P3"]);
  });

  it("supports the common templates", async () => {
    const bytes = await makePdf({ pages: 12, size: SIZE });
    const out = await addPageNumbers(bytes, options({ template: "{n}" }));
    expect(numbers(out, 0).map((r) => r.text)).toEqual(["1"]);
    expect(numbers(out, 11).map((r) => r.text)).toEqual(["12"]);
    const mixed = await addPageNumbers(bytes, options({ template: "Confidencial · {n}/{total}" }));
    expect(numbers(mixed, 4).map((r) => r.text)).toEqual(["Confidencial · 5/12"]);
    const repeated = await addPageNumbers(bytes, options({ template: "{n}/{total} ({n})" }));
    expect(numbers(repeated, 2).map((r) => r.text)).toEqual(["3/12 (3)"]);
  });

  it("uses '{n}' when the template is empty and ignores the case of the placeholders", async () => {
    const bytes = await makePdf({ pages: 2, size: SIZE });
    expect(numbers(await addPageNumbers(bytes, options({ template: "" })), 1).map((r) => r.text)).toEqual(["2"]);
    expect(numbers(await addPageNumbers(bytes, options({ template: "   " })), 1).map((r) => r.text)).toEqual(["2"]);
    expect(numbers(await addPageNumbers(bytes, options({ template: "{N} / {TOTAL}" })), 0).map((r) => r.text)).toEqual(["1 / 2"]);
  });

  it("keeps the text on one line and replaces characters the font cannot encode", async () => {
    const bytes = await makePdf({ pages: 1, size: SIZE });
    const out = await addPageNumbers(bytes, options({ template: "Pág.\n{n} ✓ 日本" }));
    expect(numbers(out, 0).map((r) => r.text)).toEqual(["Pág. 1 ? ??"]);
  });

  it("starts counting at startAt", async () => {
    const bytes = await makePdf({ pages: 3, size: SIZE });
    const texts = async (startAt: number) => {
      const out = await addPageNumbers(bytes, options({ template: "{n}", startAt }));
      return [0, 1, 2].map((i) => numbers(out, i)[0].text);
    };
    expect(await texts(5)).toEqual(["5", "6", "7"]);
    expect(await texts(0)).toEqual(["0", "1", "2"]);
    expect(await texts(-1)).toEqual(["-1", "0", "1"]);
    expect(await texts(2.7)).toEqual(["2", "3", "4"]);
    expect(await texts(Number.NaN)).toEqual(["1", "2", "3"]);
  });

  it("numbers only the selected pages, counting from startAt on the first of them", async () => {
    const out = await addPageNumbers(await makePdf({ pages: 5, size: SIZE }), options({ pages: "2-3, 5", template: "{n} de {total}" }));
    expect([0, 1, 2, 3, 4].map((i) => numbers(out, i).map((r) => r.text))).toEqual([[], ["1 de 3"], ["2 de 3"], [], ["3 de 3"]]);
  });

  it("can count the whole document in {total} even when only some pages are numbered", async () => {
    const bytes = await makePdf({ pages: 5, size: SIZE });
    const base = { pages: "2-3", template: "{n}/{total}" };
    const numbered = await addPageNumbers(bytes, options({ ...base, totalMode: "numbered" }));
    const document = await addPageNumbers(bytes, options({ ...base, totalMode: "document" }));
    const byDefault = await addPageNumbers(bytes, options(base));
    expect(numbers(numbered, 1)[0].text).toBe("1/2");
    expect(numbers(byDefault, 1)[0].text).toBe("1/2");
    expect(numbers(document, 1)[0].text).toBe("1/5");
    expect(numbers(document, 2)[0].text).toBe("2/5");
  });

  it("applies font, size and colour", async () => {
    const bytes = await makePdf({ pages: 1, size: SIZE });
    const out = await addPageNumbers(bytes, options({ template: "Hola", font: "times", bold: true, size: 17, color: "#336699" }));
    const [run] = numbers(out, 0);
    expect(run.size).toBeCloseTo(17, 3);
    expect(run.color.map((c) => Math.round(c * 255))).toEqual([0x33, 0x66, 0x99]);
    expect(textLines(out, 0).find((l) => l.text === "Hola")?.fontName).toMatch(/Times-Bold$/);
    const courier = await addPageNumbers(bytes, options({ template: "Hola", font: "courier" }));
    expect(textLines(courier, 0).find((l) => l.text === "Hola")?.fontName).toMatch(/Courier$/);
  });
});

describe("addPageNumbers: placement in display space", () => {
  const positions: NumberPosition[] = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"];

  it("puts the number at the visual edge of upright and rotated pages, reading upright", async () => {
    const m = await fontMetrics("helvetica", false);
    for (const position of positions) {
      for (const margin of [24, 10]) {
        const out = await addPageNumbers(
          await makePdf({ pages: 4, size: SIZE, rotations: ROTATIONS }),
          options({ position, margin, template: "Página {n} de {total}" }),
        );
        for (let i = 0; i < 4; i++) {
          const { width: W, height: H } = displaySize(out, i);
          const [run] = numbers(out, i);
          const where = `${position} margin ${margin} page ${i + 1} (${ROTATIONS[i]} deg)`;
          expect(run.text, where).toBe(`Página ${i + 1} de 4`);
          expect(Math.abs(run.angle) % 360, where).toBeCloseTo(0, 3); // reads left to right on screen
          const width = m.width(run.text, 12);
          const [vertical, horizontal] = position.split("-");
          if (horizontal === "left") expect(run.x, where).toBeCloseTo(margin, 2);
          if (horizontal === "right") expect(run.x + width, where).toBeCloseTo(W - margin, 2);
          if (horizontal === "center") expect(run.x + width / 2, where).toBeCloseTo(W / 2, 2);
          // the text box (descender line to ascender line) sits inside the margin
          if (vertical === "bottom") expect(H - run.y - m.descent(12), where).toBeCloseTo(margin, 2);
          if (vertical === "top") expect(run.y - m.ascent(12), where).toBeCloseTo(margin, 2);
        }
      }
    }
  });

  it("agrees with where MuPDF finds the text: bottom centre of a sideways page", async () => {
    const out = await addPageNumbers(await makePdf({ pages: 2, size: [200, 300], rotations: [0, 90] }), options({ template: "NUMERO", margin: 20 }));
    // page 2 is displayed 300 wide x 200 tall: the number must be near the bottom and the horizontal centre
    const sideways = findLine(out, 1, "NUMERO");
    expect(sideways.cx).toBeCloseTo(150, -1);
    expect(sideways.cy).toBeGreaterThan(200 - 40);
    expect(sideways.cy).toBeLessThan(200 - 10);
    expect(sideways.bbox.w).toBeGreaterThan(sideways.bbox.h * 2); // horizontal text
    const upright = findLine(out, 0, "NUMERO");
    expect(upright.cx).toBeCloseTo(100, -1);
    expect(upright.cy).toBeGreaterThan(300 - 40);
  });

  it("measures the margin from the displayed edges of a cropped, rotated page", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([300, 400]);
    page.setCropBox(50, 60, 200, 250);
    page.setRotation(degrees(270));
    const out = await addPageNumbers(await doc.save(), options({ position: "bottom-right", template: "7", margin: 15 }));
    const { width, height } = displaySize(out, 0);
    expect([width, height]).toEqual([250, 200]);
    const m = await fontMetrics("helvetica", false);
    const [run] = numbers(out, 0);
    expect(run.x + m.width("7", 12)).toBeCloseTo(250 - 15, 2);
    expect(200 - run.y - m.descent(12)).toBeCloseTo(15, 2);
    expect(Math.abs(run.angle) % 360).toBeCloseTo(0, 3);
  });

  it("right-aligns numbers of different width", async () => {
    const out = await addPageNumbers(await makePdf({ pages: 12, size: SIZE }), options({ template: "{n}", position: "bottom-right" }));
    const m = await fontMetrics("helvetica", false);
    for (const i of [0, 8, 9, 11]) {
      const [run] = numbers(out, i);
      expect(run.x + m.width(run.text, 12)).toBeCloseTo(300 - 24, 2);
    }
  });

  it("treats a negative or invalid margin as zero", async () => {
    const m = await fontMetrics("helvetica", false);
    for (const margin of [-10, Number.NaN]) {
      const out = await addPageNumbers(await makePdf({ size: SIZE }), options({ position: "bottom-left", template: "x", margin }));
      const [run] = numbers(out, 0);
      expect(run.x).toBeCloseTo(0, 2);
      expect(400 - run.y - m.descent(12)).toBeCloseTo(0, 2);
    }
  });
});

describe("addPageNumbers: the rest of the document", () => {
  it("leaves content, forms and metadata alone", async () => {
    const bytes = await makePdf({ pages: 2, withForm: true, rotations: [90, 0], meta: { title: "Doc", creator: "Original" } });
    const out = await addPageNumbers(bytes, options());
    expect(pageLabels(out)).toEqual(["P1", "P2"]);
    expect(await fieldNames(out)).toEqual(["texto_1", "acepto", "texto_2"]);
    const doc = await openPdf(out);
    expect(doc.getTitle()).toBe("Doc");
    expect(doc.getCreator()).toBe("Original");
    expect(doc.getProducer()).toBe("SnowPDF");
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0]);
  });

  it("rejects pages that do not exist with a Spanish message", async () => {
    const bytes = await makePdf({ pages: 2 });
    await expect(addPageNumbers(bytes, options({ pages: "3" }))).rejects.toThrow("La página 3 no existe (el documento tiene 2).");
    await expect(addPageNumbers(bytes, options({ pages: "a" }))).rejects.toThrow('Rango no válido: "a"');
  });
});
