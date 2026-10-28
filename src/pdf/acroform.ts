import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFObjectCopier,
  PDFPage,
  PDFRef,
  PDFString,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
} from "@cantoo/pdf-lib";
import { t } from "@/i18n";

/**
 * AcroForm support for page copying.
 *
 * `PDFDocument.copyPages` copies the widget annotations of a page (the visible boxes) but not
 * the form itself: the destination document has no /AcroForm /Fields entries for them, so
 * viewers show dead boxes. `registerCopiedFields` rebuilds that link. `copyPagesWithFields`
 * is a stricter replacement for `copyPages` that also avoids pdf-lib's habit of dragging
 * whole orphan copies of other pages into the output through /P and /Dest references.
 */

const ACRO_FORM = PDFName.of("AcroForm");
const ANNOTS = PDFName.of("Annots");
const KIDS = PDFName.of("Kids");
const PARENT = PDFName.of("Parent");
const SUBTYPE = PDFName.of("Subtype");
const WIDGET = PDFName.of("Widget");
const LINK = PDFName.of("Link");
const FT = PDFName.of("FT");
const T = PDFName.of("T");
const DA = PDFName.of("DA");
const Q = PDFName.of("Q");
const DR = PDFName.of("DR");
const FONT = PDFName.of("Font");
const BASE_FONT = PDFName.of("BaseFont");
const NEED_APPEARANCES = PDFName.of("NeedAppearances");
const PAGE = PDFName.of("P");
const DEST = PDFName.of("Dest");
const ACTION = PDFName.of("A");
const ACTION_TYPE = PDFName.of("S");
const GOTO = PDFName.of("GoTo");
const DEST_ARRAY = PDFName.of("D");

/** Longest /Parent chain followed when looking for the root of a field. */
const MAX_FIELD_DEPTH = 64;

interface Entry {
  ref: PDFRef;
  dict: PDFDict;
}

// ---------------------------------------------------------------------------------------------
// Tolerant readers. Files in the wild put the wrong type in almost any entry; pdf-lib's own
// typed lookups throw in that case, these answer "not there" instead.

function asDict(ctx: PDFContext, obj: PDFObject | undefined): PDFDict | undefined {
  const value = ctx.lookup(obj);
  return value instanceof PDFDict ? value : undefined;
}

function asArray(ctx: PDFContext, obj: PDFObject | undefined): PDFArray | undefined {
  const value = ctx.lookup(obj);
  return value instanceof PDFArray ? value : undefined;
}

/** Text string (name of a field...), decoded. */
function asText(ctx: PDFContext, obj: PDFObject | undefined): string | undefined {
  const value = ctx.lookup(obj);
  if (!(value instanceof PDFString || value instanceof PDFHexString)) return undefined;
  try {
    return value.decodeText();
  } catch {
    return undefined;
  }
}

/** Byte string such as a /DA, left as written (escape sequences included). */
function asRawString(ctx: PDFContext, obj: PDFObject | undefined): string | undefined {
  const value = ctx.lookup(obj);
  if (value instanceof PDFString) return value.asString();
  return value instanceof PDFHexString ? asText(ctx, value) : undefined;
}

function asNumber(ctx: PDFContext, obj: PDFObject | undefined): number | undefined {
  const value = ctx.lookup(obj);
  return value instanceof PDFNumber ? value.asNumber() : undefined;
}

