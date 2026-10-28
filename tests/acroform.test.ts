import { describe, expect, it } from "vitest";
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString, type PDFObject } from "@cantoo/pdf-lib";
import { copyPagesWithFields, registerCopiedFields } from "@/pdf/acroform";
import { createPdf, loadPdf, savePdf } from "@/pdf/docUtils";
import {
  countPageObjects,
  fieldNames,
  linksOf,
  makePdf,
  makeRichFormPdf,
  openPdf,
  pageCountOf,
  textFieldName,
  textFieldValue,
  widgetsOf,
} from "./helpers";

const N = (name: string) => PDFName.of(name);

/** Copy pages with the stock pdf-lib call, then register the fields. */
async function copyStock(srcBytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await loadPdf(srcBytes);
  const dst = await createPdf();
  const pages = await dst.copyPages(src, indices);
  pages.forEach((p) => dst.addPage(p));
  registerCopiedFields(dst, src, pages);
  return savePdf(dst);
}

/** Copy pages with the form-aware helper. */
async function copyForms(srcBytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await loadPdf(srcBytes);
  const dst = await createPdf();
  const pages = await copyPagesWithFields(dst, src, indices);
  pages.forEach((p) => dst.addPage(p));
  return savePdf(dst);
}

function acroForm(doc: PDFDocument): PDFDict | undefined {
  return doc.catalog.lookupMaybe(N("AcroForm"), PDFDict);
}

function rootFields(doc: PDFDocument): PDFDict[] {
  const fields = acroForm(doc)?.lookupMaybe(N("Fields"), PDFArray);
  return fields ? Array.from({ length: fields.size() }, (_, i) => fields.lookup(i, PDFDict)) : [];
}

function str(obj: PDFObject | undefined): string | undefined {
  if (obj instanceof PDFString) return obj.asString();
  if (obj instanceof PDFHexString) return obj.decodeText();
  return undefined;
}

