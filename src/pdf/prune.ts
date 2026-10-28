import { PDFArray, PDFDict, PDFRef, PDFStream, type PDFDocument, type PDFObject } from "@cantoo/pdf-lib";

/**
 * pdf-lib writes every object it knows about, even unreferenced ones (deleted pages, replaced
 * page trees...). Remove what can't be reached from the trailer. Returns the number removed.
 *
 * `exclude`: references that must disappear even if something still points to them (e.g.
 * deleted pages referenced by bookmarks or links). Per the PDF spec, a reference to a missing
 * object is treated as null, so those dangling references are harmless.
 *
 * Call after `await doc.flush()` so pending embeds already exist.
 */
export function pruneUnreachable(doc: PDFDocument, exclude: ReadonlySet<PDFRef> = new Set()): number {
  const ctx = doc.context;
  const reachable = new Set<PDFRef>();
  const { Root, Info, Encrypt, ID } = ctx.trailerInfo;
  const stack: PDFObject[] = [Root, Info, Encrypt, ID].filter((o): o is PDFObject => !!o);

  while (stack.length) {
    const obj = stack.pop()!;
    if (obj instanceof PDFRef) {
      if (reachable.has(obj) || exclude.has(obj)) continue;
      reachable.add(obj);
      const target = ctx.lookup(obj);
      if (target) stack.push(target);
    } else if (obj instanceof PDFDict) {
      for (const [, value] of obj.entries()) stack.push(value);
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) stack.push(obj.get(i));
    } else if (obj instanceof PDFStream) {
      stack.push(obj.dict);
    }
  }

  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!reachable.has(ref)) {
      ctx.delete(ref);
      removed++;
    }
  }
  return removed;
}
