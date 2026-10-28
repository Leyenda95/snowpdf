import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFBool, PDFDict, PDFDocument, PDFName, PDFNumber, degrees } from "@cantoo/pdf-lib";
import { flattenForm } from "@/pdf/tools/flatten";
import {
  fieldNames,
  linksOf,
  makePdf,
  makeRichFormPdf,
  openPdf,
  pageCountOf,
  pageLabels,
  pageText,
  textRuns,
  widgetsOf,
} from "./helpers";

afterEach(() => vi.restoreAllMocks());

/** A form whose widgets have no appearance streams, as some generators write them. */
async function formWithoutAppearances(values: Record<string, string>, rotation = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([300, 200]);
  if (rotation) page.setRotation(degrees(rotation));
  const form = doc.getForm();
  let y = 20;
  for (const [name, value] of Object.entries(values)) {
    const field = form.createTextField(name);
    field.setText(value);
    field.addToPage(page, { x: 20, y, width: 200, height: 24 });
    y += 40;
  }
  // pdf-lib draws the appearances when saving: take them out again
  const stripped = await PDFDocument.load(await doc.save(), { updateMetadata: false });
  const annots = stripped.getPage(0).node.Annots()!;
  for (let i = 0; i < annots.size(); i++) annots.lookup(i, PDFDict).delete(PDFName.of("AP"));
  return stripped.save();
}

describe("flattenForm", () => {
  it("turns the fields into page content: no fields remain and the values stay visible", async () => {
    const bytes = await makePdf({ pages: 2, withForm: true, label: "A" });
    expect(await fieldNames(bytes)).toEqual(["texto_1", "acepto", "texto_2"]);

    const out = await flattenForm(bytes);
    expect(await fieldNames(out)).toEqual([]);
    expect(widgetsOf(out, 0)).toEqual([]);
    expect(widgetsOf(out, 1)).toEqual([]);
    const doc = await openPdf(out);
    expect(doc.catalog.has(PDFName.of("AcroForm"))).toBe(false);
    for (const page of doc.getPages()) {
      const annots = page.node.Annots();
      expect(annots === undefined || annots.size() === 0).toBe(true);
    }
    expect(pageText(out, 0)).toContain("Valor A1");
    expect(pageText(out, 1)).toContain("Valor A2");
    expect(pageLabels(out, "A")).toEqual(["A1", "A2"]);
  });

  it("paints the fields exactly where and how they were, on rotated pages too", async () => {
    const bytes = await makePdf({ pages: 4, withForm: true, size: [300, 400], rotations: [0, 90, 180, 270] });
    const out = await flattenForm(bytes);
    for (let i = 0; i < 4; i++) {
      const value = (runs: ReturnType<typeof textRuns>) => runs.find((r) => r.text === `Valor P${i + 1}`)!;
      const before = value(textRuns(bytes, i));
      const after = value(textRuns(out, i));
      expect(before, `before, page ${i + 1}`).toBeDefined();
      expect(after, `after, page ${i + 1}`).toBeDefined();
      expect(after.x).toBeCloseTo(before.x, 2);
      expect(after.y).toBeCloseTo(before.y, 2);
      expect(after.angle).toBeCloseTo(before.angle, 2);
      expect(after.size).toBeCloseTo(before.size, 2);
    }
  });

  it("gives fields without an appearance one, in Helvetica", async () => {
    const bytes = await formWithoutAppearances({ nombre: "Álvaro", ciudad: "Sevilla" });
    const original = await openPdf(bytes);
    expect(original.getPage(0).node.Annots()!.lookup(0, PDFDict).has(PDFName.of("AP"))).toBe(false); // fixture check

    const out = await flattenForm(bytes);
    expect(await fieldNames(out)).toEqual([]);
    expect(pageText(out, 0)).toContain("Álvaro");
    expect(pageText(out, 0)).toContain("Sevilla");
    const run = textRuns(out, 0).find((r) => r.text === "Álvaro")!;
    expect(run.size).toBeGreaterThan(5); // drawn at a readable size
    expect(run.color).toEqual([0, 0, 0]);
  });

  it("flattens a field without appearance on a rotated page turned with the page, like any other field", async () => {
    const out = await flattenForm(await formWithoutAppearances({ nombre: "Hola" }, 90));
    const run = textRuns(out, 0).find((r) => r.text === "Hola")!;
    expect(run.angle).toBeCloseTo(-90, 2); // a widget turns with a page rotated 90 degrees clockwise
  });

  it("does not choke on a value the fallback font cannot draw; the other fields are still flattened", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bytes = await formWithoutAppearances({ ruso: "Привет", bien: "Todo correcto" });
    const out = await flattenForm(bytes);
    expect(await fieldNames(out)).toEqual([]);
    expect(widgetsOf(out, 0)).toEqual([]);
    expect(pageText(out, 0)).toContain("Todo correcto");
  });

  it("flattens every kind of field of a realistic form and keeps links", async () => {
    const bytes = await makeRichFormPdf();
    const out = await flattenForm(bytes);
    expect(await fieldNames(out)).toEqual([]);
    for (let i = 0; i < 3; i++) expect(widgetsOf(out, i)).toEqual([]);
    expect(pageText(out, 0)).toContain("valor 1");
    expect(pageText(out, 0)).toContain("hola"); // the shared field has a widget on pages 1 and 2
    expect(pageText(out, 1)).toContain("hola");
    expect(pageText(out, 1)).toContain("Ana");
    expect(pageText(out, 2)).toContain("valor 3");
    expect(linksOf(out, 0)).toEqual(["#page=3&view=Fit"]);
    expect(linksOf(out, 2)).toEqual(["#page=1&view=Fit"]);
  });

  it("returns a form-free document re-saved, otherwise unchanged", async () => {
    const bytes = await makePdf({ pages: 3, rotations: [0, 90, 0], meta: { title: "Sin formulario", creator: "Original" } });
    const out = await flattenForm(bytes);
    expect(pageCountOf(out)).toBe(3);
    expect(pageLabels(out)).toEqual(["P1", "P2", "P3"]);
    const doc = await openPdf(out);
    expect(doc.catalog.has(PDFName.of("AcroForm"))).toBe(false); // none was invented
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 0]);
    expect(doc.getTitle()).toBe("Sin formulario");
    expect(doc.getCreator()).toBe("Original");
    expect(doc.getProducer()).toBe("SnowPDF");
  });

  it("keeps the rest of the document and can be applied twice", async () => {
    const bytes = await makePdf({ pages: 2, withForm: true, meta: { title: "Doc", creator: "Original" } });
    const once = await flattenForm(bytes);
    const twice = await flattenForm(once);
    for (const out of [once, twice]) {
      expect(pageLabels(out)).toEqual(["P1", "P2"]);
      expect(await fieldNames(out)).toEqual([]);
      const doc = await openPdf(out);
      expect(doc.getTitle()).toBe("Doc");
      expect(doc.getCreator()).toBe("Original");
    }
  });

  it("drops an AcroForm that has no fields left", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage();
    doc.getForm(); // creates an empty AcroForm
    const out = await flattenForm(await doc.save());
    expect((await openPdf(out)).catalog.has(PDFName.of("AcroForm"))).toBe(false);
  });
});