describe("registerCopiedFields", () => {
  it("makes the fields of copied pages part of the destination form", async () => {
    const src = await makePdf({ pages: 2, withForm: true });

    // Without it the widgets arrive but the form does not.
    const srcDoc = await loadPdf(src);
    const bare = await createPdf();
    (await bare.copyPages(srcDoc, [0, 1])).forEach((p) => bare.addPage(p));
    expect(await fieldNames(await savePdf(bare))).toEqual([]);

    const out = await copyStock(src, [0, 1]);
    expect(await fieldNames(out)).toEqual([textFieldName(1), "acepto", textFieldName(2)]);
    // MuPDF (a different implementation) sees working fields with their values.
    expect(widgetsOf(out, 0).map((w) => [w.name, w.value])).toEqual([
      [textFieldName(1), textFieldValue("P", 1)],
      ["acepto", "Yes"],
    ]);
    expect(widgetsOf(out, 1).map((w) => [w.name, w.value])).toEqual([[textFieldName(2), textFieldValue("P", 2)]]);
  });

  it("keeps the existing appearance streams and does not ask viewers to rebuild them", async () => {
    const out = await copyStock(await makePdf({ pages: 1, withForm: true }), [0]);
    const doc = await openPdf(out);
    expect(acroForm(doc)?.has(N("NeedAppearances"))).toBe(false);
    for (const field of rootFields(doc)) {
      const widget = field.lookup(N("Kids"), PDFArray).lookup(0, PDFDict);
      expect(widget.lookup(N("AP"), PDFDict).has(N("N"))).toBe(true);
    }
  });

  it("does not create an AcroForm when the copied pages have no form", async () => {
    const out = await copyForms(await makePdf({ pages: 2 }), [0, 1]);
    expect(acroForm(await openPdf(out))).toBeUndefined();
    expect(pageCountOf(out)).toBe(2);
  });

  it("renames root fields whose name collides with one already in the document", async () => {
    const src = await loadPdf(await makePdf({ pages: 1, withForm: true }));
    const dst = await createPdf();
    for (let round = 0; round < 3; round++) {
      const pages = await copyPagesWithFields(dst, src, [0]);
      pages.forEach((p) => dst.addPage(p));
    }
    const out = await savePdf(dst);
    expect(await fieldNames(out)).toEqual([
      "texto_1",
      "acepto",
      "texto_1_2",
      "acepto_2",
      "texto_1_3",
      "acepto_3",
    ]);
    // each copy keeps its own value
    expect(widgetsOf(out, 1).map((w) => [w.name, w.value])).toEqual([
      ["texto_1_2", textFieldValue("P", 1)],
      ["acepto_2", "Yes"],
    ]);
    expect(widgetsOf(out, 2)[0]).toMatchObject({ name: "texto_1_3", value: textFieldValue("P", 1) });
  });

  it("avoids names that are taken by earlier renames", async () => {
    const src = await loadPdf(await makePdf({ pages: 1, withForm: true }));
    const dst = await createPdf();
    const form = dst.getForm();
    form.createTextField("texto_1");
    form.createTextField("texto_1_2");
    const pages = await copyPagesWithFields(dst, src, [0]);
    pages.forEach((p) => dst.addPage(p));
    expect(await fieldNames(await savePdf(dst))).toEqual(["texto_1", "texto_1_2", "texto_1_3", "acepto"]);
  });

  it("registers the root of a field once, however many widgets it has, and keeps hierarchical names", async () => {
    const out = await copyForms(await makeRichFormPdf(), [0, 1]);
    // pdf-lib lists terminal fields only; "datos" is the non-terminal parent of "datos.nombre"
    expect(await fieldNames(out)).toEqual(["texto_1", "compartido", "opcion", "texto_2", "datos.nombre"]);
    const doc = await openPdf(out);
    expect(rootFields(doc).map((f) => str(f.get(N("T"))))).toEqual(["texto_1", "compartido", "opcion", "texto_2", "datos"]);
    expect(widgetsOf(out, 1).map((w) => [w.name, w.value])).toEqual([
      ["texto_2", "valor 2"],
      ["compartido", "hola"],
      ["datos.nombre", "Ana"],
    ]);
  });

  it("keeps only the widgets of a field that sit on the copied pages", async () => {
    const out = await copyForms(await makeRichFormPdf(), [0]);
    const doc = await openPdf(out);
    const byName = new Map(doc.getForm().getFields().map((f) => [f.getName(), f]));
    expect(byName.get("compartido")?.acroField.getWidgets()).toHaveLength(1);
    expect(byName.get("opcion")?.acroField.getWidgets()).toHaveLength(1);
    expect(widgetsOf(out, 0).map((w) => w.name)).toEqual(["texto_1", "compartido", "opcion"]);
    // texto_2 / texto_3 / datos.nombre live on other pages: they do not come along
    expect([...byName.keys()]).toEqual(["texto_1", "compartido", "opcion"]);
  });

  it("points every annotation's /P to the page that holds it", async () => {
    for (const out of [await copyStock(await makeRichFormPdf(), [0, 2]), await copyForms(await makeRichFormPdf(), [0, 2])]) {
      const doc = await openPdf(out);
      expect(doc.getPageCount()).toBe(2);
      for (const page of doc.getPages()) {
        const annots = page.node.Annots();
        expect(annots && annots.size()).toBeGreaterThan(0);
        for (let i = 0; i < annots!.size(); i++) {
          const annot = annots!.lookup(i, PDFDict);
          if (annot.has(N("P"))) expect(annot.get(N("P"))).toBe(page.ref);
        }
      }
    }
  });
});

