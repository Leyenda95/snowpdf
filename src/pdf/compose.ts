import { PDFArray, PDFDict, PDFName, PDFNumber, PDFPageTree, PDFRef, degrees, type PDFDocument, type PDFPage } from "@cantoo/pdf-lib";
import { displayRotation, type EditorObject, type PageRef, type PdfBox } from "@/model/types";
import { copyPagesWithFields } from "./acroform";
import { Baker, type BakeAsset, type BakeFont } from "./bake";
import { createPdf, loadPdf, savePdf } from "./docUtils";
import { frameBBox } from "./objectGeometry";
import { pruneUnreachable } from "./prune";
import { linkBoxes, normalizeBox, sameBox } from "./textLinks";
import type { RedactionArea } from "./mupdf/ops";
import { t } from "@/i18n";

/**
 * Builds the final PDF from the workspace: page list (order, rotation, crop, blank pages,
 * pages from other files), real redactions, and the editor objects painted into the content.
 * Runs in the browser and in Node (tests): the MuPDF redaction step is injected.
 */

export interface ComposeInput {
  /** Bytes per source id (with form values already written, see pdf.js saveDocument). */
  sources: Record<string, Uint8Array>;
  pages: PageRef[];
  objects: EditorObject[];
  asset(id: string): BakeAsset;
  /** Document fonts reused by edited text (null or missing = draw it with its fallback font). */
  font?(id: string): BakeFont | null;
  flattenForms?: boolean;
  title?: string;
  /** Written as /Author only when the document has none. */
  author?: string;
  /** Drop the document properties: every Info entry and the catalog's XMP packet. */
  stripMetadata?: boolean;
  /** Real content removal (MuPDF). Required when there are redactions or replaced text. */
  redact?(bytes: Uint8Array, areas: RedactionArea[]): Promise<Uint8Array>;
}

const INHERITABLE = ["Resources", "MediaBox", "CropBox", "Rotate"].map((k) => PDFName.of(k));

/** Copy inherited attributes into the page so it can be moved to a new page tree. */
function materializeInherited(page: PDFPage): void {
  for (const name of INHERITABLE) {
    if (page.node.has(name)) continue;
    const value = page.node.getInheritableAttribute(name);
    if (value) page.node.set(name, value);
  }
}

/** Replace the page tree with a flat one holding exactly `pages`, in order. */
function rebuildPageTree(doc: PDFDocument, pages: PDFPage[]): void {
  pages.forEach(materializeInherited);
  const tree = PDFPageTree.withContext(doc.context);
  const treeRef = doc.context.register(tree);
  for (const page of pages) {
    page.node.setParent(treeRef);
    tree.pushLeafNode(page.ref);
  }
  doc.catalog.set(PDFName.of("Pages"), treeRef);
  (doc as unknown as { pageCache: { invalidate(): void } }).pageCache.invalidate();
}

/** Remove form fields whose widgets all lived on pages that are no longer in the document. */
/** Typed lookup that returns undefined (instead of throwing) when the entry has another type. */
function lookupAs<T>(dict: PDFDict | undefined, key: string, type: { prototype: T }): T | undefined {
  const v = dict ? dict.context.lookup(dict.get(PDFName.of(key))) : undefined;
  return v instanceof (type as unknown as typeof PDFDict) ? (v as T) : undefined;
}

function dropOrphanFields(doc: PDFDocument, pages: PDFPage[]): void {
  const fields = lookupAs(lookupAs(doc.catalog, "AcroForm", PDFDict), "Fields", PDFArray);
  if (!fields) return;
  const liveWidgets = new Set<PDFRef>();
  for (const page of pages) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      if (ref instanceof PDFRef) liveWidgets.add(ref);
    }
  }
  // Returns true when the field (or one of its descendants) still has a widget on a live page.
  const prune = (ref: PDFRef): boolean => {
    const dict = doc.context.lookup(ref);
    if (!(dict instanceof PDFDict)) return false;
    const kids = lookupAs(dict, "Kids", PDFArray);
    if (!kids) return liveWidgets.has(ref);
    for (let i = kids.size() - 1; i >= 0; i--) {
      const kid = kids.get(i);
      if (!(kid instanceof PDFRef) || !prune(kid)) kids.remove(i);
    }
    return kids.size() > 0;
  };
  for (let i = fields.size() - 1; i >= 0; i--) {
    const f = fields.get(i);
    if (!(f instanceof PDFRef) || !prune(f)) fields.remove(i);
  }
}

function hasAuthor(doc: PDFDocument): boolean {
  try {
    return !!doc.getAuthor()?.trim();
  } catch {
    // An Author entry we cannot read is still the document's: leave it alone.
    return true;
  }
}

/**
 * Refit the Link annotations of `page` whose /Rect is the original rectangle of one of `links`
 * onto that link's new box (hit area included); a link whose text was removed is dropped.
 */
function moveLinks(page: PDFPage, links: { rect: PdfBox; box: PdfBox | null }[]): void {
  const annots = page.node.Annots();
  if (!annots) return;
  const drop: number[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const annot = annots.lookupMaybe(i, PDFDict);
    if (!annot || annot.lookupMaybe(PDFName.of("Subtype"), PDFName) !== PDFName.of("Link")) continue;
    const rect = annot.lookupMaybe(PDFName.of("Rect"), PDFArray);
    if (!rect || rect.size() < 4) continue;
    const nums = [0, 1, 2, 3].map((k) => rect.lookupMaybe(k, PDFNumber)?.asNumber() ?? NaN);
    if (nums.some(Number.isNaN)) continue;
    const box = normalizeBox(nums);
    const hit = links.find((l) => sameBox(normalizeBox(l.rect), box));
    if (!hit) continue;
    if (!hit.box) {
      drop.push(i);
      continue;
    }
    annot.set(PDFName.of("Rect"), page.doc.context.obj(hit.box));
    // Viewers hit-test /QuadPoints before /Rect: the old ones would keep the old area.
    annot.delete(PDFName.of("QuadPoints"));
  }
  for (const i of drop.reverse()) annots.remove(i);
}

