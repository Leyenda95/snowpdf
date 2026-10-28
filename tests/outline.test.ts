import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef } from "@cantoo/pdf-lib";
import { getOutline, setOutline, type OutlineItem } from "@/pdf/outline";
import { loadPdf, savePdf } from "@/pdf/docUtils";
import { makePdf, openPdf, outlineOf } from "./helpers";

const N = (name: string) => PDFName.of(name);

async function withOutline(items: OutlineItem[], pages = 5): Promise<Uint8Array> {
  const doc = await loadPdf(await makePdf({ pages }));
  setOutline(doc, items);
  return savePdf(doc);
}

describe("setOutline", () => {
  it("writes bookmarks that other PDF software reads and follows", async () => {
    const out = await withOutline([
      { title: "Portada", pageIndex: 0 },
      { title: "Capítulo 1", pageIndex: 2 },
      { title: "Anexo", pageIndex: 4 },
    ]);
    expect(outlineOf(out)).toEqual([
      { title: "Portada", page: 0 },
      { title: "Capítulo 1", page: 2 },
      { title: "Anexo", page: 4 },
    ]);
  });

  it("nests children and keeps non-Latin titles intact", async () => {
    const out = await withOutline([
      {
        title: "Índice – ¡Ñandú!",
        pageIndex: 0,
        children: [
          { title: "日本語", pageIndex: 1, children: [{ title: "Привет 🙂", pageIndex: 2 }] },
          { title: "Segundo", pageIndex: 3 },
        ],
      },
      { title: "Fin", pageIndex: 4 },
    ]);
    expect(outlineOf(out)).toEqual([
      {
        title: "Índice – ¡Ñandú!",
        page: 0,
        children: [
          { title: "日本語", page: 1, children: [{ title: "Привет 🙂", page: 2 }] },
          { title: "Segundo", page: 3 },
        ],
      },
      { title: "Fin", page: 4 },
    ]);
  });

  it("builds a consistent linked tree (/First /Last /Next /Prev /Parent /Count /Dest)", async () => {
    const out = await withOutline([
      { title: "A", pageIndex: 0, children: [{ title: "A1", pageIndex: 1 }, { title: "A2", pageIndex: 2 }] },
      { title: "B", pageIndex: 3 },
    ]);
    const doc = await openPdf(out);
    const ctx = doc.context;
    const root = doc.catalog.lookup(N("Outlines"), PDFDict);
    expect(root.lookup(N("Type"))).toBe(N("Outlines"));
    expect(root.lookup(N("Count"), PDFNumber).asNumber()).toBe(4); // A, A1, A2, B (everything open)

    const firstRef = root.get(N("First")) as PDFRef;
    const lastRef = root.get(N("Last")) as PDFRef;
    const a = ctx.lookup(firstRef, PDFDict);
    const b = ctx.lookup(lastRef, PDFDict);
    expect(a.get(N("Next"))).toBe(lastRef);
    expect(b.get(N("Prev"))).toBe(firstRef);
    expect(a.has(N("Prev"))).toBe(false);
    expect(b.has(N("Next"))).toBe(false);
    expect(a.get(N("Parent"))).toBe(ctx.getObjectRef(root));
    expect(a.lookup(N("Count"), PDFNumber).asNumber()).toBe(2);
    expect(b.has(N("Count"))).toBe(false);

    const a1Ref = a.get(N("First")) as PDFRef;
    const a2Ref = a.get(N("Last")) as PDFRef;
    expect(ctx.lookup(a1Ref, PDFDict).get(N("Next"))).toBe(a2Ref);
    expect(ctx.lookup(a2Ref, PDFDict).get(N("Prev"))).toBe(a1Ref);
    expect(ctx.lookup(a1Ref, PDFDict).get(N("Parent"))).toBe(firstRef);

    // destinations: [page /Fit]
    const dest = b.lookup(N("Dest"), PDFArray).toString();
    expect(dest).toBe(`[ ${doc.getPage(3).ref.toString()} /Fit ]`);
  });

  it("reads back with getOutline", async () => {
    const items: OutlineItem[] = [
      { title: "Uno", pageIndex: 0, children: [{ title: "Uno.uno", pageIndex: 1 }] },
      { title: "Dos", pageIndex: 2 },
    ];
    const doc = await openPdf(await withOutline(items));
    expect(getOutline(doc)).toEqual(items);
    expect(getOutline(await openPdf(await makePdf()))).toEqual([]);
  });

  it("replaces the previous outline and leaves none of its objects behind", async () => {
    const first = await withOutline([
      { title: "Viejo 1", pageIndex: 0, children: [{ title: "Viejo 1.1", pageIndex: 1 }] },
      { title: "Viejo 2", pageIndex: 2 },
    ]);
    const doc = await loadPdf(first);
    setOutline(doc, [{ title: "Nuevo", pageIndex: 3 }]);
    const titled = doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.has(N("Title")));
    expect(titled).toHaveLength(1);
    const out = await savePdf(doc);
    expect(outlineOf(out)).toEqual([{ title: "Nuevo", page: 3 }]);
  });

  it("removes the outline when given no items", async () => {
    const doc = await loadPdf(await withOutline([{ title: "X", pageIndex: 0 }]));
    setOutline(doc, []);
    expect(doc.catalog.has(N("Outlines"))).toBe(false);
    expect(outlineOf(await savePdf(doc))).toEqual([]);
  });

  it("rejects a bookmark to a page that does not exist, leaving the document untouched", async () => {
    const doc = await loadPdf(await withOutline([{ title: "Bueno", pageIndex: 1 }], 3));
    expect(() => setOutline(doc, [{ title: "Roto", pageIndex: 3 }])).toThrow(RangeError);
    expect(() => setOutline(doc, [{ title: "Roto", pageIndex: 3 }])).toThrow(
      'El marcador "Roto" apunta a la página 4, que no existe (el documento tiene 3).',
    );
    expect(() => setOutline(doc, [{ title: "Hijo", pageIndex: 0, children: [{ title: "Malo", pageIndex: -1 }] }])).toThrow(RangeError);
    expect(getOutline(doc)).toEqual([{ title: "Bueno", pageIndex: 1 }]);
  });

  it("keeps the outline through a second load/save cycle", async () => {
    const once = await withOutline([{ title: "Persistente", pageIndex: 2 }]);
    const twice = await savePdf(await loadPdf(once));
    expect(outlineOf(twice)).toEqual([{ title: "Persistente", page: 2 }]);
  });
});
