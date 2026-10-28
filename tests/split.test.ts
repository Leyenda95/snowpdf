import { describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { splitDocument } from "@/pdf/tools/split";
import {
  countPageObjects,
  displaySize,
  fieldNames,
  linksOf,
  makePdf,
  makePng,
  makeRichFormPdf,
  openPdf,
  pageCountOf,
  pageLabels,
  widgetsOf,
} from "./helpers";

const names = (files: { name: string }[]) => files.map((f) => f.name);
const labelsOf = (files: { bytes: Uint8Array }[]) => files.map((f) => pageLabels(f.bytes));

describe("splitDocument: ranges", () => {
  it("makes one file per range, named after the pages it holds", async () => {
    const files = await splitDocument(await makePdf({ pages: 10 }), "Informe", { kind: "ranges", ranges: "1-3, 5, 8-" });
    expect(names(files)).toEqual(["Informe_paginas_1-3.pdf", "Informe_pagina_5.pdf", "Informe_paginas_8-10.pdf"]);
    expect(labelsOf(files)).toEqual([["P1", "P2", "P3"], ["P5"], ["P8", "P9", "P10"]]);
  });

  it("puts all the ranges in one file when asked, in the order written", async () => {
    const files = await splitDocument(await makePdf({ pages: 6 }), "Doc", { kind: "ranges", ranges: "5-6, 1, 3", mergeIntoOne: true });
    expect(names(files)).toEqual(["Doc_extraido.pdf"]);
    expect(labelsOf(files)).toEqual([["P5", "P6", "P1", "P3"]]);
  });

  it("repeats pages that several ranges share", async () => {
    const [file] = await splitDocument(await makePdf({ pages: 4 }), "Doc", { kind: "ranges", ranges: "1-3, 2-4", mergeIntoOne: true });
    expect(pageLabels(file.bytes)).toEqual(["P1", "P2", "P3", "P2", "P3", "P4"]);
    expect(await countPageObjects(file.bytes)).toBe(6);
  });

  it("supports descending ranges", async () => {
    const files = await splitDocument(await makePdf({ pages: 5 }), "Doc", { kind: "ranges", ranges: "4-2" });
    expect(names(files)).toEqual(["Doc_paginas_4-2.pdf"]);
    expect(labelsOf(files)).toEqual([["P4", "P3", "P2"]]);
  });

  it("never produces two files with the same name", async () => {
    const files = await splitDocument(await makePdf({ pages: 4 }), "Doc", { kind: "ranges", ranges: "1-2, 1-2, 1-2" });
    expect(names(files)).toEqual(["Doc_paginas_1-2.pdf", "Doc_paginas_1-2_2.pdf", "Doc_paginas_1-2_3.pdf"]);
  });

  it("rejects bad ranges with Spanish messages", async () => {
    const bytes = await makePdf({ pages: 6 });
    await expect(splitDocument(bytes, "Doc", { kind: "ranges", ranges: "1-9" })).rejects.toThrow(
      "La página 9 no existe (el documento tiene 6).",
    );
    await expect(splitDocument(bytes, "Doc", { kind: "ranges", ranges: "x" })).rejects.toThrow('Rango no válido: "x"');
    await expect(splitDocument(bytes, "Doc", { kind: "ranges", ranges: "  " })).rejects.toThrow(
      "Indica los rangos de páginas, por ejemplo 1-3, 5, 8-.",
    );
  });
});

describe("splitDocument: every / each / select", () => {
  it("cuts the document in chunks of N pages", async () => {
    const files = await splitDocument(await makePdf({ pages: 5 }), "Doc", { kind: "every", size: 2 });
    expect(names(files)).toEqual(["Doc_paginas_1-2.pdf", "Doc_paginas_3-4.pdf", "Doc_pagina_5.pdf"]);
    expect(labelsOf(files)).toEqual([["P1", "P2"], ["P3", "P4"], ["P5"]]);
  });

  it("gives a single file when the chunk is as large as the document", async () => {
    for (const size of [5, 6, 100]) {
      const files = await splitDocument(await makePdf({ pages: 5 }), "Doc", { kind: "every", size });
      expect(names(files)).toEqual(["Doc_paginas_1-5.pdf"]);
    }
  });

  it("treats chunks of one page like 'each' and floors fractional sizes", async () => {
    const files = await splitDocument(await makePdf({ pages: 3 }), "Doc", { kind: "every", size: 1 });
    expect(names(files)).toEqual(["Doc_pagina_1.pdf", "Doc_pagina_2.pdf", "Doc_pagina_3.pdf"]);
    const floored = await splitDocument(await makePdf({ pages: 5 }), "Doc", { kind: "every", size: 2.9 });
    expect(names(floored)).toEqual(["Doc_paginas_1-2.pdf", "Doc_paginas_3-4.pdf", "Doc_pagina_5.pdf"]);
  });

  it("rejects chunk sizes below 1", async () => {
    const bytes = await makePdf({ pages: 3 });
    for (const size of [0, -2, 0.5, Number.NaN]) {
      await expect(splitDocument(bytes, "Doc", { kind: "every", size })).rejects.toThrow(
        "El número de páginas por archivo debe ser 1 o más.",
      );
    }
  });

  it("makes one file per page", async () => {
    const files = await splitDocument(await makePdf({ pages: 4 }), "Doc", { kind: "each" });
    expect(names(files)).toEqual(["Doc_pagina_1.pdf", "Doc_pagina_2.pdf", "Doc_pagina_3.pdf", "Doc_pagina_4.pdf"]);
    expect(labelsOf(files)).toEqual([["P1"], ["P2"], ["P3"], ["P4"]]);
    expect(files.every((f) => pageCountOf(f.bytes) === 1)).toBe(true);
  });

  it("extracts the selected pages into one file, in page order without repeats", async () => {
    const files = await splitDocument(await makePdf({ pages: 8 }), "Doc", { kind: "select", pages: "6, 2, 4-5, 5" });
    expect(names(files)).toEqual(["Doc_extraido.pdf"]);
    expect(labelsOf(files)).toEqual([["P2", "P4", "P5", "P6"]]);
  });

  it("accepts 'todas' and refuses an empty selection", async () => {
    const bytes = await makePdf({ pages: 3 });
    const all = await splitDocument(bytes, "Doc", { kind: "select", pages: "todas" });
    expect(labelsOf(all)).toEqual([["P1", "P2", "P3"]]);
    await expect(splitDocument(bytes, "Doc", { kind: "select", pages: "" })).rejects.toThrow(
      "Indica qué páginas quieres extraer, por ejemplo 1-3, 5.",
    );
    await expect(splitDocument(bytes, "Doc", { kind: "select", pages: "9" })).rejects.toThrow(
      "La página 9 no existe (el documento tiene 3).",
    );
  });
});

describe("splitDocument: what every piece keeps", () => {
  it("preserves page rotation and size", async () => {
    const bytes = await makePdf({ pages: 4, rotations: [90, 180, 270, 0], size: [200, 300] });
    const files = await splitDocument(bytes, "Doc", { kind: "each" });
    const rotations = await Promise.all(files.map(async (f) => (await openPdf(f.bytes)).getPage(0).getRotation().angle));
    expect(rotations).toEqual([90, 180, 270, 0]);
    expect(displaySize(files[0].bytes)).toEqual({ width: 300, height: 200 });
    expect(displaySize(files[1].bytes)).toEqual({ width: 200, height: 300 });
    expect(labelsOf(files)).toEqual([["P1"], ["P2"], ["P3"], ["P4"]]);
  });

  it("preserves form fields and their values", async () => {
    const files = await splitDocument(await makePdf({ pages: 3, withForm: true }), "Doc", { kind: "each" });
    expect(await Promise.all(files.map((f) => fieldNames(f.bytes)))).toEqual([["texto_1", "acepto"], ["texto_2"], ["texto_3"]]);
    expect(widgetsOf(files[0].bytes).map((w) => [w.name, w.value])).toEqual([
      ["texto_1", "Valor P1"],
      ["acepto", "Yes"],
    ]);
    expect(widgetsOf(files[2].bytes).map((w) => [w.name, w.value])).toEqual([["texto_3", "Valor P3"]]);
  });

  it("keeps the fields of a page range together and out of other ranges", async () => {
    const files = await splitDocument(await makePdf({ pages: 4, withForm: true }), "Doc", { kind: "ranges", ranges: "1-2, 4" });
    expect(await fieldNames(files[0].bytes)).toEqual(["texto_1", "acepto", "texto_2"]);
    expect(await fieldNames(files[1].bytes)).toEqual(["texto_4"]);
  });

  it("keeps a field that spans pages only where it has widgets and does not drag other pages along", async () => {
    const files = await splitDocument(await makeRichFormPdf(), "Doc", { kind: "each" });
    expect(await Promise.all(files.map((f) => countPageObjects(f.bytes)))).toEqual([1, 1, 1]);
    expect(widgetsOf(files[0].bytes).map((w) => w.name)).toEqual(["texto_1", "compartido", "opcion"]);
    expect(widgetsOf(files[1].bytes).map((w) => w.name)).toEqual(["texto_2", "compartido", "datos.nombre"]);
    expect(widgetsOf(files[2].bytes).map((w) => w.name)).toEqual(["texto_3", "opcion"]);
    // the links pointed to pages that are no longer there
    expect(files.map((f) => linksOf(f.bytes))).toEqual([[], [], []]);
  });

  it("keeps links between pages that stay together", async () => {
    const [file] = await splitDocument(await makeRichFormPdf(), "Doc", { kind: "select", pages: "1, 3" });
    expect(linksOf(file.bytes, 0)).toEqual(["#page=2&view=Fit"]);
    expect(linksOf(file.bytes, 1)).toEqual(["#page=1&view=Fit"]);
  });

  it("does not copy the whole document into every piece", async () => {
    // Five pages with a different noisy picture each and one form field with a widget on every page.
    const noise = (seed: number) => {
      let state = seed;
      return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return [state & 255, (state >> 8) & 255, (state >> 16) & 255] as [number, number, number];
      };
    };
    const doc = await PDFDocument.create({ updateMetadata: false });
    const form = doc.getForm();
    const shared = form.createTextField("en_todas");
    shared.setText("x");
    for (let i = 0; i < 5; i++) {
      const page = doc.addPage([300, 300]);
      const next = noise(i + 1);
      const image = await doc.embedPng(makePng(90, 90, () => next()));
      page.drawImage(image, { x: 10, y: 60, width: 280, height: 230 });
      shared.addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
    }
    const source = await doc.save();

    const files = await splitDocument(source, "Doc", { kind: "each" });
    expect(files).toHaveLength(5);
    for (const file of files) {
      expect(file.bytes.length).toBeLessThan(source.length * 0.4);
      expect(await countPageObjects(file.bytes)).toBe(1);
      expect(await fieldNames(file.bytes)).toEqual(["en_todas"]);
    }
  });

  it("carries over title, author, subject and keywords and stamps the result", async () => {
    const bytes = await makePdf({
      pages: 2,
      meta: { title: "Mi informe", author: "Álvaro", subject: "Cuentas", keywords: ["a", "b"], creator: "Word", producer: "Word" },
    });
    const [file] = await splitDocument(bytes, "Doc", { kind: "select", pages: "2" });
    const doc = await openPdf(file.bytes);
    expect(doc.getTitle()).toBe("Mi informe");
    expect(doc.getAuthor()).toBe("Álvaro");
    expect(doc.getSubject()).toBe("Cuentas");
    expect(doc.getKeywords()).toBe("a b");
    expect(doc.getCreator()).toBe("SnowPDF");
    expect(doc.getProducer()).toBe("SnowPDF");
  });
});

