import { describe, expect, it } from "vitest";
import { PDFName, PDFNumber } from "@cantoo/pdf-lib";
import { rotatePages } from "@/pdf/tools/rotate";
import { displaySize, fieldNames, makePdf, openPdf, pageCountOf, pageLabels } from "./helpers";

async function rotations(bytes: Uint8Array): Promise<number[]> {
  return (await openPdf(bytes)).getPages().map((p) => p.getRotation().angle);
}

describe("rotatePages", () => {
  it("adds the angle clockwise to the current rotation of every page", async () => {
    const bytes = await makePdf({ pages: 4, rotations: [0, 90, 180, 270] });
    expect(await rotations(await rotatePages(bytes, { angle: 90 }))).toEqual([90, 180, 270, 0]);
    expect(await rotations(await rotatePages(bytes, { angle: 180 }))).toEqual([180, 270, 0, 90]);
    expect(await rotations(await rotatePages(bytes, { angle: 270 }))).toEqual([270, 0, 90, 180]);
  });

  it("only touches the selected pages", async () => {
    const bytes = await makePdf({ pages: 5, rotations: [0, 0, 90, 0, 0] });
    const out = await rotatePages(bytes, { angle: 90, pages: "2-3, 5" });
    expect(await rotations(out)).toEqual([0, 90, 180, 0, 90]);
  });

  it("treats empty or 'todas' as every page", async () => {
    const bytes = await makePdf({ pages: 3 });
    expect(await rotations(await rotatePages(bytes, { angle: 180, pages: "" }))).toEqual([180, 180, 180]);
    expect(await rotations(await rotatePages(bytes, { angle: 180, pages: "todas" }))).toEqual([180, 180, 180]);
  });

  it("rotates a page once even when the selection names it twice", async () => {
    const out = await rotatePages(await makePdf({ pages: 3 }), { angle: 90, pages: "2, 2, 1-2" });
    expect(await rotations(out)).toEqual([90, 90, 0]);
  });

  it("is what a viewer shows: sideways pages swap their displayed size", async () => {
    const bytes = await makePdf({ pages: 2, size: [200, 300] });
    const out = await rotatePages(bytes, { angle: 90, pages: "2" });
    expect(displaySize(out, 0)).toEqual({ width: 200, height: 300 });
    expect(displaySize(out, 1)).toEqual({ width: 300, height: 200 });
    const twice = await rotatePages(out, { angle: 90, pages: "2" });
    expect(displaySize(twice, 1)).toEqual({ width: 200, height: 300 });
  });

  it("four quarter turns bring a page back", async () => {
    let bytes = await makePdf({ pages: 1, rotations: [90] });
    for (let i = 0; i < 4; i++) bytes = await rotatePages(bytes, { angle: 90 });
    expect(await rotations(bytes)).toEqual([90]);
  });

  it("starts from an inherited or negative /Rotate", async () => {
    const inherited = await openPdf(await makePdf({ pages: 2 }));
    inherited.catalog.Pages().set(PDFName.of("Rotate"), PDFNumber.of(90));
    expect(inherited.getPage(0).getRotation().angle).toBe(90); // inherited from the page tree
    const out = await rotatePages(await inherited.save(), { angle: 90 });
    expect(await rotations(out)).toEqual([180, 180]);

    const negative = await openPdf(await makePdf({ pages: 1 }));
    negative.getPage(0).node.set(PDFName.of("Rotate"), PDFNumber.of(-90));
    expect(await rotations(await rotatePages(await negative.save(), { angle: 90 }))).toEqual([0]);
  });

  it("leaves content, order, forms and the rest untouched", async () => {
    const bytes = await makePdf({ pages: 3, withForm: true, meta: { title: "Intacto", creator: "Original" } });
    const out = await rotatePages(bytes, { angle: 90, pages: "2" });
    expect(pageCountOf(out)).toBe(3);
    expect(pageLabels(out)).toEqual(["P1", "P2", "P3"]);
    expect(await fieldNames(out)).toEqual(["texto_1", "acepto", "texto_2", "texto_3"]);
    const doc = await openPdf(out);
    expect(doc.getTitle()).toBe("Intacto");
    expect(doc.getCreator()).toBe("Original"); // not overwritten
    expect(doc.getProducer()).toBe("SnowPDF");
  });

  it("rejects angles that are not quarter turns", async () => {
    const bytes = await makePdf();
    for (const angle of [45, 91, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(rotatePages(bytes, { angle: angle as 90 })).rejects.toThrow("El ángulo de giro debe ser 90, 180 o 270 grados.");
    }
  });

  it("rejects pages that do not exist with a Spanish message", async () => {
    const bytes = await makePdf({ pages: 2 });
    await expect(rotatePages(bytes, { angle: 90, pages: "3" })).rejects.toThrow("La página 3 no existe (el documento tiene 2).");
    await expect(rotatePages(bytes, { angle: 90, pages: "x" })).rejects.toThrow('Rango no válido: "x"');
  });
});
