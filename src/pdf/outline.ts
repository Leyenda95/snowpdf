import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from "@cantoo/pdf-lib";
import { t } from "@/i18n";

/** One bookmark. `pageIndex` is 0-based; `children` are nested one level down. */
export interface OutlineItem {
  title: string;
  pageIndex: number;
  children?: OutlineItem[];
}

const OUTLINES = PDFName.of("Outlines");
const FIRST = PDFName.of("First");
const LAST = PDFName.of("Last");
const NEXT = PDFName.of("Next");
const PREV = PDFName.of("Prev");
const PARENT = PDFName.of("Parent");
const COUNT = PDFName.of("Count");
const TITLE = PDFName.of("Title");
const DEST = PDFName.of("Dest");

/** Longest nesting we are willing to read or write. */
const MAX_DEPTH = 32;

// Tolerant readers: files in the wild put the wrong type in almost any entry, and pdf-lib's typed
// lookups throw when they do.
function asDict(ctx: PDFContext, obj: PDFObject | undefined): PDFDict | undefined {
  const value = ctx.lookup(obj);
  return value instanceof PDFDict ? value : undefined;
}

function textOf(ctx: PDFContext, obj: PDFObject | undefined): string | undefined {
  const value = ctx.lookup(obj);
  if (!(value instanceof PDFString || value instanceof PDFHexString)) return undefined;
  try {
    return value.decodeText();
  } catch {
    return undefined;
  }
}

/** Delete the objects of the current outline tree (best effort, guarded against cycles). */
function discardOutline(doc: PDFDocument): void {
  const ctx = doc.context;
  const root = doc.catalog.get(OUTLINES);
  doc.catalog.delete(OUTLINES);

  const doomed = new Set<PDFRef>();
  if (root instanceof PDFRef) doomed.add(root);
  const rootDict = asDict(ctx, root);
  const stack: PDFRef[] = [];
  const first = rootDict?.get(FIRST);
  if (first instanceof PDFRef) stack.push(first);
  while (stack.length > 0) {
    const ref = stack.pop()!;
    if (doomed.has(ref)) continue;
    doomed.add(ref);
    const item = asDict(ctx, ref);
    if (!item) continue;
    const child = item.get(FIRST);
    const sibling = item.get(NEXT);
    if (child instanceof PDFRef) stack.push(child);
    if (sibling instanceof PDFRef) stack.push(sibling);
  }
  for (const ref of doomed) ctx.delete(ref);
}

function checkItems(items: OutlineItem[], pageCount: number, depth = 0): void {
  if (depth >= MAX_DEPTH) throw new RangeError(t("Los marcadores están anidados a demasiada profundidad."));
  for (const item of items) {
    if (!Number.isInteger(item.pageIndex) || item.pageIndex < 0 || item.pageIndex >= pageCount) {
      throw new RangeError(
        t('El marcador "{title}" apunta a la página {n}, que no existe (el documento tiene {total}).', { title: item.title, n: item.pageIndex + 1, total: pageCount }),
      );
    }
    if (item.children) checkItems(item.children, pageCount, depth + 1);
  }
}

interface Level {
  first: PDFRef;
  last: PDFRef;
  /** Number of items in this level and all levels below (every item is open). */
  count: number;
}

function buildLevel(ctx: PDFContext, pages: PDFPage[], items: OutlineItem[], parent: PDFRef): Level {
  const refs = items.map(() => ctx.nextRef());
  let count = 0;
  items.forEach((item, i) => {
    const dict = ctx.obj({});
    dict.set(TITLE, PDFHexString.fromText(item.title));
    dict.set(PARENT, parent);
    if (i > 0) dict.set(PREV, refs[i - 1]);
    if (i < items.length - 1) dict.set(NEXT, refs[i + 1]);
    dict.set(DEST, ctx.obj([pages[item.pageIndex].ref, PDFName.of("Fit")]));
    count += 1;
    if (item.children && item.children.length > 0) {
      const sub = buildLevel(ctx, pages, item.children, refs[i]);
      dict.set(FIRST, sub.first);
      dict.set(LAST, sub.last);
      dict.set(COUNT, PDFNumber.of(sub.count));
      count += sub.count;
    }
    ctx.assign(refs[i], dict);
  });
  return { first: refs[0], last: refs[refs.length - 1], count };
}

/**
 * Replace the document outline (bookmarks) with `items`. Every entry jumps to the top of its
 * page (/Fit) and the whole tree is shown expanded. An empty list removes the outline.
 *
 * @throws RangeError (Spanish message) when an item points to a page that does not exist; the
 * document is left untouched in that case.
 */
export function setOutline(doc: PDFDocument, items: OutlineItem[]): void {
  const pages = doc.getPages();
  checkItems(items, pages.length);
  discardOutline(doc);
  if (items.length === 0) return;

  const ctx = doc.context;
  const rootRef = ctx.nextRef();
  const level = buildLevel(ctx, pages, items, rootRef);
  const root = ctx.obj({});
  root.set(PDFName.of("Type"), OUTLINES);
  root.set(FIRST, level.first);
  root.set(LAST, level.last);
  root.set(COUNT, PDFNumber.of(level.count));
  ctx.assign(rootRef, root);
  doc.catalog.set(OUTLINES, rootRef);
}

/** Read the outline tree back (page destinations as 0-based indices, -1 when unresolvable). */
export function getOutline(doc: PDFDocument): OutlineItem[] {
  const ctx = doc.context;
  const pageIndexByRef = new Map<PDFRef, number>();
  doc.getPages().forEach((page, index) => pageIndexByRef.set(page.ref, index));

  const readLevel = (firstRef: unknown, depth: number): OutlineItem[] => {
    const out: OutlineItem[] = [];
    const seen = new Set<PDFRef>();
    let ref = firstRef;
    while (ref instanceof PDFRef && !seen.has(ref) && depth < MAX_DEPTH) {
      seen.add(ref);
      const dict = asDict(ctx, ref);
      if (!dict) break;
      const title = textOf(ctx, dict.get(TITLE)) ?? "";
      const dest = ctx.lookup(dict.get(DEST));
      const target = dest instanceof PDFArray ? dest.get(0) : undefined;
      const pageIndex = target instanceof PDFRef ? (pageIndexByRef.get(target) ?? -1) : -1;
      const item: OutlineItem = { title, pageIndex };
      const children = readLevel(dict.get(FIRST), depth + 1);
      if (children.length > 0) item.children = children;
      out.push(item);
      ref = dict.get(NEXT);
    }
    return out;
  };

  const root = asDict(ctx, doc.catalog.get(OUTLINES));
  return root ? readLevel(root.get(FIRST), 0) : [];
}
