/**
 * Fixtures and independent checks for the PDF engine tests.
 *
 * Fixtures are built with pdf-lib; everything the tests *assert* about the output is read back
 * with MuPDF (a different PDF implementation) or with pdf-lib when it is about file structure.
 * MuPDF reports text positions in display space: origin at the top-left corner of the page as
 * it looks after /Rotate, y pointing DOWN.
 */
import * as mupdf from "mupdf";
import { PDFDocument, PDFName, PDFPageLeaf, StandardFonts, degrees } from "@cantoo/pdf-lib";
import { zlibSync } from "fflate";
import type { FontFamily } from "@/model/types";
import { embedStandardFont } from "@/pdf/fonts";

// ---------------------------------------------------------------------------------------------
// PDF fixtures

export interface PdfMeta {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
}

export interface MakePdfOptions {
  /** Number of pages (default 1). */
  pages?: number;
  /** Page size in points before rotation (default 300 x 400). */
  size?: [number, number];
  /** /Rotate of each page (default 0). */
  rotations?: number[];
  /** Add a text field per page (and a checkbox on page 1). */
  withForm?: boolean;
  /** Prefix of the big label drawn on every page: "P" gives "P1", "P2"... */
  label?: string;
  /** Document information. Without it the file has no Info dictionary at all. */
  meta?: PdfMeta;
}

/** Name and value of the text field that `makePdf({ withForm: true })` puts on page `n` (1-based). */
export function textFieldName(n: number): string {
  return `texto_${n}`;
}
export function textFieldValue(label: string, n: number): string {
  return `Valor ${label}${n}`;
}

/** Display point -> user-space point on an unrotated page of `w` x `h` with /Rotate `rot`. */
function displayToUser(rot: number, w: number, h: number, x: number, y: number): { x: number; y: number } {
  switch (rot) {
    case 90:
      return { x: w - y, y: x };
    case 180:
      return { x: w - x, y: h - y };
    case 270:
      return { x: y, y: h - x };
    default:
      return { x, y };
  }
}

/**
 * A document whose pages carry a big upright label ("P1", "P2"...) near the top-left corner of
 * the page as displayed, so page order can be checked from the extracted text.
 */
export async function makePdf(opts: MakePdfOptions = {}): Promise<Uint8Array> {
  const { pages = 1, size = [300, 400], rotations = [], withForm = false, label = "P", meta } = opts;
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = withForm ? doc.getForm() : undefined;
  const [w, h] = size;

  for (let i = 0; i < pages; i++) {
    const rot = rotations[i] ?? 0;
    const page = doc.addPage([w, h]);
    if (rot !== 0) page.setRotation(degrees(rot)); // like most files, no /Rotate at all when upright

    const displayHeight = rot === 90 || rot === 270 ? w : h;
    const at = displayToUser(rot, w, h, 20, displayHeight - 60);
    page.drawText(`${label}${i + 1}`, { x: at.x, y: at.y, size: 40, font, rotate: degrees(rot) });

    if (form) {
      const text = form.createTextField(textFieldName(i + 1));
      text.setText(textFieldValue(label, i + 1));
      text.addToPage(page, { x: 20, y: 20, width: 150, height: 24 });
      if (i === 0) {
        const box = form.createCheckBox("acepto");
        box.addToPage(page, { x: 200, y: 20, width: 20, height: 20 });
        box.check();
      }
    }
  }

  if (meta?.title !== undefined) doc.setTitle(meta.title);
  if (meta?.author !== undefined) doc.setAuthor(meta.author);
  if (meta?.subject !== undefined) doc.setSubject(meta.subject);
  if (meta?.keywords !== undefined) doc.setKeywords(meta.keywords);
  if (meta?.creator !== undefined) doc.setCreator(meta.creator);
  if (meta?.producer !== undefined) doc.setProducer(meta.producer);
  if (meta?.creationDate !== undefined) doc.setCreationDate(meta.creationDate);
  if (meta?.modificationDate !== undefined) doc.setModificationDate(meta.modificationDate);
  return doc.save();
}