describe("copyPagesWithFields", () => {
  it("does not drag orphan copies of other pages into the document", async () => {
    const src = await makeRichFormPdf();
    const stock = await copyStock(src, [0]);
    expect(await countPageObjects(stock)).toBeGreaterThan(1); // pdf-lib's own behaviour
    for (const indices of [[0], [1], [2], [0, 2], [2, 0], [0, 1, 2]]) {
      const out = await copyForms(src, indices);
      expect(await countPageObjects(out)).toBe(indices.length);
    }
    expect((await copyForms(src, [0])).length).toBeLessThan(stock.length);
  });

  it("keeps links between copied pages working and removes links to pages left out", async () => {
    const src = await makeRichFormPdf();
    expect(linksOf(await copyForms(src, [0, 2]), 0)).toEqual(["#page=2&view=Fit"]);
    expect(linksOf(await copyForms(src, [0, 2]), 1)).toEqual(["#page=1&view=Fit"]);
    // reordered
    const swapped = await copyForms(src, [2, 0]);
    expect(linksOf(swapped, 0)).toEqual(["#page=2&view=Fit"]);
    expect(linksOf(swapped, 1)).toEqual(["#page=1&view=Fit"]);
    // target not copied: the link annotation is gone, not left dangling
    const alone = await copyForms(src, [0]);
    expect(linksOf(alone, 0)).toEqual([]);
    const doc = await openPdf(alone);
    const subtypes = Array.from({ length: doc.getPage(0).node.Annots()!.size() }, (_, i) =>
      doc.getPage(0).node.Annots()!.lookup(i, PDFDict).get(N("Subtype")),
    );
    expect(subtypes.every((s) => s === N("Widget"))).toBe(true);
  });

  it("copies a page requested twice as two independent pages", async () => {
    const out = await copyForms(await makePdf({ pages: 2, withForm: true }), [1, 0, 1]);
    expect(pageCountOf(out)).toBe(3);
    expect(await countPageObjects(out)).toBe(3);
    expect(await fieldNames(out)).toEqual(["texto_2", "texto_1", "acepto", "texto_2_2"]);
    expect(widgetsOf(out, 2)[0]).toMatchObject({ name: "texto_2_2", value: textFieldValue("P", 2) });
  });

  it("returns the pages in the order requested", async () => {
    const src = await loadPdf(await makePdf({ pages: 3 }));
    const dst = await createPdf();
    const pages = await copyPagesWithFields(dst, src, [2, 0]);
    expect(pages).toHaveLength(2);
    pages.forEach((p) => dst.addPage(p));
    expect(dst.getPageCount()).toBe(2);
  });

  it("rejects pages that do not exist with a Spanish message", async () => {
    const src = await loadPdf(await makePdf({ pages: 2 }));
    const dst = await createPdf();
    await expect(copyPagesWithFields(dst, src, [0, 5])).rejects.toThrow("La página 6 no existe (el documento tiene 2).");
    await expect(copyPagesWithFields(dst, src, [-1])).rejects.toThrow(RangeError);
  });

  it("preserves page rotation and the other page properties", async () => {
    const out = await copyForms(await makePdf({ pages: 3, rotations: [90, 0, 270], size: [200, 300] }), [2, 0]);
    const doc = await openPdf(out);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([270, 90]);
    expect(doc.getPage(0).getSize()).toEqual({ width: 200, height: 300 });
  });
});

// ---------------------------------------------------------------------------------------------
// /DR, /DA and /Q handling

interface FormDocOptions {
  name: string;
  /** BaseFont of the /DR font called "Helv". */
  helvFont?: string;
  /** AcroForm-level /DA. */
  da?: string;
  /** AcroForm-level /Q. */
  q?: number;
  /** /DA written on the field itself (default: removed, so it inherits). */
  fieldDA?: string;
  needAppearances?: boolean;
}

/** A one-page form whose defaults live in the AcroForm dictionary, as Acrobat writes them. */
async function makeFormWithDefaults(opts: FormDocOptions): Promise<Uint8Array> {
  const doc = await createPdf();
  const form = doc.getForm();
  const text = form.createTextField(opts.name);
  text.setText("x");
  text.addToPage(doc.addPage([300, 200]), { x: 20, y: 20, width: 100, height: 20 });
  const generated = await doc.save(); // appearances are generated here

  const patched = await loadPdf(generated);
  const ctx = patched.context;
  const acro = acroForm(patched)!;
  const field = rootFields(patched)[0];
  if (opts.fieldDA === undefined) field.delete(N("DA"));
  else field.set(N("DA"), PDFString.of(opts.fieldDA));
  if (opts.helvFont) {
    const font = ctx.register(ctx.obj({ Type: "Font", Subtype: "Type1", BaseFont: opts.helvFont }));
    acro.set(N("DR"), ctx.obj({ Font: { Helv: font } }));
  }
  if (opts.da !== undefined) acro.set(N("DA"), PDFString.of(opts.da));
  if (opts.q !== undefined) acro.set(N("Q"), ctx.obj(opts.q));
  if (opts.needAppearances) acro.set(N("NeedAppearances"), PDFBool.True);
  return savePdf(patched);
}

