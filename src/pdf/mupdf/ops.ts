import * as mupdf from "mupdf";
import type { EraseMethod, PdfBox } from "@/model/types";
import { detectInk, inpaint, type PixelRect, type Raster } from "@/pdf/inpaint";
import { t } from "@/i18n";

/**
 * Heavy PDF operations implemented with MuPDF (WASM). Pure functions over bytes: they run in
 * the MuPDF Web Worker in the app and directly in Node in the tests.
 */

export class PdfPasswordError extends Error {
  readonly code = "WRONG_PASSWORD";
  constructor(message = t("La contraseña no es correcta.")) {
    super(message);
    this.name = "PdfPasswordError";
  }
}

type Progress = (fraction: number) => void;

function openPdf(bytes: Uint8Array): mupdf.PDFDocument {
  let doc: mupdf.Document;
  try {
    doc = mupdf.Document.openDocument(bytes, "application/pdf");
  } catch {
    throw new Error(t("No se puede abrir: el archivo no es un PDF válido o está muy dañado."));
  }
  const pdf = doc.asPDF();
  if (!pdf) {
    doc.destroy();
    throw new Error(t("El archivo no es un PDF."));
  }
  return pdf;
}

function unlock(doc: mupdf.PDFDocument, password: string | undefined): void {
  if (doc.needsPassword() && !doc.authenticatePassword(password ?? "")) {
    throw new PdfPasswordError(password ? undefined : t("Este PDF está protegido con contraseña."));
  }
}

/** Copy the result out of WASM memory before the buffer is freed. */
function save(doc: mupdf.PDFDocument, options: string): Uint8Array {
  const buf = doc.saveToBuffer(options);
  try {
    return buf.asUint8Array().slice();
  } finally {
    buf.destroy();
  }
}

const CLEAN_SAVE = "garbage=compact,compress,objstms";

// ---------------------------------------------------------------------------------------------
// Encryption

export interface PdfInfo {
  /** A password is required to open it. */
  needsPassword: boolean;
  /** The file is encrypted (maybe only with an owner password / permissions). */
  encrypted: boolean;
  pageCount: number | null;
}

export function inspect(bytes: Uint8Array): PdfInfo {
  const doc = openPdf(bytes);
  try {
    const needsPassword = doc.needsPassword();
    const enc = doc.getMetaData(mupdf.Document.META_ENCRYPTION) ?? "None";
    return {
      needsPassword,
      encrypted: needsPassword || (enc !== "" && enc !== "None"),
      pageCount: needsPassword ? null : doc.countPages(),
    };
  } finally {
    doc.destroy();
  }
}

/** Remove encryption (user and/or owner password). Throws PdfPasswordError. */
export function decrypt(bytes: Uint8Array, password?: string): Uint8Array {
  const doc = openPdf(bytes);
  try {
    unlock(doc, password);
    return save(doc, "encrypt=none");
  } finally {
    doc.destroy();
  }
}

// ---------------------------------------------------------------------------------------------
// Redaction

export interface RedactionArea {
  pageIndex: number;
  /** User space. */
  box: PdfBox;
  /**
   * "redact": remove text, image pixels and covered vector art (real redaction).
   * "replace": remove only the text (used by "edit existing text").
   * "erase-vector": text and covered vector art (magic eraser).
   * "erase-pixels": text, covered vector art and image pixels (magic eraser).
   */
  mode: "redact" | "replace" | "erase-vector" | "erase-pixels";
}

