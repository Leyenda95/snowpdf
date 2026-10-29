import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { PDFDocument, PDFName, StandardFonts, degrees } from "@cantoo/pdf-lib";
import { composeDocument, type ComposeInput } from "@/pdf/compose";
import { redact } from "@/pdf/mupdf/ops";
import { layoutText } from "@/pdf/textLayout";
import type { EditorObject, PageRef, PdfBox, Rotation, TextObject } from "@/model/types";

// ------------------------------------------------------------------ fixtures

async function labelled(labels: string[], opts: { rotate?: number[]; field?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  labels.forEach((label, i) => {
    const page = doc.addPage([595, 842]);
    page.setRotation(degrees(opts.rotate?.[i] ?? 0));
    page.drawText(label, { x: 60, y: 700, size: 24, font });
  });
  if (opts.field) {
    const tf = doc.getForm().createTextField(opts.field);
    tf.setText("valor");
    tf.addToPage(doc.getPage(0), { x: 60, y: 400, width: 200, height: 24 });
  }
  return doc.save();
}

function pageRefs(sourceId: string, count: number, rotate: number[] = []): PageRef[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${sourceId}-p${i}`,
    sourceId,
    sourceIndex: i,
    baseRotation: (rotate[i] ?? 0) as Rotation,
    rotation: 0,
    view: [0, 0, 595, 842] as PdfBox,
    crop: null,
  }));
}

function input(partial: Partial<ComposeInput> & Pick<ComposeInput, "sources" | "pages">): ComposeInput {
  return {
    objects: [],
    asset: () => {
      throw new Error("no assets");
    },
    redact: async (bytes, areas) => redact(bytes, areas),
    ...partial,
  };
}

function texts(bytes: Uint8Array): string[] {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const out: string[] = [];
  for (let i = 0; i < doc.countPages(); i++) out.push(doc.loadPage(i).toStructuredText("preserve-whitespace").asText().trim());
  return out;
}

interface StextLine {
  bbox: { x: number; y: number; w: number; h: number };
  text: string;
}

function lines(bytes: Uint8Array, pageIndex: number): StextLine[] {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const json = JSON.parse(doc.loadPage(pageIndex).toStructuredText("preserve-whitespace").asJSON());
  return json.blocks.flatMap((b: { lines?: StextLine[] }) => b.lines ?? []);
}

function textObject(pageId: string, text: string, cx: number, cy: number, rot: number, extra: Partial<TextObject> = {}): TextObject {
  const base = { text, font: "helvetica" as const, bold: false, italic: false, size: 20, lineHeight: 1.2, hScale: 1, ...extra };
  const lay = layoutText(base);
  return {
    id: `t-${text}`,
    pageId,
    kind: "text",
    frame: { cx, cy, w: lay.width, h: lay.height, rot },
    opacity: 1,
    color: "#000000",
    align: "left",
    background: null,
    replaces: null,
    links: null,
    sourceFont: null,
    useSourceFont: false,
    justifyWidth: null,
    ...base,
  };
}

// ------------------------------------------------------------------ tests

describe("composeDocument", () => {
  it("reorders, deletes and rotates pages of a single source", async () => {
    const pages = pageRefs("a", 3);
    pages[0].rotation = 90;
    const out = await composeDocument(input({ sources: { a: await labelled(["P1", "P2", "P3"]) }, pages: [pages[2], pages[0]] }));
    expect(texts(out)).toEqual(["P3", "P1"]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90]);
  });

  it("merges several sources, duplicates and blank pages", async () => {
    const a = pageRefs("a", 2);
    const b = pageRefs("b", 1);
    const blank: PageRef = { id: "blank", sourceId: null, sourceIndex: 0, baseRotation: 0, rotation: 0, view: [0, 0, 300, 400], crop: null };
    const out = await composeDocument(
      input({ sources: { a: await labelled(["A1", "A2"]), b: await labelled(["B1"]) }, pages: [a[0], b[0], blank, a[1], { ...b[0], id: "b-dup" }] }),
    );
    expect(texts(out)).toEqual(["A1", "B1", "", "A2", "B1"]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(2).getSize()).toEqual({ width: 300, height: 400 });
  });

  it("really removes deleted pages even when a link still points to them", async () => {
    const src = await PDFDocument.load(await labelled(["P1", "SECRETO-PAGINA-2", "P3"]));
    const link = src.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 50, 50], Dest: [src.getPage(1).ref, PDFName.of("Fit")] });
    src.getPage(0).node.set(PDFName.of("Annots"), src.context.obj([src.context.register(link)]));
    const pages = pageRefs("a", 3);
    const out = await composeDocument(input({ sources: { a: await src.save() }, pages: [pages[0], pages[2]] }));

    const m = mupdf.Document.openDocument(out, "application/pdf").asPDF()!;
    const hex = Buffer.from("SECRETO").toString("hex");
    for (let n = 1; n < m.countObjects(); n++) {
      const ref = m.newIndirect(n);
      if (!ref.isStream()) continue;
      const content = ref.readStream().asString().toLowerCase();
      expect(content.includes(hex) || content.includes("secreto")).toBe(false);
    }
    expect(texts(out)).toEqual(["P1", "P3"]);
  });

  it("paints text upright and in place on a rotated page", async () => {
    const pages = pageRefs("a", 1, [90]);
    // Display (y down) point (200, 100) on a /Rotate 90 page is user point (100, 200).
    const obj = textObject(pages[0].id, "Hola", 100, 200, 90);
    const out = await composeDocument(input({ sources: { a: await labelled(["P1"], { rotate: [90] }) }, pages, objects: [obj] }));
    const hola = lines(out, 0).find((l) => l.text.includes("Hola"))!;
    expect(hola).toBeDefined();
    // Upright on screen: the line box is wider than tall (MuPDF reports display space).
    expect(hola.bbox.w).toBeGreaterThan(hola.bbox.h);
    // MuPDF rounds bboxes to whole points.
    expect(Math.abs(hola.bbox.x + hola.bbox.w / 2 - 200)).toBeLessThan(2);
    expect(Math.abs(hola.bbox.y + hola.bbox.h / 2 - 100)).toBeLessThan(4);
  });

  it("exports text with a horizontal scale at that share of the width, same height", async () => {
    const pages = pageRefs("a", 1);
    const draw = async (hScale: number) => {
      const obj = textObject(pages[0].id, "Hola mundo", 300, 400, 0, { hScale });
      const out = await composeDocument(input({ sources: { a: await labelled(["P1"]) }, pages, objects: [obj] }));
      return lines(out, 0).find((l) => l.text.includes("Hola"))!;
    };
    const normal = await draw(1);
    const half = await draw(0.5);
    expect(half.bbox.w / normal.bbox.w).toBeGreaterThan(0.45);
    expect(half.bbox.w / normal.bbox.w).toBeLessThan(0.55);
    expect(Math.abs(half.bbox.h - normal.bbox.h)).toBeLessThan(2);
  });

  it("redacts for real and replaces existing text", async () => {
    const pages = pageRefs("a", 1);
    const redactBox: EditorObject = { id: "r", pageId: pages[0].id, kind: "redact", frame: { cx: 100, cy: 708, w: 90, h: 34, rot: 0 }, opacity: 1, color: "#000000" };
    const src = await labelled(["P1"]);
    const out1 = await composeDocument(input({ sources: { a: src }, pages, objects: [redactBox] }));
    expect(texts(out1)[0]).not.toContain("P1");

    const replacement = textObject(pages[0].id, "Nuevo", 100, 708, 0, { replaces: [[55, 695, 100, 722]], background: "#ffffff" });
    const out2 = await composeDocument(input({ sources: { a: src }, pages, objects: [replacement] }));
    expect(texts(out2)[0]).toBe("Nuevo");
  });

  it("refuses to export redactions without a redaction engine", async () => {
    const pages = pageRefs("a", 1);
    const r: EditorObject = { id: "r", pageId: pages[0].id, kind: "redact", frame: { cx: 100, cy: 700, w: 50, h: 20, rot: 0 }, opacity: 1, color: "#000000" };
    await expect(composeDocument({ ...input({ sources: { a: await labelled(["P1"]) }, pages, objects: [r] }), redact: undefined })).rejects.toThrow();
  });

  it("keeps form fields, renames collisions when merging and can flatten", async () => {
    const a = pageRefs("a", 1);
    const b = pageRefs("b", 1);
    const sources = { a: await labelled(["A"], { field: "nombre" }), b: await labelled(["B"], { field: "nombre" }) };
    const merged = await PDFDocument.load(await composeDocument(input({ sources, pages: [a[0], b[0]] })));
    expect(merged.getForm().getFields().map((f) => f.getName()).sort()).toEqual(["nombre", "nombre_2"]);
    expect(merged.getForm().getTextField("nombre").getText()).toBe("valor");

    const flat = await PDFDocument.load(await composeDocument(input({ sources, pages: [a[0]], flattenForms: true })));
    expect(flat.getForm().getFields()).toHaveLength(0);
  });

  it("duplicates a page of the base file, form fields included", async () => {
    const a = pageRefs("a", 2);
    const src = await labelled(["A1", "A2"], { field: "nombre" });
    const out = await composeDocument(input({ sources: { a: src }, pages: [a[0], { ...a[0], id: "dup" }, a[1]] }));
    expect(texts(out)).toEqual(["A1", "A1", "A2"]);
    const doc = await PDFDocument.load(out);
    expect(doc.getForm().getFields()).toHaveLength(2);
  });

  it("drops form fields that lived on deleted pages", async () => {
    const pages = pageRefs("a", 2);
    const src = await labelled(["A", "B"], { field: "solo_en_pagina_1" });
    const out = await PDFDocument.load(await composeDocument(input({ sources: { a: src }, pages: [pages[1]] })));
    expect(out.getForm().getFields()).toHaveLength(0);
  });

  it("embeds images and shapes", async () => {
    const pages = pageRefs("a", 1);
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 8, 8], false);
    pix.clear(128);
    const png = pix.asPNG().slice();
    const objects: EditorObject[] = [
      { id: "i", pageId: pages[0].id, kind: "image", frame: { cx: 300, cy: 300, w: 100, h: 100, rot: 30 }, opacity: 0.8, assetId: "x", signature: false },
      { id: "e", pageId: pages[0].id, kind: "ellipse", frame: { cx: 300, cy: 500, w: 80, h: 40, rot: 0 }, opacity: 1, stroke: "#ff0000", fill: null, strokeWidth: 2 },
      { id: "l", pageId: pages[0].id, kind: "arrow", frame: { cx: 300, cy: 600, w: 120, h: 4, rot: 45 }, opacity: 1, stroke: "#0000ff", strokeWidth: 2, dashed: false },
      { id: "k", pageId: pages[0].id, kind: "ink", frame: { cx: 200, cy: 200, w: 50, h: 50, rot: 0 }, opacity: 1, strokes: [[0, 0, 0.5, 0.5, 1, 0]], color: "#000000", strokeWidth: 2 },
      { id: "s", pageId: pages[0].id, kind: "symbol", frame: { cx: 400, cy: 400, w: 16, h: 16, rot: 0 }, opacity: 1, symbol: "check", color: "#000000" },
      { id: "h", pageId: pages[0].id, kind: "highlight", frame: { cx: 100, cy: 708, w: 60, h: 24, rot: 0 }, opacity: 0.4, color: "#ffff00" },
    ];
    const out = await composeDocument(input({ sources: { a: await labelled(["P1"]) }, pages, objects, asset: () => ({ bytes: png, mime: "image/png" }) }));
    const m = mupdf.Document.openDocument(out, "application/pdf");
    const json = JSON.parse(m.loadPage(0).toStructuredText("preserve-images").asJSON());
    expect(json.blocks.some((b: { type: string }) => b.type === "image")).toBe(true);
    expect(texts(out)[0]).toBe("P1");
  });
});

describe("composeDocument metadata settings", () => {
  async function withInfo(author?: string): Promise<Uint8Array> {
    const doc = await PDFDocument.load(await labelled(["A"]), { updateMetadata: false });
    doc.setTitle("Informe");
    if (author) doc.setAuthor(author);
    return doc.save();
  }

  it("adds the author only when the document has none", async () => {
    const pages = pageRefs("a", 1);
    const filled = await PDFDocument.load(await composeDocument(input({ sources: { a: await withInfo() }, pages, author: "Ana" })));
    expect(filled.getAuthor()).toBe("Ana");
    const kept = await PDFDocument.load(await composeDocument(input({ sources: { a: await withInfo("Luis") }, pages, author: "Ana" })));
    expect(kept.getAuthor()).toBe("Luis");
  });

  it("strips the document properties", async () => {
    const pages = pageRefs("a", 1);
    const out = await PDFDocument.load(await composeDocument(input({ sources: { a: await withInfo("Luis") }, pages, author: "Ana", stripMetadata: true })), { updateMetadata: false });
    expect(out.getTitle()).toBeUndefined();
    expect(out.getAuthor()).toBeUndefined();
    expect(out.catalog.has(PDFName.of("Metadata"))).toBe(false);
  });
});