async function mergeForms(...sources: Uint8Array[]): Promise<PDFDocument> {
  const dst = await createPdf();
  for (const bytes of sources) {
    const src = await loadPdf(bytes);
    (await copyPagesWithFields(dst, src, [0])).forEach((p) => dst.addPage(p));
  }
  return openPdf(await savePdf(dst));
}

function drFonts(doc: PDFDocument): Map<string, string> {
  const fonts = acroForm(doc)?.lookupMaybe(N("DR"), PDFDict)?.lookupMaybe(N("Font"), PDFDict);
  const out = new Map<string, string>();
  for (const [key, value] of fonts?.entries() ?? []) {
    const font = doc.context.lookup(value, PDFDict);
    out.set(key.decodeText(), (font.lookup(N("BaseFont")) as PDFName).decodeText());
  }
  return out;
}

describe("form defaults (/DR, /DA, /Q)", () => {
  it("brings the source default resources and default appearance along", async () => {
    const doc = await mergeForms(await makeFormWithDefaults({ name: "a", helvFont: "Helvetica", da: "/Helv 12 Tf 0 g", q: 1 }));
    expect(drFonts(doc)).toEqual(new Map([["Helv", "Helvetica"]]));
    expect(str(acroForm(doc)?.get(N("DA")))).toBe("/Helv 12 Tf 0 g");
    // the fields inherit from the AcroForm, so nothing has to be written on them
    expect(rootFields(doc)[0].has(N("DA"))).toBe(false);
  });

  it("does not duplicate a font the destination already has under the same name", async () => {
    const a = await makeFormWithDefaults({ name: "a", helvFont: "Helvetica", da: "/Helv 12 Tf 0 g" });
    const b = await makeFormWithDefaults({ name: "b", helvFont: "Helvetica", da: "/Helv 12 Tf 0 g" });
    const doc = await mergeForms(a, b);
    expect(drFonts(doc)).toEqual(new Map([["Helv", "Helvetica"]]));
    expect(rootFields(doc).map((f) => f.has(N("DA")))).toEqual([false, false]);
  });

  it("writes the source default appearance and alignment on fields that would otherwise change look", async () => {
    const a = await makeFormWithDefaults({ name: "a", helvFont: "Helvetica", da: "/Helv 10 Tf 0 g" });
    const b = await makeFormWithDefaults({ name: "b", helvFont: "Helvetica", da: "/Helv 14 Tf 1 0 0 rg", q: 2 });
    const doc = await mergeForms(a, b);
    const [first, second] = rootFields(doc);
    expect(first.has(N("DA"))).toBe(false);
    expect(first.has(N("Q"))).toBe(false);
    expect(str(second.get(N("DA")))).toBe("/Helv 14 Tf 1 0 0 rg");
    expect(second.lookup(N("Q"))?.toString()).toBe("2");
  });

  it("keeps a field's own /DA untouched", async () => {
    const a = await makeFormWithDefaults({ name: "a", helvFont: "Helvetica", da: "/Helv 10 Tf 0 g" });
    const b = await makeFormWithDefaults({ name: "b", helvFont: "Helvetica", da: "/Helv 14 Tf 0 g", fieldDA: "/Helv 8 Tf 0 g" });
    const doc = await mergeForms(a, b);
    expect(str(rootFields(doc)[1].get(N("DA")))).toBe("/Helv 8 Tf 0 g");
  });

  it("registers a different font that has the same resource name under a new name and rewrites the /DA that use it", async () => {
    const a = await makeFormWithDefaults({ name: "a", helvFont: "Helvetica", da: "/Helv 12 Tf 0 g" });
    const b = await makeFormWithDefaults({ name: "b", helvFont: "Courier", da: "/Helv 12 Tf 0 g" });
    const c = await makeFormWithDefaults({ name: "c", helvFont: "Courier", da: "/Helv 12 Tf 0 g", fieldDA: "/Helv 9 Tf 0 g" });
    const doc = await mergeForms(a, b, c);
    expect(drFonts(doc)).toEqual(
      new Map([
        ["Helv", "Helvetica"],
        ["Helv_2", "Courier"],
        ["Helv_3", "Courier"],
      ]),
    );
    const [fa, fb, fc] = rootFields(doc);
    expect(fa.has(N("DA"))).toBe(false); // still resolves to the Helvetica it was made for
    expect(str(fb.get(N("DA")))).toBe("/Helv_2 12 Tf 0 g");
    expect(str(fc.get(N("DA")))).toBe("/Helv_3 9 Tf 0 g");
  });

  it("passes on a source that asked viewers to rebuild appearances, but never forces it", async () => {
    const asked = await mergeForms(await makeFormWithDefaults({ name: "a", needAppearances: true }));
    expect(acroForm(asked)?.lookup(N("NeedAppearances"))).toBe(PDFBool.True);
    const plain = await mergeForms(await makeFormWithDefaults({ name: "a" }));
    expect(acroForm(plain)?.has(N("NeedAppearances"))).toBe(false);
  });

  it("leaves a widget that is not part of any field alone", async () => {
    const doc = await createPdf();
    const page = doc.addPage([200, 200]);
    const widget = doc.context.obj({ Type: "Annot", Subtype: "Widget", Rect: [10, 10, 60, 30] });
    page.node.addAnnot(doc.context.register(widget));
    const src = await loadPdf(await savePdf(doc));
    const dst = await createPdf();
    const pages = await copyPagesWithFields(dst, src, [0]);
    pages.forEach((p) => dst.addPage(p));
    expect(acroForm(await openPdf(await savePdf(dst)))).toBeUndefined();
  });
});