export async function composeDocument(input: ComposeInput): Promise<Uint8Array> {
  const { pages, objects } = input;
  if (pages.length === 0) throw new Error(t("El documento no tiene páginas."));

  const baseId = pages.find((p) => p.sourceId !== null)?.sourceId ?? null;
  let doc = baseId ? await loadPdf(input.sources[baseId]) : await createPdf();
  const loaded = new Map<string, PDFDocument>(baseId ? [[baseId, doc]] : []);
  const sourceDoc = async (id: string): Promise<PDFDocument> => {
    let d = loaded.get(id);
    if (!d) {
      const bytes = input.sources[id];
      if (!bytes) throw new Error(t("Falta el archivo de origen {id}", { id }));
      d = await loadPdf(bytes);
      loaded.set(id, d);
    }
    return d;
  };

  // 1. Resolve a PDFPage for every slot. Pages of the base file are reused in place (keeps
  //    forms, links, annotations); other files' pages are copied once, duplicates copied again.
  const originals = doc.getPages();
  const out: PDFPage[] = new Array(pages.length);
  const usedBase = new Set<number>();
  // Everything else is copied, one form-aware batch per source (repeats become independent
  // copies; no orphan copies of other pages are dragged in through widgets or links).
  const batches = new Map<string, { indices: number[]; slots: number[] }>();
  pages.forEach((ref, slot) => {
    if (ref.sourceId === null) return;
    if (ref.sourceId === baseId && !usedBase.has(ref.sourceIndex)) {
      usedBase.add(ref.sourceIndex);
      out[slot] = originals[ref.sourceIndex];
      return;
    }
    const batch = batches.get(ref.sourceId) ?? { indices: [], slots: [] };
    batch.indices.push(ref.sourceIndex);
    batch.slots.push(slot);
    batches.set(ref.sourceId, batch);
  });
  for (const [id, batch] of batches) {
    const copies = await copyPagesWithFields(doc, await sourceDoc(id), batch.indices);
    copies.forEach((p, k) => (out[batch.slots[k]] = p));
  }
  pages.forEach((ref, slot) => {
    if (ref.sourceId !== null) return;
    const [x0, y0, x1, y1] = ref.view;
    out[slot] = doc.addPage([x1 - x0, y1 - y0]);
  });

  const removed = new Set<PDFRef>(originals.filter((_, i) => !usedBase.has(i)).map((p) => p.ref));
  rebuildPageTree(doc, out);
  if (removed.size) dropOrphanFields(doc, out);

  // 2. Rotation and crop.
  pages.forEach((ref, i) => {
    out[i].setRotation(degrees(displayRotation(ref)));
    if (ref.crop) {
      const [x0, y0, x1, y1] = ref.crop;
      out[i].setCropBox(x0, y0, x1 - x0, y1 - y0);
    }
  });

  // 3. Real redaction (and removal of text replaced by "edit text") before painting anything.
  const byPage = new Map<string, EditorObject[]>();
  for (const o of objects) byPage.set(o.pageId, [...(byPage.get(o.pageId) ?? []), o]);
  const areas: RedactionArea[] = [];
  pages.forEach((ref, pageIndex) => {
    for (const o of byPage.get(ref.id) ?? []) {
      if (o.kind === "redact") areas.push({ pageIndex, box: frameBBox(o.frame), mode: "redact" });
      // The method was chosen by the analysis done while editing; export never analyses.
      else if (o.kind === "erase") {
        const mode = o.method === "text" ? "replace" : o.method === "vector" ? "erase-vector" : o.method === "pixels" ? "erase-pixels" : null;
        if (mode) areas.push({ pageIndex, box: frameBBox(o.frame), mode });
      }
      else if (o.kind === "text" && o.replaces) for (const box of o.replaces) areas.push({ pageIndex, box, mode: "replace" });
    }
  });
  let targets = out;
  if (areas.length) {
    if (!input.redact) throw new Error(t("No se puede aplicar la redacción: motor no disponible."));
    await doc.flush();
    pruneUnreachable(doc, removed);
    const redacted = await input.redact(await doc.save({ useObjectStreams: false }), areas);
    doc = await loadPdf(redacted);
    targets = doc.getPages();
    removed.clear();
  }

  // 3b. Links of edited text follow the new text.
  for (let i = 0; i < pages.length; i++) {
    for (const o of byPage.get(pages[i].id) ?? []) if (o.kind === "text" && o.links?.length) moveLinks(targets[i], linkBoxes(o));
  }

  // 4. Paint the editor objects.
  const baker = new Baker(doc, input.asset, input.font);
  for (let i = 0; i < pages.length; i++) {
    for (const o of byPage.get(pages[i].id) ?? []) await baker.draw(targets[i], o);
  }

  // 5. Finishing.
  if (input.flattenForms && doc.catalog.has(PDFName.of("AcroForm"))) {
    doc.getForm().flatten({ updateFieldAppearances: false });
  }
  if (input.stripMetadata) {
    const info = doc.context.lookup(doc.context.trailerInfo.Info);
    if (info instanceof PDFDict) for (const key of info.keys()) info.delete(key);
    doc.catalog.delete(PDFName.of("Metadata"));
  }
  if (input.title) doc.setTitle(input.title);
  const author = input.author?.trim();
  if (author && !input.stripMetadata && !hasAuthor(doc)) doc.setAuthor(author);
  await doc.flush();
  pruneUnreachable(doc, removed);
  return savePdf(doc);
}