/** Is the entry the name `name` (following a reference if it is one)? */
function isName(ctx: PDFContext, obj: PDFObject | undefined, name: PDFName): boolean {
  return ctx.lookup(obj) === name;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** /Annots of a page, when it is a proper array. */
function annotsOf(page: PDFPage): PDFArray | undefined {
  return asArray(page.doc.context, page.node.get(ANNOTS));
}

/**
 * Widget annotations of a page, with their references. Direct (non-indirect) widgets are made
 * indirect when `register` is true, because a field needs a reference to be listed in /Fields.
 */
function widgetsOf(page: PDFPage, register: boolean): Entry[] {
  const ctx = page.doc.context;
  const annots = annotsOf(page);
  const out: Entry[] = [];
  if (!annots) return out;
  for (let i = 0; i < annots.size(); i++) {
    const raw = annots.get(i);
    const dict = asDict(ctx, raw);
    if (!dict || !isName(ctx, dict.get(SUBTYPE), WIDGET)) continue;
    if (raw instanceof PDFRef) {
      out.push({ ref: raw, dict });
    } else if (register) {
      const ref = ctx.register(dict);
      annots.set(i, ref);
      out.push({ ref, dict });
    }
  }
  return out;
}

/**
 * Topmost field of a widget: follows /Parent up to the node without a parent. Returns
 * undefined when nothing in the chain declares a field type (/FT), i.e. when the widget is
 * not part of a form.
 */
function findRoot(ctx: PDFContext, widget: Entry): Entry | undefined {
  let current = widget;
  let hasFieldType = widget.dict.has(FT);
  const seen = new Set<PDFRef>([widget.ref]);
  for (let depth = 0; depth < MAX_FIELD_DEPTH; depth++) {
    const parentRef = current.dict.get(PARENT);
    if (!(parentRef instanceof PDFRef) || seen.has(parentRef)) break;
    const parent = asDict(ctx, parentRef);
    if (!parent) break;
    seen.add(parentRef);
    current = { ref: parentRef, dict: parent };
    if (parent.has(FT)) hasFieldType = true;
  }
  return hasFieldType ? current : undefined;
}

/** Visit every dictionary of a field tree (the node itself and, recursively, its /Kids). */
function walkFieldTree(ctx: PDFContext, node: PDFDict, visit: (dict: PDFDict) => void, seen = new Set<PDFDict>()): void {
  if (seen.has(node)) return;
  seen.add(node);
  visit(node);
  const kids = asArray(ctx, node.get(KIDS));
  if (!kids) return;
  for (let i = 0; i < kids.size(); i++) {
    const kid = asDict(ctx, kids.get(i));
    if (kid) walkFieldTree(ctx, kid, visit, seen);
  }
}

/**
 * Drop everything below `node` that does not belong to the copied pages: widgets that live on
 * pages which were not copied (and the null placeholders `copyPagesWithFields` leaves for
 * them), and intermediate fields left without kids. Returns whether `node` still holds anything.
 */
function pruneKids(ctx: PDFContext, node: PDFDict, ref: PDFRef | undefined, keep: Set<PDFRef>, seen: Set<PDFDict>): boolean {
  if (seen.has(node)) return false;
  seen.add(node);
  const kids = asArray(ctx, node.get(KIDS));
  if (!kids) {
    // Terminal node: a widget survives only if it sits on a copied page. A terminal field that
    // has no widget at all (hidden data field) is kept.
    return !isName(ctx, node.get(SUBTYPE), WIDGET) || (ref !== undefined && keep.has(ref));
  }
  for (let i = kids.size() - 1; i >= 0; i--) {
    const raw = kids.get(i);
    const kid = asDict(ctx, raw);
    const alive = kid !== undefined && pruneKids(ctx, kid, raw instanceof PDFRef ? raw : undefined, keep, seen);
    if (!alive) kids.remove(i);
  }
  return kids.size() > 0;
}

// ---------------------------------------------------------------------------------------------
// /AcroForm defaults: /DR fonts, /DA, /Q, /NeedAppearances

function dictEntry(ctx: PDFContext, parent: PDFDict, key: PDFName): PDFDict {
  const existing = asDict(ctx, parent.get(key));
  if (existing) return existing;
  const created = ctx.obj({});
  parent.set(key, created);
  return created;
}

function nameText(obj: PDFObject | undefined): string | undefined {
  return obj instanceof PDFName ? obj.decodeText() : undefined;
}

/** Two font dictionaries describe the same font when subtype and BaseFont agree. */
function sameFont(a: PDFDict, b: PDFDict): boolean {
  const baseA = nameText(a.get(BASE_FONT));
  return baseA !== undefined && baseA === nameText(b.get(BASE_FONT)) && nameText(a.get(SUBTYPE)) === nameText(b.get(SUBTYPE));
}

/**
 * Merge the source /DR /Font resources into the destination form. When the destination already
 * has a *different* font under the same resource name, the source font is stored under a fresh
 * name and the returned map says how to rename it in /DA strings.
 */
function mergeDefaultFonts(
  srcAcro: PDFDict,
  dstAcro: PDFDict,
  srcCtx: PDFContext,
  dstCtx: PDFContext,
  copier: PDFObjectCopier,
): Map<string, string> {
  const renames = new Map<string, string>();
  const srcFonts = asDict(srcCtx, asDict(srcCtx, srcAcro.get(DR))?.get(FONT));
  if (!srcFonts) return renames;

  const dstFonts = dictEntry(dstCtx, dictEntry(dstCtx, dstAcro, DR), FONT);
  const taken = new Set<string>([...dstFonts.keys(), ...srcFonts.keys()].map((k) => k.decodeText()));
  for (const [key, value] of srcFonts.entries()) {
    const existing = asDict(dstCtx, dstFonts.get(key));
    if (!existing) {
      dstFonts.set(key, copier.copy(value));
      continue;
    }
    const srcFont = asDict(srcCtx, value);
    if (srcFont && sameFont(srcFont, existing)) continue;
    const name = key.decodeText();
    let n = 2;
    while (taken.has(`${name}_${n}`)) n++;
    const fresh = `${name}_${n}`;
    taken.add(fresh);
    renames.set(name, fresh);
    dstFonts.set(PDFName.of(fresh), copier.copy(value));
  }
  return renames;
}

function renameFontsInDA(text: string, renames: Map<string, string>): string {
  if (renames.size === 0) return text;
  const names = [...renames.keys()].map(escapeRegExp).join("|");
  return text.replace(new RegExp(`/(${names})(?=[\\s/]|$)`, "g"), (_, name: string) => `/${renames.get(name)}`);
}

/**
 * Merge the source form defaults into the destination form and make the copied fields keep
 * the look they had: the default appearance (/DA) and quadding (/Q) are inheritable, so when
 * they differ from the destination's they are written on the copied root fields.
 */
function mergeFormDefaults(dst: PDFDocument, src: PDFDocument, dstAcro: PDFDict, roots: Entry[], copier: PDFObjectCopier): void {
  const srcCtx = src.context;
  const dstCtx = dst.context;
  const srcAcro = asDict(srcCtx, src.catalog.get(ACRO_FORM));
  if (!srcAcro) return;

  const renames = mergeDefaultFonts(srcAcro, dstAcro, srcCtx, dstCtx, copier);

  const srcDA = asRawString(srcCtx, srcAcro.get(DA));
  if (srcDA !== undefined && asRawString(dstCtx, dstAcro.get(DA)) === undefined && renames.size === 0) {
    dstAcro.set(DA, PDFString.of(srcDA));
  }
  const dstDA = asRawString(dstCtx, dstAcro.get(DA));
  const wantedDA = srcDA === undefined ? undefined : renameFontsInDA(srcDA, renames);
  const srcQ = asNumber(srcCtx, srcAcro.get(Q)) ?? 0;
  const dstQ = asNumber(dstCtx, dstAcro.get(Q)) ?? 0;

  for (const root of roots) {
    if (wantedDA !== undefined && wantedDA !== dstDA && !root.dict.has(DA)) root.dict.set(DA, PDFString.of(wantedDA));
    if (srcQ !== dstQ && !root.dict.has(Q)) root.dict.set(Q, PDFNumber.of(srcQ));
    if (renames.size > 0) {
      // Fields may carry their own /DA that points at a font resource we had to rename.
      walkFieldTree(dstCtx, root.dict, (dict) => {
        const text = asRawString(dstCtx, dict.get(DA));
        if (text === undefined) return;
        const renamed = renameFontsInDA(text, renames);
        if (renamed !== text) dict.set(DA, PDFString.of(renamed));
      });
    }
  }

  // Respect a source that explicitly asked viewers to rebuild appearances; never force it.
  const asked = srcCtx.lookup(srcAcro.get(NEED_APPEARANCES));
  if (asked instanceof PDFBool && asked.asBoolean()) dstAcro.set(NEED_APPEARANCES, PDFBool.True);
}

// ---------------------------------------------------------------------------------------------
// Public API

function registerFields(dst: PDFDocument, src: PDFDocument, copiedPages: PDFPage[], copier: PDFObjectCopier): void {
  const ctx = dst.context;

  // Annotations remember their page in /P. After a plain copyPages that is the *source* page
  // (or an orphan copy of it): point it to the page that really holds the annotation.
  for (const page of copiedPages) {
    const annots = annotsOf(page);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = asDict(ctx, annots.get(i));
      if (annot?.has(PAGE)) annot.set(PAGE, page.ref);
    }
  }

  const widgets = copiedPages.flatMap((page) => widgetsOf(page, true));
  if (widgets.length === 0) return;
  const keep = new Set(widgets.map((w) => w.ref));

  // Roots of the fields behind those widgets, in page order, without duplicates.
  const roots = new Map<PDFRef, Entry>();
  for (const widget of widgets) {
    const root = findRoot(ctx, widget);
    if (root && !roots.has(root.ref)) roots.set(root.ref, root);
  }
  if (roots.size === 0) return;

  const acroForm = dst.catalog.getOrCreateAcroForm();
  const fields = acroForm.normalizedEntries().Fields;
  const registered = new Set<PDFRef>();
  const usedNames = new Set<string>();
  for (let i = 0; i < fields.size(); i++) {
    const raw = fields.get(i);
    if (raw instanceof PDFRef) registered.add(raw);
    const name = asText(ctx, asDict(ctx, raw)?.get(T));
    if (name !== undefined) usedNames.add(name);
  }

  const added: Entry[] = [];
  for (const root of roots.values()) {
    if (registered.has(root.ref)) continue; // already part of the form (second call, same pages)
    pruneKids(ctx, root.dict, root.ref, keep, new Set());

    // Same-named root fields would be treated as one field (shared value) by viewers.
    const name = asText(ctx, root.dict.get(T));
    if (name !== undefined) {
      let unique = name;
      for (let n = 2; usedNames.has(unique); n++) unique = `${name}_${n}`;
      if (unique !== name) root.dict.set(T, PDFHexString.fromText(unique));
      usedNames.add(unique);
    }
    acroForm.addField(root.ref);
    added.push(root);
  }
  if (added.length > 0) mergeFormDefaults(dst, src, acroForm.dict, added, copier);
}

