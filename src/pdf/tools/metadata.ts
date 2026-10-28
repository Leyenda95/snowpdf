import { PDFDict, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFString, decodePDFRawStream, type PDFDocument } from "@cantoo/pdf-lib";
import { loadPdf, savePdf } from "@/pdf/docUtils";

export interface PdfMetadata {
  title: string;
  author: string;
  subject: string;
  /** As stored in the file (usually comma separated). */
  keywords: string;
  creator: string;
  producer: string;
  creationDate: Date | null;
  modificationDate: Date | null;
  pageCount: number;
}

type EditableKey = "title" | "author" | "subject" | "keywords" | "creator";

const KEYS: Record<EditableKey, PDFName> = {
  title: PDFName.of("Title"),
  author: PDFName.of("Author"),
  subject: PDFName.of("Subject"),
  keywords: PDFName.of("Keywords"),
  creator: PDFName.of("Creator"),
};
const PRODUCER = PDFName.of("Producer");
const CREATION_DATE = PDFName.of("CreationDate");
const MOD_DATE = PDFName.of("ModDate");

/** The /Info dictionary; created on demand. */
function infoDict(doc: PDFDocument, create: boolean): PDFDict | undefined {
  const ctx = doc.context;
  const found = ctx.lookup(ctx.trailerInfo.Info);
  const existing = found instanceof PDFDict ? found : undefined;
  if (existing || !create) return existing;
  const dict = ctx.obj({});
  ctx.trailerInfo.Info = ctx.register(dict);
  return dict;
}

/** A text entry of the Info dictionary; anything that is not a string reads as missing. */
function entry(info: PDFDict | undefined, key: PDFName): PDFString | PDFHexString | undefined {
  const value = info?.context.lookup(info.get(key));
  return value instanceof PDFString || value instanceof PDFHexString ? value : undefined;
}

function readText(info: PDFDict | undefined, key: PDFName): string {
  try {
    return entry(info, key)?.decodeText() ?? "";
  } catch {
    return "";
  }
}

function readDate(info: PDFDict | undefined, key: PDFName): Date | null {
  try {
    const date = entry(info, key)?.decodeDate();
    return date && !Number.isNaN(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// XMP. Many files (everything Adobe writes) carry the same properties in an XMP packet, and
// Acrobat prefers it over the Info dictionary, so an edit that only touched Info would seem to
// be ignored. Only properties already present in the packet are updated or removed.

const METADATA = PDFName.of("Metadata");

function xmlEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace (or, with null, remove) a property written as an element or as an attribute. */
function setXmpProperty(xml: string, qname: string, element: string | null, attribute: string | null): string {
  const q = escapeRe(qname);
  const asElement = new RegExp(String.raw`<${q}(?:\s[^>]*)?(?:/>|>[\s\S]*?</${q}>)`);
  if (asElement.test(xml)) return xml.replace(asElement, () => element ?? "");
  const asAttribute = new RegExp(String.raw`(\s)${q}\s*=\s*(?:"[^"]*"|'[^']*')`);
  if (asAttribute.test(xml)) return xml.replace(asAttribute, (_, space: string) => (attribute === null ? "" : `${space}${qname}="${attribute}"`));
  return xml;
}

function updateXmp(xml: string, meta: Partial<Pick<PdfMetadata, EditableKey>>, now: Date): string {
  let out = xml;
  const apply = (value: string | undefined, qname: string, wrap: (escaped: string) => string): void => {
    if (value === undefined) return;
    const text = value.trim();
    const escaped = xmlEscape(text);
    out = setXmpProperty(out, qname, text === "" ? null : `<${qname}>${wrap(escaped)}</${qname}>`, text === "" ? null : escaped);
  };
  const alt = (t: string) => `<rdf:Alt><rdf:li xml:lang="x-default">${t}</rdf:li></rdf:Alt>`;
  apply(meta.title, "dc:title", alt);
  apply(meta.subject, "dc:description", alt);
  apply(meta.author, "dc:creator", (t) => `<rdf:Seq><rdf:li>${t}</rdf:li></rdf:Seq>`);
  apply(meta.keywords, "pdf:Keywords", (t) => t);
  apply(meta.creator, "xmp:CreatorTool", (t) => t);
  if (out !== xml) {
    const stamp = now.toISOString();
    for (const qname of ["xmp:ModifyDate", "xmp:MetadataDate"]) out = setXmpProperty(out, qname, `<${qname}>${stamp}</${qname}>`, stamp);
  }
  return out;
}

function syncXmp(doc: PDFDocument, meta: Partial<Pick<PdfMetadata, EditableKey>>): void {
  const ctx = doc.context;
  const stream = ctx.lookup(doc.catalog.get(METADATA));
  if (!(stream instanceof PDFRawStream)) return;
  try {
    const xml = new TextDecoder("utf-8").decode(decodePDFRawStream(stream).decode());
    const updated = updateXmp(xml, meta, new Date());
    if (updated === xml) return;
    const replacement = ctx.stream(new TextEncoder().encode(updated), { Type: "Metadata", Subtype: "XML" });
    const ref = doc.catalog.get(METADATA);
    if (ref instanceof PDFRef) ctx.assign(ref, replacement);
    else doc.catalog.set(METADATA, ctx.register(replacement));
  } catch {
    // an XMP packet we cannot read is left as it is
  }
}

/** Document properties; anything the file does not have comes back as "" (or null for dates). */
export async function readMetadata(bytes: Uint8Array): Promise<PdfMetadata> {
  const doc = await loadPdf(bytes);
  const info = infoDict(doc, false);
  return {
    title: readText(info, KEYS.title),
    author: readText(info, KEYS.author),
    subject: readText(info, KEYS.subject),
    keywords: readText(info, KEYS.keywords),
    creator: readText(info, KEYS.creator),
    producer: readText(info, PRODUCER),
    creationDate: readDate(info, CREATION_DATE),
    modificationDate: readDate(info, MOD_DATE),
    pageCount: doc.getPageCount(),
  };
}

/**
 * Set document properties. Fields that are left out stay as they are; an empty (or blank)
 * string removes the entry. Keywords are stored exactly as given (comma separated text).
 * Producer and modification date are refreshed on save. Properties that the file also keeps in
 * an XMP packet are updated there too.
 */
export async function writeMetadata(
  bytes: Uint8Array,
  meta: Partial<Pick<PdfMetadata, EditableKey>>,
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const info = infoDict(doc, true)!;
  for (const key of Object.keys(KEYS) as EditableKey[]) {
    const value = meta[key];
    if (value === undefined) continue;
    const text = value.trim();
    if (text === "") info.delete(KEYS[key]);
    else info.set(KEYS[key], PDFHexString.fromText(text));
  }
  syncXmp(doc, meta);
  return savePdf(doc);
}