describe("registerCopiedFields on its own", () => {
  it("is idempotent", async () => {
    const src = await loadPdf(await makePdf({ pages: 1, withForm: true }));
    const dst = await createPdf();
    const pages = await dst.copyPages(src, [0]);
    pages.forEach((p) => dst.addPage(p));
    registerCopiedFields(dst, src, pages);
    registerCopiedFields(dst, src, pages);
    const doc = await openPdf(await savePdf(dst));
    expect(rootFields(doc).map((f) => str(f.get(N("T"))))).toEqual(["texto_1", "acepto"]);
    // and the registered roots are real indirect objects of the form
    const fields = acroForm(doc)!.lookup(N("Fields"), PDFArray);
    expect(fields.get(0)).toBeInstanceOf(PDFRef);
  });
});

// ---------------------------------------------------------------------------------------------
// Files that do not follow the rules

describe("copyPagesWithFields: odd files", () => {
  async function twoPagesWithLinks(): Promise<Uint8Array> {
    const doc = await createPdf();
    const [one, two] = [doc.addPage([300, 200]), doc.addPage([300, 200])];
    const ctx = doc.context;
    const link = (entries: Record<string, unknown>) => {
      const dict = ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [10, 10, 100, 40], Border: [0, 0, 0], ...entries } as never);
      one.node.addAnnot(ctx.register(dict));
    };
    link({ Dest: PDFString.of("capitulo1") }); // named destination (string)
    link({ Dest: N("capitulo2") }); // named destination (name)
    link({ A: { S: "GoTo", D: PDFString.of("capitulo3") } });
    link({ A: { S: "URI", URI: PDFString.of("https://example.com") } });
    link({ Dest: [two.ref, "Fit"] }); // to the second page
    link({ A: { S: "GoTo", D: [two.ref, "Fit"] } }); // same, as an action
    return savePdf(doc);
  }

  const annotCount = async (bytes: Uint8Array, page = 0) => (await openPdf(bytes)).getPage(page).node.Annots()?.size() ?? 0;

  it("leaves links to named destinations and URLs alone and only drops the ones that lost their page", async () => {
    const src = await twoPagesWithLinks();
    expect(await annotCount(src)).toBe(6);
    expect(await annotCount(await copyForms(src, [0]))).toBe(4); // the two links to page 2 are gone
    expect(await annotCount(await copyForms(src, [0, 1]))).toBe(6); // all of them survive when page 2 comes along
    expect(linksOf(await copyForms(src, [0, 1]), 0).filter((uri) => uri.startsWith("#page=2"))).toHaveLength(2);
    expect(await annotCount(await copyStock(src, [0]))).toBe(6); // pdf-lib's own copy keeps everything
  });

  it("does not trip over wrong types in annotations, fields and form defaults", async () => {
    const doc = await createPdf();
    const page = doc.addPage([300, 200]);
    const ctx = doc.context;
    // a field whose entries are of the wrong type
    const widget = ctx.obj({
      Type: "Annot",
      Subtype: "Widget",
      FT: "Tx",
      Rect: [10, 10, 100, 40],
      Parent: 7, // not a reference
      Kids: 5, // not an array
      T: 42, // not a string
      DA: 12, // not a string
    });
    const widgetRef = ctx.register(widget);
    page.node.addAnnot(widgetRef);
    // junk next to the real annotation
    page.node.Annots()!.push(ctx.obj(7));
    page.node.Annots()!.push(ctx.obj(null));
    page.node.Annots()!.push(ctx.obj("Nombre"));
    const acro = ctx.obj({ Fields: [widgetRef], DR: [1, 2, 3], DA: 12, Q: "izquierda", NeedAppearances: 1 });
    doc.catalog.set(N("AcroForm"), ctx.register(acro));
    const src = await savePdf(doc);

    for (const out of [await copyForms(src, [0]), await copyForms(src, [0, 0])]) {
      expect(pageCountOf(out)).toBeGreaterThanOrEqual(1);
      const fields = rootFields(await openPdf(out));
      expect(fields.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("copes with a form that is not a dictionary and fields that are not in the form", async () => {
    const doc = await createPdf();
    const page = doc.addPage([300, 200]);
    const ctx = doc.context;
    page.node.addAnnot(ctx.register(ctx.obj({ Type: "Annot", Subtype: "Widget", FT: "Tx", Rect: [10, 10, 100, 40], T: PDFString.of("suelto") })));
    doc.catalog.set(N("AcroForm"), ctx.obj(5));
    const out = await copyForms(await savePdf(doc), [0]);
    expect(await openPdf(out).then((d) => rootFields(d).map((f) => str(f.get(N("T")))))).toEqual(["suelto"]);
  });
});

describe("fields written the way Acrobat writes them", () => {
  /** Field and widget in one dictionary, listed directly in /Fields (no /Kids, no /Parent). */
  async function mergedFieldDoc(opts: { direct?: boolean } = {}): Promise<Uint8Array> {
    const doc = await createPdf();
    const page = doc.addPage([300, 200]);
    const ctx = doc.context;
    const field = ctx.obj({
      Type: "Annot",
      Subtype: "Widget",
      FT: "Tx",
      T: PDFHexString.fromText("nombre"),
      V: PDFHexString.fromText("Marta"),
      DA: PDFString.of("/Helv 10 Tf 0 g"),
      Rect: [20, 20, 160, 44],
      F: 4,
      P: page.ref,
    });
    const ref = ctx.register(field);
    if (opts.direct) page.node.set(N("Annots"), ctx.obj([field])); // a direct dictionary in /Annots
    else page.node.addAnnot(ref);
    doc.catalog.set(N("AcroForm"), ctx.register(ctx.obj({ Fields: opts.direct ? [] : [ref], DA: PDFString.of("/Helv 10 Tf 0 g") })));
    return savePdf(doc);
  }

  it("registers merged field/widget dictionaries and renames collisions", async () => {
    const src = await mergedFieldDoc();
    const dst = await createPdf();
    const loaded = await loadPdf(src);
    for (let i = 0; i < 2; i++) (await copyPagesWithFields(dst, loaded, [0])).forEach((p) => dst.addPage(p));
    const out = await savePdf(dst);
    const doc = await openPdf(out);
    expect(rootFields(doc).map((f) => str(f.get(N("T"))))).toEqual(["nombre", "nombre_2"]);
    expect(rootFields(doc).map((f) => str(f.get(N("V"))))).toEqual(["Marta", "Marta"]);
    expect(widgetsOf(out, 1)[0]).toMatchObject({ name: "nombre_2", value: "Marta" });
    // both widgets still point at their own page
    expect(rootFields(doc).map((f, i) => f.get(N("P")) === doc.getPage(i).ref)).toEqual([true, true]);
  });

  it("finds a field whose widget is a direct dictionary in /Annots", async () => {
    const out = await copyForms(await mergedFieldDoc({ direct: true }), [0]);
    expect(await openPdf(out).then((d) => rootFields(d).map((f) => str(f.get(N("T")))))).toEqual(["nombre"]);
  });

  it("works from the stock copyPages as well", async () => {
    const out = await copyStock(await mergedFieldDoc(), [0]);
    expect(await openPdf(out).then((d) => rootFields(d).map((f) => str(f.get(N("T")))))).toEqual(["nombre"]);
  });
});