/**
 * Make the form fields behind the widgets of `copiedPages` part of `dst`'s AcroForm.
 *
 * Call it after `dst.copyPages(src, ...)`. For every Widget annotation on the copied pages it
 * walks up /Parent to the root field and appends the unique roots to /AcroForm /Fields
 * (creating the AcroForm if needed). Root names that collide with fields already in `dst` get
 * a "_2", "_3"... suffix. The source /DR fonts are merged into `dst`; existing appearance
 * streams are kept and /NeedAppearances is not forced.
 *
 * Prefer `copyPagesWithFields`, which does this and also keeps pdf-lib from copying pages you
 * did not ask for.
 */
export function registerCopiedFields(dst: PDFDocument, src: PDFDocument, copiedPages: PDFPage[]): void {
  registerFields(dst, src, copiedPages, PDFObjectCopier.for(src.context, dst.context));
}

// ---------------------------------------------------------------------------------------------
// Page copying that keeps forms and links tidy

type TraversedMap = Map<unknown, unknown>;

/**
 * pdf-lib's copier remembers what it has already copied in a private map. Pre-filling it lets
 * us decide, before copying, what a reference to some source object turns into.
 */
function traversedMapOf(copier: PDFObjectCopier): TraversedMap | undefined {
  const map = (copier as unknown as { traversedObjects?: unknown }).traversedObjects;
  return map instanceof Map ? map : undefined;
}

