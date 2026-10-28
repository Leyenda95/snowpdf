import {
  PageSizes,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  type PDFDocument,
  type PDFImage,
  type PDFPage,
} from "@cantoo/pdf-lib";
import { createPdf, savePdf } from "@/pdf/docUtils";
import { t } from "@/i18n";

export interface ImageInput {
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
  /** Only used in error messages. */
  name?: string;
}

export type ImagePageSize = "fit" | "A4" | "Letter";

export interface ImagesToPdfOptions {
  pageSize: ImagePageSize;
  /** Ignored when pageSize is "fit". "auto" picks landscape for images wider than tall. */
  orientation: "auto" | "portrait" | "landscape";
  /** Points around the image. */
  margin: number;
}

/** Layout of one image page (same shape as the tool options). */
export type ImagePageLayout = ImagesToPdfOptions;

/** CSS pixels are 1/96 in, PDF points 1/72 in. */
const PX_TO_PT = 0.75;
/** Largest page side Acrobat accepts (200 in). */
const MAX_PAGE_PT = 14400;

// ---------------------------------------------------------------------------------------------
// Image sniffing and EXIF orientation

/** Real format of the bytes, whatever the caller declared. */
export function detectImageMime(bytes: Uint8Array): "image/png" | "image/jpeg" | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return undefined;
}

interface ExifOrientation {
  /** 2..8 (1 means "upright" and is not reported). */
  value: number;
  /** Where the 2-byte value sits in the file. */
  offset: number;
  littleEndian: boolean;
}

/** Orientation tag of the first IFD of an EXIF block whose TIFF header starts at `tiff`. */
function parseExifOrientation(b: Uint8Array, tiff: number, end: number): ExifOrientation | undefined {
  if (tiff + 8 > end) return undefined;
  const little = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  if (!little && !(b[tiff] === 0x4d && b[tiff + 1] === 0x4d)) return undefined;
  const u16 = (p: number) => (little ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
  const u32 = (p: number) =>
    (little ? b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24) : (b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
  if (u16(tiff + 2) !== 0x2a) return undefined;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return undefined;
  const entries = u16(ifd);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return undefined;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 2 && value <= 8 ? { value, offset: entry + 8, littleEndian: little } : undefined;
    }
  }
  return undefined;
}

/** EXIF orientation of a JPEG, when it declares something other than "upright". */
function findJpegOrientation(bytes: Uint8Array): ExifOrientation | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return undefined;
    const marker = bytes[pos + 1];
    if (marker === 0xff) {
      pos += 1; // padding
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      pos += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return undefined; // end of image / start of scan
    const length = (bytes[pos + 2] << 8) | bytes[pos + 3];
    const isExif =
      marker === 0xe1 &&
      length >= 14 &&
      bytes[pos + 4] === 0x45 && // E
      bytes[pos + 5] === 0x78 && // x
      bytes[pos + 6] === 0x69 && // i
      bytes[pos + 7] === 0x66 && // f
      bytes[pos + 8] === 0 &&
      bytes[pos + 9] === 0;
    if (isExif) return parseExifOrientation(bytes, pos + 10, Math.min(bytes.length, pos + 2 + length));
    pos += 2 + length;
  }
  return undefined;
}

/**
 * EXIF orientation (1..8) of a JPEG; 1 when absent. Phone cameras store photos sideways and
 * record the rotation here: photo viewers apply it, PDF does not, so the page builder must.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  return findJpegOrientation(bytes)?.value ?? 1;
}

/** A copy of the JPEG whose orientation tag says "upright": the pixels are untouched. */
function withUprightOrientation(bytes: Uint8Array, tag: ExifOrientation): Uint8Array {
  const copy = bytes.slice();
  copy[tag.offset] = tag.littleEndian ? 1 : 0;
  copy[tag.offset + 1] = tag.littleEndian ? 0 : 1;
  return copy;
}

/**
 * Where the unit square of the stored image lands in the displayed image, for EXIF
 * orientation `o`. (u, v) and the result are in [0, 1], y up.
 */
function orient(o: number, u: number, v: number): [number, number] {
  const s = 1 - v; // row, counted from the top
  let u2 = u;
  let s2 = s;
  switch (o) {
    case 2: // mirrored horizontally
      u2 = 1 - u;
      break;
    case 3: // rotated 180
      u2 = 1 - u;
      s2 = 1 - s;
      break;
    case 4: // mirrored vertically
      s2 = 1 - s;
      break;
    case 5: // transposed
      u2 = s;
      s2 = u;
      break;
    case 6: // rotated 90 clockwise
      u2 = 1 - s;
      s2 = u;
      break;
    case 7: // transversed
      u2 = 1 - s;
      s2 = 1 - u;
      break;
    case 8: // rotated 90 counter-clockwise
      u2 = s;
      s2 = 1 - u;
      break;
  }
  return [u2, 1 - s2];
}