function toPageRect(transform: mupdf.Matrix, box: PdfBox): mupdf.Rect {
  const [a, b, c, d, e, f] = transform;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[0], box[3]],
    [box[2], box[3]],
  ]) {
    xs.push(a * x + c * y + e);
    ys.push(b * x + d * y + f);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** An image XObject used by a page (directly or through a Form XObject). */
interface PageImage {
  num: number;
  ref: mupdf.PDFObject;
  width: number;
  height: number;
  components: number;
  /** Stored as JPEG only. */
  dct: boolean;
  /** Has a mask of any kind: re-encoding could not keep it right. */
  masked: boolean;
}

/** Images in the page's resources and, one level down, in the resources of its Forms. */
function pageImages(doc: mupdf.PDFDocument, page: mupdf.PDFPage): PageImage[] {
  const out: PageImage[] = [];
  const seen = new Set<number>();
  const walk = (resources: mupdf.PDFObject, depth: number) => {
    const xobjects = resources.get("XObject");
    if (!xobjects.isDictionary()) return;
    xobjects.forEach((val) => {
      if (!val.isIndirect()) return;
      const num = val.asIndirect();
      if (seen.has(num)) return;
      seen.add(num);
      const dict = val.resolve();
      const subtype = nameValue(dict.get("Subtype"));
      if (subtype === "Form" && depth === 0) walk(dict.get("Resources"), 1);
      if (subtype !== "Image") return;
      const filters = filterNames(dict);
      const image = doc.loadImage(val);
      try {
        out.push({
          num,
          ref: val,
          width: dict.get("Width").asNumber(),
          height: dict.get("Height").asNumber(),
          components: image.getNumberOfComponents(),
          dct: filters.length === 1 && filters[0] === "DCTDecode",
          masked: !dict.get("SMask").isNull() || !dict.get("Mask").isNull() || (dict.get("ImageMask").isBoolean() && dict.get("ImageMask").asBoolean()),
        });
      } finally {
        image.destroy();
      }
    });
  };
  walk(page.getObject().getInheritable("Resources"), 0);
  return out;
}

/** Quality of the JPEGs written back after image pixels were removed. */
const REDACT_JPEG_QUALITY = 90;

/**
 * Blanking the pixels of a JPEG makes MuPDF write the whole image back lossless (Flate), which
 * can multiply the file size. Put such images back to JPEG (from the already-blanked pixels, so
 * what was removed stays removed), when that is smaller. `before` is what pageImages found
 * before the redaction.
 */
function restoreJpegImages(doc: mupdf.PDFDocument, page: mupdf.PDFPage, before: PageImage[]): void {
  const known = new Set(before.map((i) => i.num));
  const jpegs = before.filter((i) => i.dct && !i.masked);
  const taken = new Set<number>();
  for (const img of pageImages(doc, page)) {
    if (img.dct || img.masked) continue;
    // Rewritten in place, or replaced by a new object of the same shape.
    let was = jpegs.find((j) => j.num === img.num);
    if (!was && !known.has(img.num)) {
      was = jpegs.find((j) => !taken.has(j.num) && j.width === img.width && j.height === img.height && j.components === img.components);
    }
    if (!was) continue;
    taken.add(was.num);
    try {
      rewriteAsJpeg(doc, img.ref, { quality: REDACT_JPEG_QUALITY, maxRatio: 1 });
    } catch (err) {
      // Keep the (larger but correct) lossless image.
      console.warn(`redact: image ${img.num} not recompressed`, err);
    }
  }
}

/**
 * Remove content for real. The boxes are NOT painted (black/white boxes are drawn later by the
 * editor export, with the colour the user chose). Unreferenced objects are garbage-collected so
 * replaced image data does not survive in the file.
 */
export function redact(bytes: Uint8Array, areas: RedactionArea[]): Uint8Array {
  const doc = openPdf(bytes);
  try {
    const byPage = new Map<number, RedactionArea[]>();
    for (const a of areas) byPage.set(a.pageIndex, [...(byPage.get(a.pageIndex) ?? []), a]);

    for (const [pageIndex, list] of byPage) {
      const page = doc.loadPage(pageIndex);
      const transform = page.getTransform();
      const touchesPixels = list.some((a) => a.mode === "redact" || a.mode === "erase-pixels");
      const imagesBefore = touchesPixels ? pageImages(doc, page) : [];
      const pass = (mode: RedactionArea["mode"], image: number, lineArt: number) => {
        const items = list.filter((a) => a.mode === mode);
        if (items.length === 0) return;
        for (const item of items) {
          const annot = page.createAnnotation("Redact");
          annot.setRect(toPageRect(transform, item.box));
        }
        page.applyRedactions(false, image, lineArt, mupdf.PDFPage.REDACT_TEXT_REMOVE);
      };
      pass("replace", mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE);
      pass("erase-vector", mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED);
      pass("erase-pixels", mupdf.PDFPage.REDACT_IMAGE_PIXELS, mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED);
      pass("redact", mupdf.PDFPage.REDACT_IMAGE_PIXELS, mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED);
      if (touchesPixels) restoreJpegImages(doc, page, imagesBefore);
      page.destroy();
    }
    return save(doc, CLEAN_SAVE);
  } finally {
    doc.destroy();
  }
}

// ---------------------------------------------------------------------------------------------
// Magic eraser

export interface EraseRegionResult {
  method: EraseMethod;
  /** Picture of `box` after erasing: PNG, or JPEG for "pixels" (photographic, opaque). */
  png: Uint8Array;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
  /** User-space box rendered: the requested box grown by 1 pt. */
  box: PdfBox;
}

/** Resolution of the analysis render, of the reconstructed patch, and the most pixels a render may have. */
const ERASE_DPI = 150;
const ERASE_PATCH_DPI = 300;
const ERASE_MAX_PIXELS = 4_000_000;
/** A zone is clean when the ink left is below the larger of this and a share of the initial ink. */
const CLEAN_MIN_PIXELS = 15;
const CLEAN_SHARE = 0.03;

type EraseStep = Exclude<EraseMethod, "none">;
const ERASE_STEPS: EraseStep[] = ["text", "vector", "pixels"];

/** What MuPDF removes in each step that works on the file (see docs/PLAN_BORRADOR_MAGICO.md). */
const ERASE_PASSES: Record<"text" | "vector", { image: number; lineArt: number }> = {
  text: { image: mupdf.PDFPage.REDACT_IMAGE_NONE, lineArt: mupdf.PDFPage.REDACT_LINE_ART_NONE },
  vector: { image: mupdf.PDFPage.REDACT_IMAGE_NONE, lineArt: mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED },
};

function grow(box: PdfBox, by: number): PdfBox {
  return [box[0] - by, box[1] - by, box[2] + by, box[3] + by];
}

/**
 * Pixel grid covering a user-space box exactly. The raster is upright in user space (y up in
 * the file = up in the picture, whatever the page's /Rotate), so it can be drawn back into the
 * file or over the page as an axis-aligned box.
 */
interface Grid {
  box: PdfBox;
  /** Pixels per point. */
  sx: number;
  sy: number;
  width: number;
  height: number;
  /** Page space (what MuPDF runs content in) -> raster pixels. */
  matrix: mupdf.Matrix;
}

function gridFor(transform: mupdf.Matrix, box: PdfBox, dpi: number): Grid {
  const w = Math.max(box[2] - box[0], 0.01);
  const h = Math.max(box[3] - box[1], 0.01);
  // Big zones are rendered coarser so the raster stays around ERASE_MAX_PIXELS.
  const k = Math.min(dpi / 72, Math.sqrt(ERASE_MAX_PIXELS / (w * h)));
  const width = Math.max(1, Math.ceil(w * k));
  const height = Math.max(1, Math.ceil(h * k));
  const sx = width / w;
  const sy = height / h;
  const userToRaster: mupdf.Matrix = [sx, 0, 0, -sy, -box[0] * sx, box[3] * sy];
  return { box, sx, sy, width, height, matrix: mupdf.Matrix.concat(mupdf.Matrix.invert(transform), userToRaster) };
}

/** `inner` (user space) inside the raster of `grid`, in pixels. */
function regionIn(inner: PdfBox, grid: Grid): PixelRect {
  const [x0, , , y1] = grid.box;
  return { x0: (inner[0] - x0) * grid.sx, y0: (y1 - inner[3]) * grid.sy, x1: (inner[2] - x0) * grid.sx, y1: (y1 - inner[1]) * grid.sy };
}

/** Render a region of the page content (no annotations or widgets: the viewer paints those). */
function renderRegion(page: mupdf.Page, grid: Grid, withPng: boolean): { raster: Raster; png: Uint8Array | null } {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, grid.width, grid.height], false);
  try {
    pix.clear(255);
    const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
    try {
      page.runPageContents(device, grid.matrix);
      device.close();
    } finally {
      device.destroy();
    }
    const stride = pix.getStride();
    const src = pix.getPixels();
    const data = new Uint8ClampedArray(grid.width * grid.height * 3);
    for (let y = 0; y < grid.height; y++) data.set(src.subarray(y * stride, y * stride + grid.width * 3), y * grid.width * 3);
    return { raster: { data, width: grid.width, height: grid.height, channels: 3 }, png: withPng ? pix.asPNG().slice() : null };
  } finally {
    pix.destroy();
  }
}