/**
 * Widget annotations that belong to a field with widgets on the selected pages but sit
 * themselves on pages that are not selected. They must not be copied (they would drag their
 * page along).
 */
function foreignWidgets(ctx: PDFContext, srcPages: PDFPage[], selected: Set<number>): PDFRef[] {
  const keep = new Set<PDFRef>();
  const roots = new Map<PDFRef, PDFDict>();
  for (const index of selected) {
    for (const widget of widgetsOf(srcPages[index], false)) {
      keep.add(widget.ref);
      const root = findRoot(ctx, widget);
      if (root) roots.set(root.ref, root.dict);
    }
  }
  const foreign: PDFRef[] = [];
  const seen = new Set<PDFDict>();
  const visit = (ref: PDFRef | undefined, node: PDFDict): void => {
    if (seen.has(node)) return;
    seen.add(node);
    const kids = asArray(ctx, node.get(KIDS));
    if (!kids) {
      if (ref && isName(ctx, node.get(SUBTYPE), WIDGET) && !keep.has(ref)) foreign.push(ref);
      return;
    }
    for (let i = 0; i < kids.size(); i++) {
      const raw = kids.get(i);
      const kid = asDict(ctx, raw);
      if (kid) visit(raw instanceof PDFRef ? raw : undefined, kid);
    }
  };
  for (const [ref, dict] of roots) visit(ref, dict);
  return foreign;
}

