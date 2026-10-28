import { describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { mergeDocuments, type MergeInput } from "@/pdf/tools/merge";
import {
  displaySize,
  fieldNames,
  isColor,
  linksOf,
  makeJpeg,
  makePdf,
  makePng,
  makeRichFormPdf,
  openPdf,
  outlineOf,
  pageCountOf,
  pageLabels,
  renderPage,
  widgetsOf,
} from "./helpers";

async function pdfInput(name: string, opts: Parameters<typeof makePdf>[0], pages?: number[]): Promise<MergeInput> {
  return { name, bytes: await makePdf(opts), kind: "pdf", ...(pages ? { pages } : {}) };
}

const A4 = { width: 595.28, height: 841.89 };
const LETTER = { width: 612, height: 792 };

describe("mergeDocuments: PDFs", () => {
  it("joins the files in the order given", async () => {
    const out = await mergeDocuments([
      await pdfInput("a.pdf", { pages: 2, label: "A" }),
      await pdfInput("b.pdf", { pages: 1, label: "B" }),
      await pdfInput("c.pdf", { pages: 2, label: "C" }),
    ]);
    expect(pageLabels(out, "[A-C]")).toEqual(["A1", "A2", "B1", "C1", "C2"]);
  });

  it("takes only the requested pages of a file, in the requested order", async () => {
    const out = await mergeDocuments([
      await pdfInput("a.pdf", { pages: 5, label: "A" }, [3, 1]),
      await pdfInput("b.pdf", { pages: 2, label: "B" }),
    ]);
    expect(pageLabels(out, "[A-C]")).toEqual(["A4", "A2", "B1", "B2"]);
  });

  it("skips a file with no selected pages", async () => {
    const out = await mergeDocuments(
      [await pdfInput("a.pdf", { pages: 2, label: "A" }, []), await pdfInput("b.pdf", { pages: 1, label: "B" })],
      { bookmarks: true },
    );
    expect(pageLabels(out, "[A-C]")).toEqual(["B1"]);
    expect(outlineOf(out)).toEqual([{ title: "b", page: 0 }]);
  });

  it("preserves page rotation and page size", async () => {
    const out = await mergeDocuments([
      await pdfInput("a.pdf", { pages: 3, label: "A", rotations: [90, 0, 270], size: [200, 300] }),
      await pdfInput("b.pdf", { pages: 2, label: "B", rotations: [180, 90], size: [500, 100] }),
    ]);
    const doc = await openPdf(out);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0, 270, 180, 90]);
    expect(doc.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([
      [200, 300],
      [200, 300],
      [200, 300],
      [500, 100],
      [500, 100],
    ]);
    // what a viewer shows: sideways pages are displayed swapped
    expect(displaySize(out, 0)).toEqual({ width: 300, height: 200 });
    expect(displaySize(out, 3)).toEqual({ width: 500, height: 100 });
    expect(displaySize(out, 4)).toEqual({ width: 100, height: 500 });
    expect(pageLabels(out, "[A-C]")).toEqual(["A1", "A2", "A3", "B1", "B2"]);
  });

  it("stamps the result as made by SnowPDF", async () => {
    const out = await mergeDocuments([await pdfInput("a.pdf", { pages: 1, meta: { creator: "Otro", producer: "Otro" } })]);
    const doc = await openPdf(out);
    expect(doc.getCreator()).toBe("SnowPDF");
    expect(doc.getProducer()).toBe("SnowPDF");
    expect(doc.getCreationDate()).toBeInstanceOf(Date);
  });

  it("works with a single file", async () => {
    const out = await mergeDocuments([await pdfInput("solo.pdf", { pages: 3 })]);
    expect(pageLabels(out)).toEqual(["P1", "P2", "P3"]);
  });
});