/** JPEG quality of the reconstructed patch. */
const PATCH_JPEG_QUALITY = 90;

function encodeJpeg(raster: Raster): Uint8Array {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, raster.width, raster.height], false);
  try {
    const stride = pix.getStride();
    const dst = pix.getPixels();
    for (let y = 0; y < raster.height; y++) dst.set(raster.data.subarray(y * raster.width * 3, (y + 1) * raster.width * 3), y * stride);
    return pix.asJPEG(PATCH_JPEG_QUALITY, false).slice();
  } finally {
    pix.destroy();
  }
}

/**
 * Run `fn` on a page of a fresh copy of the document where `step` has been applied to `box`
 * (null = untouched). Redaction edits the document, so every attempt starts from the bytes.
 */
function withErased<T>(bytes: Uint8Array, pageIndex: number, box: PdfBox, step: "text" | "vector" | null, fn: (page: mupdf.PDFPage) => T): T {
  const doc = openPdf(bytes);
  try {
    let page = doc.loadPage(pageIndex);
    if (step) {
      const annot = page.createAnnotation("Redact");
      annot.setRect(toPageRect(page.getTransform(), box));
      const { image, lineArt } = ERASE_PASSES[step];
      page.applyRedactions(false, image, lineArt, mupdf.PDFPage.REDACT_TEXT_REMOVE);
      // Render from the page as the edit left it, not from anything MuPDF cached.
      page.destroy();
      page = doc.loadPage(pageIndex);
    }
    try {
      return fn(page);
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}

/**
 * Magic eraser: remove what is inside `box` and show the real background. Tries, from least to
 * most aggressive, removing the glyphs, the covered vector art and finally rebuilding the
 * pixels (inpainting), and keeps the first that leaves the zone free of ink. That is judged on a
 * render, so it does not matter how the page is built. With `maxMethod` it stops there and
 * answers "none" (the page as it was) when that was not enough. `bytes` is never modified.
 */
export function eraseRegion(bytes: Uint8Array, pageIndex: number, box: PdfBox, opts: { maxMethod?: EraseMethod } = {}): EraseRegionResult {
  const renderBox = grow(box, 1);
  const maxRank = opts.maxMethod === "none" ? -1 : ERASE_STEPS.indexOf(opts.maxMethod ?? "pixels");
  const transform = withErased(bytes, pageIndex, box, null, (page) => page.getTransform());
  const grid = gridFor(transform, renderBox, ERASE_DPI);
  const result = (method: EraseMethod, png: Uint8Array, g: Grid, mime: EraseRegionResult["mime"] = "image/png"): EraseRegionResult => ({
    method,
    png,
    mime,
    width: g.width,
    height: g.height,
    box: renderBox,
  });

  const before = withErased(bytes, pageIndex, box, null, (page) => renderRegion(page, grid, true));
  const ink = detectInk(before.raster, { dpi: ERASE_DPI, region: regionIn(box, grid), dilate: 0 });
  if (maxRank < 0 || ink.count === 0) return result("none", before.png!, grid);

  const limit = Math.min(Math.max(CLEAN_MIN_PIXELS, ink.count * CLEAN_SHARE), ink.count * 0.5);
  for (const method of ERASE_STEPS.slice(0, maxRank + 1)) {
    if (method === "pixels") {
      // The patch is drawn over the page on export, so it is built finer. Started from the page
      // without glyphs and covered vector art: what is left of the ink is made of pixels.
      const patchGrid = gridFor(transform, renderBox, ERASE_PATCH_DPI);
      const base = withErased(bytes, pageIndex, box, "vector", (page) => renderRegion(page, patchGrid, false)).raster;
      // Scanned glyphs have soft edges: take them too, and a halo wide in proportion to the dpi.
      const patchInk = detectInk(base, {
        dpi: ERASE_PATCH_DPI,
        region: regionIn(box, patchGrid),
        polarity: ink.polarity,
        hysteresis: true,
        dilate: Math.round(ERASE_PATCH_DPI / 100) + 1,
      });
      return result("pixels", encodeJpeg(inpaint(base, patchInk.mask)), patchGrid, "image/jpeg");
    }
    const after = withErased(bytes, pageIndex, box, method, (page) => renderRegion(page, grid, true));
    // Same polarity as before: a clean zone must not be read the other way round.
    const left = detectInk(after.raster, { dpi: ERASE_DPI, region: regionIn(box, grid), polarity: ink.polarity, dilate: 0 }).count;
    if (left < limit) return result(method, after.png!, grid);
  }
  // The caller does not allow going far enough: nothing was erased.
  return result("none", before.png!, grid);
}

// ---------------------------------------------------------------------------------------------
// Compression

export type CompressLevel = "low" | "medium" | "high";

/** Target resolution and JPEG quality per level (similar to Acrobat's "Optimize PDF" presets). */
export const COMPRESS_PRESETS: Record<CompressLevel, { dpi: number; quality: number }> = {
  low: { dpi: 220, quality: 85 },
  medium: { dpi: 150, quality: 72 },
  high: { dpi: 96, quality: 55 },
};

export interface CompressResult {
  bytes: Uint8Array;
  originalSize: number;
  images: number;
  recompressed: number;
}

function nameValue(obj: mupdf.PDFObject): string | null {
  return obj.isName() ? obj.asName() : null;
}

function filterNames(dict: mupdf.PDFObject): string[] {
  const f = dict.get("Filter");
  if (f.isName()) return [f.asName()];
  if (f.isArray()) {
    const out: string[] = [];
    f.forEach((v) => {
      const n = nameValue(v);
      if (n) out.push(n);
    });
    return out;
  }
  return [];
}

/**
 * Re-encode an image as JPEG in place (scaled by `scale` when below 1). Written only when the
 * JPEG is smaller than `maxRatio` times the current stream. Returns whether it was replaced.
 */
function rewriteAsJpeg(doc: mupdf.PDFDocument, ref: mupdf.PDFObject, opts: { quality: number; scale?: number; maxRatio: number }): boolean {
  const raw = ref.readRawStream();
  const rawLength = raw.getLength();
  raw.destroy();
  let image: mupdf.Image | null = null;
  let pix: mupdf.Pixmap | null = null;
  try {
    image = doc.loadImage(ref);
    pix = image.toPixmap();
    const cs = pix.getColorSpace();
    if (!cs) return false;
    const gray = cs.getNumberOfComponents() === 1 && !cs.isIndexed();
    const target = gray ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB;
    if (pix.getAlpha() || !(gray ? cs.isGray() : cs.isRGB())) {
      const converted = pix.convertToColorSpace(target, false);
      pix.destroy();
      pix = converted;
    }
    const scale = opts.scale ?? 1;
    const pw = pix.getWidth();
    const ph = pix.getHeight();
    if (scale < 1) {
      const tw = Math.max(1, Math.round(pw * scale));
      const th = Math.max(1, Math.round(ph * scale));
      const warped = pix.warp(
        [
          [0, 0],
          [pw, 0],
          [pw, ph],
          [0, ph],
        ],
        tw,
        th,
      );
      pix.destroy();
      pix = warped;
    }
    const jpeg = pix.asJPEG(opts.quality, false).slice();
    if (jpeg.length >= rawLength * opts.maxRatio) return false;

    ref.writeRawStream(jpeg);
    ref.put("Filter", doc.newName("DCTDecode"));
    ref.put("Width", doc.newInteger(pix.getWidth()));
    ref.put("Height", doc.newInteger(pix.getHeight()));
    ref.put("BitsPerComponent", doc.newInteger(8));
    ref.put("ColorSpace", doc.newName(gray ? "DeviceGray" : "DeviceRGB"));
    ref.delete("DecodeParms");
    ref.delete("Decode");
    return true;
  } finally {
    pix?.destroy();
    image?.destroy();
  }
}

export function compress(bytes: Uint8Array, level: CompressLevel, onProgress?: Progress): CompressResult {
  const { dpi, quality } = COMPRESS_PRESETS[level];
  const doc = openPdf(bytes);
  try {
    // The largest page side bounds the useful resolution of any image (conservative: an image
    // can't usefully have more pixels than needed to fill the biggest page at the target dpi).
    let maxSideInches = 8.5;
    const pageCount = doc.countPages();
    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i);
      const [x0, y0, x1, y1] = page.getBounds();
      maxSideInches = Math.max(maxSideInches, Math.max(x1 - x0, y1 - y0) / 72);
      page.destroy();
    }

    const imageNums: number[] = [];
    const smaskNums = new Set<number>();
    const total = doc.countObjects();
    for (let num = 1; num < total; num++) {
      let obj: mupdf.PDFObject;
      try {
        // isStream() only answers for the indirect reference, not for the resolved object.
        const ref = doc.newIndirect(num);
        if (!ref.isStream()) continue;
        obj = ref.resolve();
      } catch {
        continue;
      }
      if (nameValue(obj.get("Subtype")) !== "Image") continue;
      imageNums.push(num);
      const smask = obj.get("SMask");
      if (smask.isIndirect()) smaskNums.add(smask.asIndirect());
    }

    let recompressed = 0;
    imageNums.forEach((num, i) => {
      onProgress?.(i / Math.max(1, imageNums.length));
      if (smaskNums.has(num)) return;
      const ref = doc.newIndirect(num);
      const dict = ref.resolve();
      if (dict.get("ImageMask").isBoolean() && dict.get("ImageMask").asBoolean()) return;
      const bpc = dict.get("BitsPerComponent");
      if (bpc.isNumber() && bpc.asNumber() < 8) return;
      const filters = filterNames(dict);
      if (filters.some((f) => f === "JBIG2Decode" || f === "CCITTFaxDecode")) return;
      // Colour-key masks refer to the original sample values: recompressing would break them.
      if (dict.get("Mask").isArray()) return;
      const w = dict.get("Width").asNumber();
      const h = dict.get("Height").asNumber();
      if (!(w > 0 && h > 0) || w * h < 40_000) return;

      // Like Acrobat's optimizer: only downsample images above 1.5x the target resolution.
      const ratio = (maxSideInches * dpi) / Math.max(w, h);
      const scale = ratio < 1 / 1.5 ? ratio : 1;
      const isJpeg = filters.length === 1 && filters[0] === "DCTDecode";
      if (isJpeg && scale > 0.9 && level === "low") return;

      try {
        if (rewriteAsJpeg(doc, ref, { quality, scale, maxRatio: 0.92 })) recompressed++;
      } catch (err) {
        // Unsupported or broken image: keep it as it is.
        console.warn(`compress: image ${num} skipped`, err);
      }
    });
    onProgress?.(1);

    return {
      bytes: save(doc, "garbage=deduplicate,compress,compress-fonts,compress-images,objstms"),
      originalSize: bytes.length,
      images: imageNums.length - smaskNums.size,
      recompressed,
    };
  } finally {
    doc.destroy();
  }
}