/** Open with pdf-lib without touching Creator/Producer, for structural assertions. */
export function openPdf(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

/**
 * Pages that hold nothing but their content stream: /Resources, /MediaBox, /CropBox and /Rotate
 * are inherited from the page tree node, as many generators write them. Page n shows "P{n}".
 */
export async function makeInheritedPdf(opts: { pages?: number; size?: [number, number]; rotate?: number; cropBox?: [number, number, number, number] } = {}): Promise<Uint8Array> {
  const { pages = 2, size = [300, 400], rotate = 0, cropBox } = opts;
  const doc = await PDFDocument.create({ updateMetadata: false });
  const ctx = doc.context;
  const font = doc.embedStandardFont(StandardFonts.HelveticaBold);
  const tree = doc.catalog.Pages();
  tree.set(PDFName.of("Resources"), ctx.obj({ Font: { F1: font.ref } }));
  tree.set(PDFName.of("MediaBox"), ctx.obj([0, 0, size[0], size[1]]));
  if (rotate) tree.set(PDFName.of("Rotate"), ctx.obj(rotate));
  if (cropBox) tree.set(PDFName.of("CropBox"), ctx.obj(cropBox));
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage();
    for (const key of ["Resources", "MediaBox", "CropBox", "Rotate"]) page.node.delete(PDFName.of(key));
    // upright on the displayed page: draw at display (20, 60 from the top) turned like the page
    const [w, h] = size;
    const box = cropBox ?? [0, 0, w, h];
    const displayHeight = rotate === 90 || rotate === 270 ? box[2] - box[0] : box[3] - box[1];
    const at = displayToUser(rotate, box[2] - box[0], box[3] - box[1], 20, displayHeight - 60);
    const [c, s] = rotate === 90 ? [0, 1] : rotate === 180 ? [-1, 0] : rotate === 270 ? [0, -1] : [1, 0]; // exact, no 6e-17
    const content = `BT /F1 40 Tf ${c} ${s} ${-s} ${c} ${box[0] + at.x} ${box[1] + at.y} Tm (P${i + 1}) Tj ET`;
    page.node.set(PDFName.of("Contents"), ctx.register(ctx.stream(content)));
  }
  return doc.save({ useObjectStreams: false });
}

/** Fully qualified names of the fields pdf-lib finds in the AcroForm, in order. */
export async function fieldNames(bytes: Uint8Array): Promise<string[]> {
  const doc = await openPdf(bytes);
  if (!doc.catalog.has(PDFName.of("AcroForm"))) return [];
  return doc
    .getForm()
    .getFields()
    .map((f) => f.getName());
}

/** Page objects in the file, counting orphans that are not part of the page tree. */
export async function countPageObjects(bytes: Uint8Array): Promise<number> {
  const doc = await openPdf(bytes);
  return doc.context.enumerateIndirectObjects().filter(([, obj]) => obj instanceof PDFPageLeaf).length;
}

/**
 * A 3-page form with the shapes real forms have:
 * - texto_1..3: one text field per page ("valor 1"..)
 * - compartido: ONE text field with a widget on page 1 and another on page 2
 * - opcion: radio group, option "a" on page 1 and "b" on page 3 (selected: "b")
 * - datos.nombre: hierarchical field on page 2 ("Ana")
 * - links: page 1 -> page 3 and page 3 -> page 1
 */
export async function makeRichFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) doc.addPage([300, 200]).drawText(`P${i + 1}`, { x: 100, y: 100, size: 40, font });
  const form = doc.getForm();
  for (let i = 0; i < 3; i++) {
    const text = form.createTextField(`texto_${i + 1}`);
    text.setText(`valor ${i + 1}`);
    text.addToPage(doc.getPage(i), { x: 20, y: 20, width: 120, height: 24 });
  }
  const shared = form.createTextField("compartido");
  shared.setText("hola");
  shared.addToPage(doc.getPage(0), { x: 20, y: 60, width: 120, height: 24 });
  shared.addToPage(doc.getPage(1), { x: 20, y: 60, width: 120, height: 24 });
  const radio = form.createRadioGroup("opcion");
  radio.addOptionToPage("a", doc.getPage(0), { x: 200, y: 20, width: 16, height: 16 });
  radio.addOptionToPage("b", doc.getPage(2), { x: 200, y: 20, width: 16, height: 16 });
  radio.select("b");
  const nested = form.createTextField("datos.nombre");
  nested.setText("Ana");
  nested.addToPage(doc.getPage(1), { x: 20, y: 120, width: 120, height: 24 });
  for (const [from, to] of [
    [0, 2],
    [2, 0],
  ]) {
    const link = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [10, 150, 100, 190],
      Border: [0, 0, 0],
      Dest: [doc.getPage(to).ref, "Fit"],
    });
    doc.getPage(from).node.addAnnot(doc.context.register(link));
  }
  return doc.save();
}