describe("splitDocument: naming and errors", () => {
  it("falls back to 'documento' for an empty base name and trims spaces", async () => {
    const bytes = await makePdf({ pages: 2 });
    expect(names(await splitDocument(bytes, "  ", { kind: "each" }))).toEqual(["documento_pagina_1.pdf", "documento_pagina_2.pdf"]);
    expect(names(await splitDocument(bytes, " Mi doc ", { kind: "select", pages: "1" }))).toEqual(["Mi doc_extraido.pdf"]);
  });

  it("explains unreadable and password-protected files", async () => {
    await expect(splitDocument(new TextEncoder().encode("nada"), "Doc", { kind: "each" })).rejects.toThrow(
      'No se pudo leer "Doc.pdf": el archivo está dañado o no es un PDF válido.',
    );
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.encrypt({ userPassword: "x", ownerPassword: "y" });
    await expect(splitDocument(await doc.save(), "Doc", { kind: "each" })).rejects.toThrow(
      '"Doc.pdf" está protegido con contraseña. Desbloquéalo antes de usarlo.',
    );
  });

  it("refuses a document without pages", async () => {
    // pdf-lib adds a blank page to empty documents unless told not to
    const empty = await (await PDFDocument.create()).save({ addDefaultPage: false });
    await expect(splitDocument(empty, "Doc", { kind: "each" })).rejects.toThrow("El documento no tiene páginas.");
  });
});
