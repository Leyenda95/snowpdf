import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "@cantoo/pdf-lib";
import { cropPages, type CropMargins } from "@/pdf/tools/crop";
import { displaySize, fieldNames, findLine, makePdf, openPdf, pageLabels, textRuns } from "./helpers";

const SIZE: [number, number] = [300, 400];
const MARGINS: CropMargins = { top: 10, right: 20, bottom: 30, left: 40 };

async function cropBox(bytes: Uint8Array, page = 0): Promise<number[]> {
  const box = (await openPdf(bytes)).getPage(page).getCropBox();
  return [box.x, box.y, box.x + box.width, box.y + box.height];
}

describe("cropPages: CropBox values", () => {
  it("shrinks the CropBox of an upright page by the margins", async () => {
    const out = await cropPages(await makePdf({ size: SIZE }), { margins: MARGINS });
    expect(await cropBox(out)).toEqual([40, 30, 280, 390]);
  });

  it("measures the margins as the page is displayed on a page rotated 90 degrees", async () => {
    // displayed 400 x 300: the visual top is the left edge of the stored page
    const out = await cropPages(await makePdf({ size: SIZE, rotations: [90] }), { margins: MARGINS });
    expect(await cropBox(out)).toEqual([10, 40, 270, 380]);
  });

  it("measures the margins as displayed on a page rotated 180 degrees", async () => {
    const out = await cropPages(await makePdf({ size: SIZE, rotations: [180] }), { margins: MARGINS });
    expect(await cropBox(out)).toEqual([20, 10, 260, 370]);
  });

  it("measures the margins as displayed on a page rotated 270 degrees", async () => {
    const out = await cropPages(await makePdf({ size: SIZE, rotations: [270] }), { margins: MARGINS });
    expect(await cropBox(out)).toEqual([30, 20, 290, 360]);
  });

  it("works from the current CropBox, and on pages whose box does not start at the origin", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([300, 400]);
    page.setMediaBox(100, 200, 300, 400); // [100, 200, 400, 600]
    page.setCropBox(120, 220, 200, 300); // [120, 220, 320, 520]
    const out = await cropPages(await doc.save(), { margins: { top: 5, right: 6, bottom: 7, left: 8 } });
    expect(await cropBox(out)).toEqual([128, 227, 314, 515]);
    const mediaBox = (await openPdf(out)).getPage(0).getMediaBox();
    expect([mediaBox.x, mediaBox.y, mediaBox.width, mediaBox.height]).toEqual([100, 200, 300, 400]); // untouched
  });

  it("uses the MediaBox when there is no CropBox", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([300, 400]).setMediaBox(10, 20, 300, 400);
    const out = await cropPages(await doc.save(), { margins: { top: 1, right: 2, bottom: 3, left: 4 } });
    expect(await cropBox(out)).toEqual([14, 23, 308, 419]);
  });

  it("stacks when applied twice", async () => {
    let bytes = await makePdf({ size: SIZE });
    bytes = await cropPages(bytes, { margins: MARGINS });
    bytes = await cropPages(bytes, { margins: MARGINS });
    expect(await cropBox(bytes)).toEqual([80, 60, 260, 380]);
  });

  it("rounds to thousandths so the file does not fill up with floating point noise", async () => {
    const out = await cropPages(await makePdf({ size: [595.28, 841.89] }), { margins: { top: 0.1 + 0.2, right: 14.173, bottom: 1 / 3, left: 7.0000001 } });
    const box = await cropBox(out);
    expect(box).toEqual([7, 0.333, 581.107, 841.59]);
  });

  it("leaves the box as it is with zero margins", async () => {
    const out = await cropPages(await makePdf({ size: SIZE }), { margins: { top: 0, right: 0, bottom: 0, left: 0 } });
    expect(await cropBox(out)).toEqual([0, 0, 300, 400]);
  });
});