// ---------------------------------------------------------------------------------------------
// Maintenance

export function repair(bytes: Uint8Array, password?: string): { bytes: Uint8Array; repaired: boolean } {
  const doc = openPdf(bytes);
  try {
    unlock(doc, password);
    const n = doc.countPages();
    for (let i = 0; i < n; i++) {
      try {
        doc.loadPage(i).destroy();
      } catch {
        // A broken page is still kept in the page tree; MuPDF will write what it can.
      }
    }
    const repaired = doc.wasRepaired();
    return { bytes: save(doc, CLEAN_SAVE), repaired };
  } finally {
    doc.destroy();
  }
}

/** Burn annotations and/or form fields into the page content. */
export function bake(bytes: Uint8Array, opts: { annotations: boolean; widgets: boolean }): Uint8Array {
  const doc = openPdf(bytes);
  try {
    doc.bake(opts.annotations, opts.widgets);
    return save(doc, CLEAN_SAVE);
  } finally {
    doc.destroy();
  }
}

// ---------------------------------------------------------------------------------------------
// Rasterising and text

export interface RenderPagesOptions {
  /** 0-based; empty = all. */
  pages: number[];
  dpi: number;
  format: "png" | "jpg";
  /** JPEG quality 1..100. */
  quality?: number;
}