describe("flattenForm: what viewers would not show or would rebuild", () => {
  /** page 1 of a two-page form, edited at the dictionary level. */
  async function patched(edit: (acro: PDFDict, widgets: PDFDict[], doc: PDFDocument) => void): Promise<Uint8Array> {
    const doc = await openPdf(await makePdf({ pages: 2, withForm: true }));
    const widgets = doc.getPages().flatMap((p) => {
      const annots = p.node.Annots()!;
      return Array.from({ length: annots.size() }, (_, i) => annots.lookup(i, PDFDict));
    });
    edit(doc.catalog.lookup(PDFName.of("AcroForm"), PDFDict), widgets, doc);
    return doc.save({ updateFieldAppearances: false });
  }

  it("does not paint widgets that are hidden or not meant to be viewed", async () => {
    const bytes = await patched((_, widgets) => {
      widgets[0].set(PDFName.of("F"), PDFNumber.of(2)); // texto_1: Hidden
      widgets[1].set(PDFName.of("F"), PDFNumber.of(32)); // acepto: NoView
    });
    const out = await flattenForm(bytes);
    expect(await fieldNames(out)).toEqual([]);
    expect(pageText(out, 0)).not.toContain("Valor P1");
    expect(pageText(out, 1)).toContain("Valor P2"); // the visible one still is
    expect(widgetsOf(out, 0)).toEqual([]);
  });

  it("rebuilds text appearances when the form asks viewers to (NeedAppearances), instead of flattening stale ones", async () => {
    const stale = (acro: PDFDict, widgets: PDFDict[], doc: PDFDocument, flag: boolean) => {
      const empty = doc.context.register(doc.context.formXObject([], { BBox: [0, 0, 150, 24] }));
      for (const w of widgets) w.lookup(PDFName.of("AP"), PDFDict).set(PDFName.of("N"), empty);
      if (flag) acro.set(PDFName.of("NeedAppearances"), PDFBool.True);
    };
    // every widget gets an empty look, as if the file had been filled in by a tool that did not draw it
    const withFlag = await flattenForm(await patched((a, w, d) => stale(a, w, d, true)));
    const withoutFlag = await flattenForm(await patched((a, w, d) => stale(a, w, d, false)));
    expect(pageText(withFlag, 0)).toContain("Valor P1");
    expect(pageText(withoutFlag, 0)).not.toContain("Valor P1"); // the file's own (empty) look is respected
  });
});