describe("mergeDocuments: form fields and links", () => {
  it("keeps the form fields and their values", async () => {
    const out = await mergeDocuments([await pdfInput("a.pdf", { pages: 2, withForm: true, label: "A" })]);
    expect(await fieldNames(out)).toEqual(["texto_1", "acepto", "texto_2"]);
    expect(widgetsOf(out, 0).map((w) => [w.name, w.value])).toEqual([
      ["texto_1", "Valor A1"],
      ["acepto", "Yes"],
    ]);
    expect(widgetsOf(out, 1).map((w) => [w.name, w.value])).toEqual([["texto_2", "Valor A2"]]);
  });

  it("renames colliding fields instead of merging their values", async () => {
    const out = await mergeDocuments([
      await pdfInput("a.pdf", { pages: 1, withForm: true, label: "A" }),
      await pdfInput("b.pdf", { pages: 1, withForm: true, label: "B" }),
      await pdfInput("c.pdf", { pages: 1, withForm: true, label: "C" }),
    ]);
    expect(await fieldNames(out)).toEqual(["texto_1", "acepto", "texto_1_2", "acepto_2", "texto_1_3", "acepto_3"]);
    expect(widgetsOf(out, 0)[0]).toMatchObject({ name: "texto_1", value: "Valor A1" });
    expect(widgetsOf(out, 1)[0]).toMatchObject({ name: "texto_1_2", value: "Valor B1" });
    expect(widgetsOf(out, 2)[0]).toMatchObject({ name: "texto_1_3", value: "Valor C1" });
  });

  it("keeps documents without a form form-free and mixes fine with forms", async () => {
    const out = await mergeDocuments([
      await pdfInput("a.pdf", { pages: 1, label: "A" }),
      await pdfInput("b.pdf", { pages: 1, withForm: true, label: "B" }),
    ]);
    expect(await fieldNames(out)).toEqual(["texto_1", "acepto"]);
    expect(widgetsOf(out, 0)).toEqual([]);
    expect(widgetsOf(out, 1)).toHaveLength(2);
  });

  it("keeps internal links working in every merged document", async () => {
    const rich = await makeRichFormPdf();
    const out = await mergeDocuments([
      { name: "uno.pdf", bytes: rich, kind: "pdf" },
      { name: "dos.pdf", bytes: rich, kind: "pdf" },
    ]);
    expect(pageCountOf(out)).toBe(6);
    expect(linksOf(out, 0)).toEqual(["#page=3&view=Fit"]);
    expect(linksOf(out, 2)).toEqual(["#page=1&view=Fit"]);
    expect(linksOf(out, 3)).toEqual(["#page=6&view=Fit"]);
    expect(linksOf(out, 5)).toEqual(["#page=4&view=Fit"]);
  });
});

describe("mergeDocuments: bookmarks", () => {
  it("adds one bookmark per input, named after the file without extension", async () => {
    const out = await mergeDocuments(
      [
        await pdfInput("Informe final.pdf", { pages: 2, label: "A" }),
        { name: "foto.JPG", bytes: makeJpeg(40, 30), kind: "image", mime: "image/jpeg" },
        { name: "esquema.png", bytes: makePng(30, 40), kind: "image", mime: "image/png" },
        await pdfInput("anexo.PDF", { pages: 3, label: "C" }),
      ],
      { bookmarks: true },
    );
    expect(outlineOf(out)).toEqual([
      { title: "Informe final", page: 0 },
      { title: "foto", page: 2 },
      { title: "esquema", page: 3 },
      { title: "anexo", page: 4 },
    ]);
  });

  it("adds none unless asked", async () => {
    const out = await mergeDocuments([await pdfInput("a.pdf", { pages: 2 })]);
    expect(outlineOf(out)).toEqual([]);
    const doc = await openPdf(out);
    expect(doc.catalog.has(doc.context.obj("Outlines"))).toBe(false);
  });

  it("falls back to a numbered title when the name is empty", async () => {
    const out = await mergeDocuments([await pdfInput(".pdf", { pages: 1 }), await pdfInput("", { pages: 1 })], { bookmarks: true });
    expect(outlineOf(out).map((o) => o.title)).toEqual(["Documento 1", "Documento 2"]);
  });
});