export interface RenderedPage {
  pageIndex: number;
  bytes: Uint8Array;
  width: number;
  height: number;
}

export function renderPages(bytes: Uint8Array, opts: RenderPagesOptions, onProgress?: Progress): RenderedPage[] {
  const doc = openPdf(bytes);
  try {
    const all = Array.from({ length: doc.countPages() }, (_, i) => i);
    const pages = opts.pages.length ? opts.pages : all;
    const zoom = opts.dpi / 72;
    return pages.map((pageIndex, i) => {
      onProgress?.(i / pages.length);
      const page = doc.loadPage(pageIndex);
      const pix = page.toPixmap(mupdf.Matrix.scale(zoom, zoom), mupdf.ColorSpace.DeviceRGB, false, true);
      try {
        pix.setResolution(opts.dpi, opts.dpi);
        const out = opts.format === "png" ? pix.asPNG() : pix.asJPEG(opts.quality ?? 85, false);
        return { pageIndex, bytes: out.slice(), width: pix.getWidth(), height: pix.getHeight() };
      } finally {
        pix.destroy();
        page.destroy();
      }
    });
  } finally {
    doc.destroy();
  }
}

export function extractText(bytes: Uint8Array): string[] {
  const doc = openPdf(bytes);
  try {
    const out: string[] = [];
    const n = doc.countPages();
    for (let i = 0; i < n; i++) {
      const page = doc.loadPage(i);
      const st = page.toStructuredText("preserve-whitespace");
      out.push(st.asText());
      st.destroy();
      page.destroy();
    }
    return out;
  } finally {
    doc.destroy();
  }
}