/** Metrics of one of the standard fonts, as pdf-lib lays text out with it. */
export async function fontMetrics(family: FontFamily = "helvetica", bold = false, italic = false) {
  const font = await embedStandardFont(await PDFDocument.create(), family, bold, italic);
  return {
    width: (text: string, size: number): number => font.widthOfTextAtSize(text, size),
    /** Height of the capitals box: baseline to ascender line. */
    ascent: (size: number): number => font.heightAtSize(size, { descender: false }),
    /** Depth below the baseline. */
    descent: (size: number): number => font.heightAtSize(size) - font.heightAtSize(size, { descender: false }),
  };
}

// ---------------------------------------------------------------------------------------------
// Image fixtures

export type Pixel = [r: number, g: number, b: number];
export type PixelFn = (x: number, y: number) => Pixel;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A valid 8-bit RGB PNG. Default: solid red. */
export function makePng(width: number, height: number, pixel: PixelFn = () => [200, 30, 30]): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlibSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

/** A valid baseline JPEG (encoded by MuPDF). Default: solid blue. */
export function makeJpeg(width: number, height: number, pixel: PixelFn = () => [30, 90, 200]): Uint8Array {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false);
  try {
    const px = pix.getPixels();
    const stride = pix.getStride();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [r, g, b] = pixel(x, y);
        const o = y * stride + x * 3;
        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
      }
    }
    return pix.asJPEG(95, false).slice();
  } finally {
    pix.destroy();
  }
}

/** Insert an EXIF segment declaring `orientation` (1..8) right after the JPEG's SOI marker. */
export function withExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  const tiff = [
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian header, first IFD at offset 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation, SHORT, 1 value
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ];
  const body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0" + TIFF
  const length = body.length + 2;
  const segment = new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff, ...body]);
  return concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

// ---------------------------------------------------------------------------------------------
// MuPDF-based inspection

function withDocument<T>(bytes: Uint8Array, fn: (doc: mupdf.PDFDocument) => T): T {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF();
  if (!doc) throw new Error("not a PDF");
  try {
    return fn(doc);
  } finally {
    doc.destroy();
  }
}

/** A document property as MuPDF reads it ("Title", "Author", "Keywords"...). */
export function infoOf(bytes: Uint8Array, key: "Title" | "Author" | "Subject" | "Keywords" | "Creator" | "Producer" | "CreationDate" | "ModDate"): string | undefined {
  return withDocument(bytes, (doc) => doc.getMetaData(`info:${key}`));
}

export function pageCountOf(bytes: Uint8Array): number {
  return withDocument(bytes, (doc) => doc.countPages());
}

/** Size of the page as displayed (after /Rotate), in points. */
export function displaySize(bytes: Uint8Array, pageIndex = 0): { width: number; height: number } {
  return withDocument(bytes, (doc) => {
    const page = doc.loadPage(pageIndex);
    try {
      const [x0, y0, x1, y1] = page.getBounds();
      return { width: x1 - x0, height: y1 - y0 };
    } finally {
      page.destroy();
    }
  });
}

export interface TextLine {
  text: string;
  /** Start of the baseline, display space, y down. */
  x: number;
  y: number;
  /** Bounding box, display space, y down. */
  bbox: { x: number; y: number; w: number; h: number };
  /** Centre of the bounding box. */
  cx: number;
  cy: number;
  fontSize: number;
  /** Name of the font MuPDF reports, e.g. "Helvetica-Bold". */
  fontName: string;
}

interface StextJson {
  blocks: {
    type: string;
    lines?: { bbox: { x: number; y: number; w: number; h: number }; font: { size: number; name: string }; x: number; y: number; text: string }[];
  }[];
}