/** A destination array whose target page is gone (it was copied as null). */
function isDeadDestination(dest: PDFArray | undefined): boolean {
  return dest !== undefined && dest.size() > 0 && dest.get(0) === PDFNull;
}

/**
 * Links and actions that jumped to a page that was not copied lost their target (it became
 * null). A dead link annotation is removed; other annotations just lose the broken action.
 * Named destinations (strings) are left alone.
 */
function dropDeadLinks(pages: PDFPage[]): void {
  for (const page of pages) {
    const ctx = page.doc.context;
    const annots = annotsOf(page);
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const annot = asDict(ctx, annots.get(i));
      if (!annot) continue;
      const action = asDict(ctx, annot.get(ACTION));
      const deadDest = isDeadDestination(asArray(ctx, annot.get(DEST)));
      const deadAction =
        action !== undefined && isName(ctx, action.get(ACTION_TYPE), GOTO) && isDeadDestination(asArray(ctx, action.get(DEST_ARRAY)));
      if (!deadDest && !deadAction) continue;
      if (isName(ctx, annot.get(SUBTYPE), LINK)) {
        annots.remove(i);
      } else {
        if (deadDest) annot.delete(DEST);
        if (deadAction) annot.delete(ACTION);
      }
    }
  }
}

/** One copy of each requested page (indices must be unique). */
async function copyUniquePages(dst: PDFDocument, src: PDFDocument, indices: number[]): Promise<PDFPage[]> {
  await src.flush();
  const srcCtx = src.context;
  const dstCtx = dst.context;
  const copier = PDFObjectCopier.for(srcCtx, dstCtx);
  const traversed = traversedMapOf(copier);
  if (!traversed) {
    // Unknown pdf-lib internals: fall back to the stock behaviour.
    const pages = await dst.copyPages(src, indices);
    registerFields(dst, src, pages, copier);
    return pages;
  }

  const srcPages = src.getPages();
  const selected = new Set(indices);
  const newRefs = new Map<number, PDFRef>();
  // References to pages that are left out become null instead of dragging the page along...
  for (const page of srcPages) traversed.set(page.ref, PDFNull);
  // ...and references to a copied page (annotation /P, link destinations) point to its copy.
  for (const index of selected) {
    const ref = dstCtx.nextRef();
    newRefs.set(index, ref);
    traversed.set(srcPages[index].ref, ref);
  }
  for (const ref of foreignWidgets(srcCtx, srcPages, selected)) traversed.set(ref, PDFNull);

  const pages = indices.map((index) => {
    const copy = copier.copy(srcPages[index].node);
    const ref = newRefs.get(index)!;
    dstCtx.assign(ref, copy);
    return PDFPage.of(copy, ref, dst);
  });
  dropDeadLinks(pages);
  registerFields(dst, src, pages, copier);
  return pages;
}

/**
 * Like `dst.copyPages(src, indices)` (the pages are returned, not added to the document), but
 * form-aware and tidier:
 * - the form fields of the copied pages are registered in `dst` (see `registerCopiedFields`);
 * - fields that also appear on pages that were not copied only keep their copied widgets;
 * - links between copied pages keep working; links to pages left out are removed;
 * - no orphan copies of other pages end up in the output.
 * A page may appear several times in `indices`; each occurrence is an independent copy.
 *
 * @throws RangeError (Spanish message) when an index is not a page of `src`.
 */
export async function copyPagesWithFields(dst: PDFDocument, src: PDFDocument, indices: number[]): Promise<PDFPage[]> {
  const pageCount = src.getPageCount();
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= pageCount) {
      throw new RangeError(t("La página {n} no existe (el documento tiene {total}).", { n: index + 1, total: pageCount }));
    }
  }
  const result: PDFPage[] = new Array(indices.length);
  // Round k copies the k-th occurrence of every page, so repeated pages get separate objects.
  let pending = indices.map((index, position) => ({ index, position }));
  while (pending.length > 0) {
    const round: typeof pending = [];
    const rest: typeof pending = [];
    const seen = new Set<number>();
    for (const item of pending) {
      if (seen.has(item.index)) rest.push(item);
      else {
        seen.add(item.index);
        round.push(item);
      }
    }
    const pages = await copyUniquePages(dst, src, round.map((item) => item.index));
    round.forEach((item, k) => {
      result[item.position] = pages[k];
    });
    pending = rest;
  }
  return result;
}