describe("cropPages: what a viewer shows", () => {
  it("cuts the displayed page by the margins on every rotation, and the content moves accordingly", async () => {
    const rotations = [0, 90, 180, 270];
    const bytes = await makePdf({ pages: 4, size: SIZE, rotations });
    const out = await cropPages(bytes, { margins: MARGINS });
    for (let i = 0; i < 4; i++) {
      const before = displaySize(bytes, i);
      const after = displaySize(out, i);
      expect(after.width, `page ${i + 1}`).toBeCloseTo(before.width - MARGINS.left - MARGINS.right, 3);
      expect(after.height, `page ${i + 1}`).toBeCloseTo(before.height - MARGINS.top - MARGINS.bottom, 3);
      // the "P1" label sat at display (20, 60); it moves by (-left, -top)
      const [label] = textRuns(out, i).filter((r) => /^P\d$/.test(r.text));
      expect(label.x, `page ${i + 1}`).toBeCloseTo(20 - MARGINS.left, 2);
      expect(label.y, `page ${i + 1}`).toBeCloseTo(60 - MARGINS.top, 2);
    }
  });

  it("keeps a margin-only crop of the right side visible and cuts the left", async () => {
    // a 'P1' label sits 20 pt from the left edge: cropping 30 pt from the left removes it from view
    const out = await cropPages(await makePdf({ size: SIZE }), { margins: { top: 0, right: 0, bottom: 0, left: 30 } });
    expect(findLine(out, 0, "P1").x).toBeLessThan(0);
  });

  it("only crops the selected pages", async () => {
    const out = await cropPages(await makePdf({ pages: 3, size: SIZE }), { margins: MARGINS, pages: "2" });
    expect(await cropBox(out, 0)).toEqual([0, 0, 300, 400]);
    expect(await cropBox(out, 1)).toEqual([40, 30, 280, 390]);
    expect(await cropBox(out, 2)).toEqual([0, 0, 300, 400]);
    expect(displaySize(out, 0)).toEqual({ width: 300, height: 400 });
    expect(displaySize(out, 1)).toEqual({ width: 240, height: 360 });
  });

  it("leaves content, rotation, forms and metadata alone", async () => {
    const bytes = await makePdf({ pages: 2, size: SIZE, rotations: [90, 0], withForm: true, meta: { title: "Doc", creator: "Original" } });
    const out = await cropPages(bytes, { margins: MARGINS });
    expect(pageLabels(out)).toEqual(["P1", "P2"]);
    expect(await fieldNames(out)).toEqual(["texto_1", "acepto", "texto_2"]);
    const doc = await openPdf(out);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0]);
    expect(doc.getCreator()).toBe("Original");
    expect(doc.getTitle()).toBe("Doc");
  });
});

describe("cropPages: errors", () => {
  it("accepts margins that leave exactly 36 pt and refuses anything smaller", async () => {
    const bytes = await makePdf({ size: SIZE });
    await expect(cropPages(bytes, { margins: { top: 0, right: 0, bottom: 0, left: 264 } })).resolves.toBeInstanceOf(Uint8Array);
    await expect(cropPages(bytes, { margins: { top: 364, right: 0, bottom: 0, left: 0 } })).resolves.toBeInstanceOf(Uint8Array);
    await expect(cropPages(bytes, { margins: { top: 0, right: 0, bottom: 0, left: 264.5 } })).rejects.toThrow(
      "Los márgenes son demasiado grandes: la página 1 se quedaría con menos de 36 pt de ancho o de alto.",
    );
    await expect(cropPages(bytes, { margins: { top: 200, right: 0, bottom: 165, left: 0 } })).rejects.toThrow(RangeError);
    await expect(cropPages(bytes, { margins: { top: 400, right: 400, bottom: 400, left: 400 } })).rejects.toThrow(RangeError);
  });

  it("measures the limit on the displayed page", async () => {
    // displayed 400 x 300: 100 of top + bottom is fine upright (400 high) but not sideways (300 high)
    const margins = { top: 140, right: 0, bottom: 140, left: 0 };
    await expect(cropPages(await makePdf({ size: SIZE }), { margins })).resolves.toBeInstanceOf(Uint8Array);
    await expect(cropPages(await makePdf({ size: SIZE, rotations: [90] }), { margins })).rejects.toThrow(RangeError);
  });

  it("names the page that does not fit and changes nothing", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([300, 400]);
    doc.addPage([200, 60]); // too small for a 30 pt top + bottom margin
    doc.addPage([300, 400]);
    const bytes = await doc.save();
    await expect(cropPages(bytes, { margins: { top: 30, right: 0, bottom: 30, left: 0 } })).rejects.toThrow(
      "Los márgenes son demasiado grandes: la página 2 se quedaría con menos de 36 pt de ancho o de alto.",
    );
    // the same margins are fine when that page is left out
    const out = await cropPages(bytes, { margins: { top: 30, right: 0, bottom: 30, left: 0 }, pages: "1, 3" });
    expect(await cropBox(out, 0)).toEqual([0, 30, 300, 370]);
    expect(await cropBox(out, 1)).toEqual([0, 0, 200, 60]);
  });

  it("rejects negative and non-numeric margins", async () => {
    const bytes = await makePdf({ size: SIZE });
    for (const margins of [
      { top: -1, right: 0, bottom: 0, left: 0 },
      { top: 0, right: Number.NaN, bottom: 0, left: 0 },
      { top: 0, right: 0, bottom: Number.POSITIVE_INFINITY, left: 0 },
    ]) {
      await expect(cropPages(bytes, { margins })).rejects.toThrow("Los márgenes de recorte deben ser números mayores o iguales que 0.");
    }
  });

  it("rejects pages that do not exist with a Spanish message", async () => {
    await expect(cropPages(await makePdf({ size: SIZE }), { margins: MARGINS, pages: "2" })).rejects.toThrow(
      "La página 2 no existe (el documento tiene 1).",
    );
  });

  it("is not confused by a page rotation stored as a negative number", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([300, 400]).setRotation(degrees(-90)); // same as 270
    const out = await cropPages(await doc.save(), { margins: MARGINS });
    expect(await cropBox(out)).toEqual([30, 20, 290, 360]);
  });
});