/** Every line of text on a page with its position, as MuPDF sees it. */
export function textLines(bytes: Uint8Array, pageIndex = 0): TextLine[] {
  return withDocument(bytes, (doc) => {
    const page = doc.loadPage(pageIndex);
    try {
      const stext = page.toStructuredText("preserve-whitespace");
      try {
        const json = JSON.parse(stext.asJSON()) as StextJson;
        return json.blocks
          .filter((block) => block.type === "text")
          .flatMap((block) => block.lines ?? [])
          .map((line) => ({
            text: line.text,
            x: line.x,
            y: line.y,
            bbox: line.bbox,
            cx: line.bbox.x + line.bbox.w / 2,
            cy: line.bbox.y + line.bbox.h / 2,
            fontSize: line.font.size,
            fontName: line.font.name,
          }));
      } finally {
        stext.destroy();
      }
    } finally {
      page.destroy();
    }
  });
}

/** All the text of a page (lines joined with "\n"). */
export function pageText(bytes: Uint8Array, pageIndex = 0): string {
  return textLines(bytes, pageIndex)
    .map((line) => line.text)
    .join("\n");
}

/** The line of a page whose text is exactly `text` (throws when there is none). */
export function findLine(bytes: Uint8Array, pageIndex: number, text: string): TextLine {
  const line = textLines(bytes, pageIndex).find((l) => l.text === text);
  if (!line) throw new Error(`No line "${text}" on page ${pageIndex + 1}: ${JSON.stringify(pageText(bytes, pageIndex))}`);
  return line;
}

/** The "P1"-style label of every page, in page order ("" where a page has none). */
export function pageLabels(bytes: Uint8Array, label = "P"): string[] {
  const pattern = new RegExp(`^${label}\\d+$`);
  return Array.from({ length: pageCountOf(bytes) }, (_, i) => textLines(bytes, i).find((l) => pattern.test(l.text))?.text ?? "");
}

export interface TextRun {
  /** The characters of one text-showing operation. */
  text: string;
  /** Start of the baseline in display space (y down). */
  x: number;
  y: number;
  /** Direction of the baseline in degrees counter-clockwise as seen on screen (0 = reads left to right). */
  angle: number;
  /** Font size in points. */
  size: number;
  /** Fill opacity 0..1. */
  alpha: number;
  /** RGB 0..1. */
  color: [number, number, number];
}

function toRgb(color: number[]): [number, number, number] {
  return color.length >= 3 ? [color[0], color[1], color[2]] : [color[0] ?? 0, color[0] ?? 0, color[0] ?? 0];
}

/** Every piece of text the page paints, exactly as the renderer receives it (position, angle, opacity, colour). */
export function textRuns(bytes: Uint8Array, pageIndex = 0): TextRun[] {
  return withDocument(bytes, (doc) => {
    const page = doc.loadPage(pageIndex);
    const runs: TextRun[] = [];
    const device = new mupdf.Device({
      fillText(text, ctm, _colorspace, color, alpha) {
        let content = "";
        let first: mupdf.Matrix | undefined;
        text.walk({
          showGlyph(_font, trm, _glyph, unicode) {
            first ??= mupdf.Matrix.concat(trm, ctm);
            content += String.fromCodePoint(unicode);
          },
        });
        if (!first) return;
        const [a, b, , , e, f] = first;
        runs.push({ text: content, x: e, y: f, angle: (-Math.atan2(b, a) * 180) / Math.PI, size: Math.hypot(a, b), alpha, color: toRgb(color) });
      },
    });
    try {
      page.run(device, mupdf.Matrix.identity);
      device.close();
    } finally {
      device.destroy();
      page.destroy();
    }
    return runs;
  });
}

export interface ImageRun {
  /** Centre of the painted image, display space (y down). */
  cx: number;
  cy: number;
  /** Size of the painted image along its own axes, points. */
  width: number;
  height: number;
  /** Direction of the image bottom edge in degrees counter-clockwise as seen on screen. */
  angle: number;
  alpha: number;
}