// ---------------------------------------------------------------------------------------------
// Font subsetting

/**
 * Keep only the glyphs actually used by every embedded font. Installed fonts are embedded
 * whole (pdf-lib's own subsetter does not work with this fontkit), often over 1 MB each.
 */
export function subsetFonts(bytes: Uint8Array): Uint8Array {
  const doc = openPdf(bytes);
  try {
    doc.subsetFonts();
    return save(doc, CLEAN_SAVE);
  } finally {
    doc.destroy();
  }
}

// ---------------------------------------------------------------------------------------------
// Worker protocol: every op takes one argument object and an optional progress callback.

export const workerOps = {
  inspect: (a: { bytes: Uint8Array }) => inspect(a.bytes),
  decrypt: (a: { bytes: Uint8Array; password?: string }) => decrypt(a.bytes, a.password),
  redact: (a: { bytes: Uint8Array; areas: RedactionArea[] }) => redact(a.bytes, a.areas),
  compress: (a: { bytes: Uint8Array; level: CompressLevel }, p?: Progress) => compress(a.bytes, a.level, p),
  repair: (a: { bytes: Uint8Array; password?: string }) => repair(a.bytes, a.password),
  bake: (a: { bytes: Uint8Array; annotations: boolean; widgets: boolean }) => bake(a.bytes, a),
  renderPages: (a: { bytes: Uint8Array; options: RenderPagesOptions }, p?: Progress) => renderPages(a.bytes, a.options, p),
  extractText: (a: { bytes: Uint8Array }) => extractText(a.bytes),
  subsetFonts: (a: { bytes: Uint8Array }) => subsetFonts(a.bytes),
  eraseRegion: (a: { bytes: Uint8Array; pageIndex: number; box: PdfBox; maxMethod?: EraseMethod }) => eraseRegion(a.bytes, a.pageIndex, a.box, a),
};

export type WorkerOps = typeof workerOps;