describe("mergeDocuments: images", () => {
  it("turns each image into one A4 page, portrait or landscape to match the image", async () => {
    const out = await mergeDocuments([
      { name: "ancha.png", bytes: makePng(100, 50), kind: "image", mime: "image/png" },
      { name: "alta.jpg", bytes: makeJpeg(50, 100), kind: "image", mime: "image/jpeg" },
      { name: "cuadrada.png", bytes: makePng(60, 60), kind: "image", mime: "image/png" },
    ]);
    const doc = await openPdf(out);
    expect(doc.getPageCount()).toBe(3);
    const [wide, tall, square] = doc.getPages().map((p) => p.getSize());
    expect(wide.width).toBeCloseTo(A4.height, 1);
    expect(wide.height).toBeCloseTo(A4.width, 1);
    expect(tall.width).toBeCloseTo(A4.width, 1);
    expect(tall.height).toBeCloseTo(A4.height, 1);
    expect(square.width).toBeCloseTo(A4.width, 1); // square -> portrait
  });

  it("centres the image inside a 36 pt margin", async () => {
    const out = await mergeDocuments([{ name: "roja.png", bytes: makePng(100, 50), kind: "image", mime: "image/png" }]);
    const { width, height } = displaySize(out, 0);
    // landscape A4: the 2:1 image fills the width minus the margins and is centred vertically
    const imageW = width - 72;
    const imageH = imageW / 2;
    const raster = renderPage(out, 0);
    const red: [number, number, number] = [200, 30, 30];
    expect(isColor(raster.pixel(Math.round(width / 2), Math.round(height / 2)), red)).toBe(true);
    expect(isColor(raster.pixel(40, Math.round(height / 2)), red)).toBe(true); // just inside the left margin
    expect(isColor(raster.pixel(30, Math.round(height / 2)), [255, 255, 255])).toBe(true); // margin stays white
    const top = Math.round((height - imageH) / 2);
    expect(isColor(raster.pixel(Math.round(width / 2), top + 3), red)).toBe(true);
    expect(isColor(raster.pixel(Math.round(width / 2), top - 3), [255, 255, 255])).toBe(true);
  });

  it("supports Letter and 'fit' page sizes", async () => {
    const image: MergeInput = { name: "i.png", bytes: makePng(200, 100), kind: "image", mime: "image/png" };
    const letter = displaySize(await mergeDocuments([image], { imagePageSize: "Letter" }), 0);
    expect(letter.width).toBeCloseTo(LETTER.height, 1);
    expect(letter.height).toBeCloseTo(LETTER.width, 1);
    const fit = displaySize(await mergeDocuments([image], { imagePageSize: "fit" }), 0);
    expect(fit.width).toBeCloseTo(150, 1); // 200 px at 96 dpi
    expect(fit.height).toBeCloseTo(75, 1);
  });

  it("mixes PDFs and images", async () => {
    const out = await mergeDocuments([
      await pdfInput("a.pdf", { pages: 1, label: "A" }),
      { name: "i.png", bytes: makePng(80, 80), kind: "image", mime: "image/png" },
      await pdfInput("b.pdf", { pages: 1, label: "B" }),
    ]);
    expect(pageLabels(out, "[A-C]")).toEqual(["A1", "", "B1"]);
  });

  it("trusts the bytes over the declared type", async () => {
    const out = await mergeDocuments([
      { name: "mentira.jpg", bytes: makePng(30, 20), kind: "image", mime: "image/jpeg" },
      { name: "sin-tipo", bytes: makeJpeg(30, 20), kind: "image" },
    ]);
    expect(pageCountOf(out)).toBe(2);
  });
});

describe("mergeDocuments: errors", () => {
  it("needs at least one input", async () => {
    await expect(mergeDocuments([])).rejects.toThrow("Añade al menos un archivo para unir.");
  });

  it("names the file that cannot be read", async () => {
    const garbage = new TextEncoder().encode("esto no es un pdf");
    await expect(mergeDocuments([{ name: "roto.pdf", bytes: garbage, kind: "pdf" }])).rejects.toThrow(
      'No se pudo leer "roto.pdf": el archivo está dañado o no es un PDF válido.',
    );
    await expect(
      mergeDocuments([{ name: "mala.png", bytes: garbage, kind: "image", mime: "image/png" }]),
    ).rejects.toThrow('No se pudo leer la imagen "mala.png"');
  });

  it("explains that a password-protected file must be unlocked first", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.encrypt({ userPassword: "secreto", ownerPassword: "dueño" });
    const encrypted = await doc.save();
    await expect(mergeDocuments([{ name: "privado.pdf", bytes: encrypted, kind: "pdf" }])).rejects.toThrow(
      '"privado.pdf" está protegido con contraseña. Desbloquéalo antes de usarlo.',
    );
  });

  it("rejects page numbers that do not exist, naming the file", async () => {
    await expect(mergeDocuments([await pdfInput("tres.pdf", { pages: 3 }, [0, 3])])).rejects.toThrow(
      'En "tres.pdf": la página 4 no existe (el documento tiene 3).',
    );
  });

  it("refuses to produce a document without pages", async () => {
    await expect(mergeDocuments([await pdfInput("a.pdf", { pages: 2 }, [])])).rejects.toThrow(
      "Los archivos seleccionados no tienen páginas que unir.",
    );
  });
});