/** Every image the page paints, with where and how it lands on the displayed page. */
export function imageRuns(bytes: Uint8Array, pageIndex = 0): ImageRun[] {
  return withDocument(bytes, (doc) => {
    const page = doc.loadPage(pageIndex);
    const runs: ImageRun[] = [];
    const device = new mupdf.Device({
      fillImage(_image, ctm, alpha) {
        // The unit square (0,0)-(1,1) of the image lands on the parallelogram below (y down).
        const [a, b, c, d, e, f] = ctm;
        runs.push({
          cx: e + (a + c) / 2,
          cy: f + (b + d) / 2,
          width: Math.hypot(a, b),
          height: Math.hypot(c, d),
          angle: (-Math.atan2(b, a) * 180) / Math.PI,
          alpha,
        });
      },
    });
    try {
      page.run(device, mupdf.Matrix.identity);
      device.close();
    } finally {
      device.destroy();
      page.destroy();
    }
    return runs;
  });
}

export interface WidgetInfo {
  name: string;
  value: string;
  type: string;
}

/** Form widgets MuPDF finds on a page (fully qualified field name, value, type). */
export function widgetsOf(bytes: Uint8Array, pageIndex = 0): WidgetInfo[] {
  return withDocument(bytes, (doc) => {
    const page = doc.loadPage(pageIndex);
    try {
      return (page.getWidgets() ?? []).map((w) => ({ name: w.getName(), value: w.getValue(), type: w.getFieldType() }));
    } finally {
      page.destroy();
    }
  });
}

/** Destinations (or URIs) of the links MuPDF finds on a page, e.g. "#page=3&view=Fit". */
export function linksOf(bytes: Uint8Array, pageIndex = 0): string[] {
  return withDocument(bytes, (doc) => {
    const page = doc.loadPage(pageIndex);
    try {
      return page.getLinks().map((link) => link.getURI());
    } finally {
      page.destroy();
    }
  });
}

export interface OutlineNode {
  title: string;
  /** 0-based page the bookmark jumps to. */
  page: number;
  children?: OutlineNode[];
}

/** The bookmarks MuPDF reads from the file, with the page each one resolves to. */
export function outlineOf(bytes: Uint8Array): OutlineNode[] {
  return withDocument(bytes, (doc) => {
    type Item = NonNullable<ReturnType<mupdf.PDFDocument["loadOutline"]>>[number];
    const convert = (items: Item[]): OutlineNode[] =>
      items.map((item) => ({
        title: item.title ?? "",
        page: item.page ?? (item.uri ? doc.resolveLink(item.uri) : -1),
        ...(item.down && item.down.length > 0 ? { children: convert(item.down) } : {}),
      }));
    return convert(doc.loadOutline() ?? []);
  });
}

export interface Raster {
  width: number;
  height: number;
  /** RGB at pixel (x, y), counted from the top-left corner of the rendered page. */
  pixel(x: number, y: number): Pixel;
}

/** Render a page and give access to its pixels (scale 1 = 72 dpi). */
export function renderPage(bytes: Uint8Array, pageIndex = 0, scale = 1): Raster {
  return withDocument(bytes, (doc) => {
    const page = doc.loadPage(pageIndex);
    try {
      const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
      try {
        const width = pix.getWidth();
        const height = pix.getHeight();
        const stride = pix.getStride();
        const n = pix.getNumberOfComponents();
        const data = pix.getPixels().slice();
        return {
          width,
          height,
          pixel: (x, y) => {
            const o = y * stride + x * n;
            return [data[o], data[o + 1], data[o + 2]];
          },
        };
      } finally {
        pix.destroy();
      }
    } finally {
      page.destroy();
    }
  });
}

/** True when the pixel is clearly closer to `target` than to white (loose colour match). */
export function isColor(pixel: Pixel, target: Pixel, tolerance = 60): boolean {
  return pixel.every((v, i) => Math.abs(v - target[i]) <= tolerance);
}

export interface Bounds {
  x0: number;
  y0: number;
  /** Exclusive. */
  x1: number;
  y1: number;
}

/** Bounding box (pixels, y down) of everything that is not white, or undefined for a blank page. */
export function inkBounds(raster: Raster, whiteAbove = 240): Bounds | undefined {
  let box: Bounds | undefined;
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      if (raster.pixel(x, y).every((v) => v > whiteAbove)) continue;
      box = box
        ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x + 1), y1: Math.max(box.y1, y + 1) }
        : { x0: x, y0: y, x1: x + 1, y1: y + 1 };
    }
  }
  return box;
}