/** Draw `image` filling the box whose bottom-left corner is (x, y), undoing its EXIF orientation. */
function drawOrientedImage(page: PDFPage, image: PDFImage, orientation: number, x: number, y: number, w: number, h: number): void {
  if (orientation === 1) {
    page.drawImage(image, { x, y, width: w, height: h });
    return;
  }
  const p00 = orient(orientation, 0, 0);
  const p10 = orient(orientation, 1, 0);
  const p01 = orient(orientation, 0, 1);
  const name = page.node.newXObject("Image", image.ref);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(
      w * (p10[0] - p00[0]),
      h * (p10[1] - p00[1]),
      w * (p01[0] - p00[0]),
      h * (p01[1] - p00[1]),
      x + w * p00[0],
      y + h * p00[1],
    ),
    drawObject(name),
    popGraphicsState(),
  );
}

// ---------------------------------------------------------------------------------------------
// Image pages

export interface EmbeddedImage {
  image: PDFImage;
  /** EXIF orientation 1..8 (always 1 for PNG). */
  orientation: number;
}

/** Embed a PNG/JPEG. The real format wins over the declared mime type. */
export async function embedImageInput(doc: PDFDocument, input: ImageInput): Promise<EmbeddedImage> {
  const mime = detectImageMime(input.bytes) ?? input.mime;
  try {
    if (mime === "image/png") return { image: await doc.embedPng(input.bytes), orientation: 1 };
    // The page applies the EXIF rotation itself; the embedded copy says "upright" so that a
    // viewer that honours the tag inside PDF image streams cannot rotate the photo twice.
    const tag = findJpegOrientation(input.bytes);
    const data = tag ? withUprightOrientation(input.bytes, tag) : input.bytes;
    return { image: await doc.embedJpg(data), orientation: tag?.value ?? 1 };
  } catch {
    throw new Error(
      input.name
        ? t('No se pudo leer la imagen "{name}": el archivo está dañado o no es un PNG o JPEG válido.', { name: input.name })
        : t("No se pudo leer la imagen: el archivo está dañado o no es un PNG o JPEG válido."),
    );
  }
}

/**
 * Append one page holding `input` to `doc`. This is the single place that decides how an image
 * becomes a page; the "images to PDF" tool and the merge tool both use it.
 *
 * - "fit": the page is the image at 96 dpi (pixels * 0.75) plus the margins.
 * - "A4" / "Letter": the image is scaled to fit inside the margins and centred; "auto"
 *   orientation picks landscape for images wider than tall.
 */
export async function appendImagePage(doc: PDFDocument, input: ImageInput, layout: ImagePageLayout): Promise<PDFPage> {
  const { image, orientation } = await embedImageInput(doc, input);
  // Size of the picture as it is displayed (EXIF orientations 5..8 swap the axes).
  const swap = orientation >= 5;
  const pxW = swap ? image.height : image.width;
  const pxH = swap ? image.width : image.height;
  const margin = Number.isFinite(layout.margin) ? Math.max(0, layout.margin) : 0;

  let pageW: number;
  let pageH: number;
  let w: number;
  let h: number;
  let x: number;
  let y: number;

  if (layout.pageSize === "fit") {
    const m = Math.min(margin, MAX_PAGE_PT / 4);
    const k = Math.min(1, (MAX_PAGE_PT - 2 * m) / (Math.max(pxW, pxH) * PX_TO_PT));
    w = pxW * PX_TO_PT * k;
    h = pxH * PX_TO_PT * k;
    pageW = w + 2 * m;
    pageH = h + 2 * m;
    x = m;
    y = m;
  } else {
    const [shortSide, longSide] = PageSizes[layout.pageSize] ?? PageSizes.A4;
    const landscape = layout.orientation === "landscape" || (layout.orientation === "auto" && pxW > pxH);
    pageW = landscape ? longSide : shortSide;
    pageH = landscape ? shortSide : longSide;
    const m = Math.min(margin, Math.min(pageW, pageH) * 0.4);
    const k = Math.min((pageW - 2 * m) / pxW, (pageH - 2 * m) / pxH);
    w = pxW * k;
    h = pxH * k;
    x = (pageW - w) / 2;
    y = (pageH - h) / 2;
  }

  const page = doc.addPage([pageW, pageH]);
  drawOrientedImage(page, image, orientation, x, y, w, h);
  return page;
}

/**
 * One page per image, in order. The image is scaled to fit inside the margins (aspect ratio
 * kept) and centred; "fit" makes each page as large as its image (at 96 dpi) plus margins.
 */
export async function imagesToPdf(images: ImageInput[], opts: ImagesToPdfOptions): Promise<Uint8Array> {
  if (images.length === 0) throw new Error(t("Añade al menos una imagen para crear el PDF."));
  const doc = await createPdf();
  for (const image of images) await appendImagePage(doc, image, opts);
  return savePdf(doc);
}
