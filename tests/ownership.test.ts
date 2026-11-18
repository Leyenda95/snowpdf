import { beforeEach, describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFString, StandardFonts } from "@cantoo/pdf-lib";
import { composeDocument } from "@/pdf/compose";
import { deletePages } from "@/model/docActions";
import { useDocStore } from "@/model/docStore";
import { clearRegistry, getAsset, keepEntry, putAsset, releaseOwner, setRegistryOwner } from "@/model/registry";
import type { PageRef, PdfBox } from "@/model/types";
import { makePng, pageText } from "./helpers";

const page = (id: string, sourceIndex = 0): PageRef => ({ id, sourceId: "a", sourceIndex, baseRotation: 0, rotation: 0, view: [0, 0, 595, 842] as PdfBox, crop: null });

describe("what a tab keeps alive", () => {
  beforeEach(() => clearRegistry());

  it("an image used by two tabs survives until both are closed", () => {
    setRegistryOwner("A");
    const { id } = putAsset(makePng(2, 2), "image/png", 2, 2);
    // Tab B pastes it.
    keepEntry(id, "B");
    releaseOwner("A");
    expect(getAsset(id).id).toBe(id);
    releaseOwner("B");
    expect(() => getAsset(id)).toThrow();
  });

  it("closing a tab frees what only it used", () => {
    setRegistryOwner("A");
    const mine = putAsset(makePng(2, 2), "image/png", 2, 2).id;
    setRegistryOwner("B");
    const theirs = putAsset(makePng(2, 2), "image/png", 2, 2).id;
    releaseOwner("A");
    expect(() => getAsset(mine)).toThrow();
    expect(getAsset(theirs).id).toBe(theirs);
  });
});

describe("deleting pages", () => {
  it("never leaves a document without pages", () => {
    useDocStore.getState().load({ title: "t", filePath: null, sources: {}, doc: { pages: [page("p1"), page("p2", 1)], objects: [] } });
    deletePages(["p1"]);
    expect(useDocStore.getState().doc.pages.map((p) => p.id)).toEqual(["p2"]);
    deletePages(["p2"]);
    expect(useDocStore.getState().doc.pages.map((p) => p.id)).toEqual(["p2"]);
  });
});

/** Two pages: a text field on each, the first one hidden, plus a data field that is on no page. */
async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([595, 842]);
  const p2 = doc.addPage([595, 842]);
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const secret = form.createTextField("secreto");
  secret.addToPage(p1, { x: 60, y: 400, width: 200, height: 24 });
  secret.setText("OCULTO");
  secret.updateAppearances(font);
  secret.acroField.getWidgets()[0].dict.set(PDFName.of("F"), PDFNumber.of(2)); // Hidden
  const shown = form.createTextField("visible");
  shown.addToPage(p2, { x: 60, y: 400, width: 200, height: 24 });
  shown.setText("VISIBLE");
  shown.updateAppearances(font);
  const data = doc.context.obj({ FT: "Tx", T: PDFString.of("dato"), V: PDFString.of("42") });
  form.acroForm.addField(doc.context.register(data));
  // It has no widget, so there is no appearance to build for it.
  return doc.save({ updateFieldAppearances: false });
}

const compose = (bytes: Uint8Array, pages: PageRef[], flattenForms = false) =>
  composeDocument({ sources: { a: bytes }, pages, objects: [], asset: () => { throw new Error("no assets"); }, font: () => null, flattenForms });

describe("forms on export", () => {
  it("flattening does not print a hidden field, and prints the visible one", async () => {
    const out = await compose(await formPdf(), [page("p1"), page("p2", 1)], true);
    expect(pageText(out, 0)).not.toContain("OCULTO");
    expect(pageText(out, 1)).toContain("VISIBLE");
  });

  it("removing a page keeps the fields that are on no page", async () => {
    const out = await PDFDocument.load(await compose(await formPdf(), [page("p2", 1)]));
    const fields = out.catalog.lookup(PDFName.of("AcroForm"), PDFDict).lookup(PDFName.of("Fields"));
    const names = out.getForm().getFields().map((f) => f.getName());
    expect(fields).toBeDefined();
    expect(names).toContain("dato");
    expect(names).toContain("visible");
    expect(names).not.toContain("secreto");
  });
});
