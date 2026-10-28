import { PDFArray, type PDFDocument, type PDFImage, type PDFObject, type PDFPage } from "@cantoo/pdf-lib";
import type { FontFamily } from "@/model/types";
import { loadPdf, savePdf } from "@/pdf/docUtils";
import { embedStandardFont, encodableText } from "@/pdf/fonts";
import { drawImageBox, drawTextAt, getDisplayGeometry, type DisplayGeometry } from "@/pdf/pageGeometry";
import { parsePageSelection } from "@/pdf/ranges";
import { detectImageMime } from "./imagesToPdf";
import { t } from "@/i18n";

export type WatermarkPosition =
  | "center"
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "tile";

export interface TextWatermark {
  kind: "text";
  /** May contain line breaks; every line is centred. */
  text: string;
  font: FontFamily;
  bold: boolean;
  italic: boolean;
  /** Points. */
  size: number;
  /** "#rrggbb" */
  color: string;
}

export interface ImageWatermark {
  kind: "image";
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
  /** Image width as a fraction of the page's displayed width, 0..1. */
  widthRatio: number;
}

export interface WatermarkOptions {
  mark: TextWatermark | ImageWatermark;
  position: WatermarkPosition;
  /** 0 (invisible) .. 1 (solid). */
  opacity: number;
  /** Degrees counter-clockwise, as seen on screen. */
  angle: number;
  /** Pages to mark ("1-3, 5"); empty or missing marks every page. */
  pages?: string;
  /** "over" paints on top of the page, "under" behind its content. */
  layer: "over" | "under";
  /** Distance to the page edges for edge/corner positions, points. Default 36. */
  margin?: number;
}

const DEFAULT_MARGIN = 36;
/** Beyond this many copies a tiled mark is spread out further instead. */
const MAX_TILES = 1500;

interface Point {
  x: number;
  y: number;
}

/** A mark ready to be stamped on one page. Sizes are those of the unrotated mark, in points. */
interface Mark {
  width: number;
  height: number;
  /** Draw it centred on display point (cx, cy), turned by the watermark angle around that point. */
  draw(page: PDFPage, cx: number, cy: number): void;
}

type MarkFactory = (geometry: DisplayGeometry) => Mark;

function rotate(x: number, y: number, degrees: number): Point {
  const r = (degrees * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
}

/** Axis-aligned size of a w x h box turned by `degrees`. */
function rotatedExtent(w: number, h: number, degrees: number): { w: number; h: number } {
  const r = (degrees * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return { w: w * c + h * s, h: w * s + h * c };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// ---------------------------------------------------------------------------------------------
// Marks

async function textMark(doc: PDFDocument, mark: TextWatermark, opacity: number, angle: number): Promise<MarkFactory> {
  if (!(mark.size > 0)) throw new RangeError(t("El tamaño del texto de la marca de agua debe ser mayor que 0."));
  const font = await embedStandardFont(doc, mark.font, mark.bold, mark.italic);
  const lines = encodableText(font, mark.text).replace(/\r\n?/g, "\n").split("\n");
  if (lines.every((line) => line.trim() === "")) throw new Error(t("Escribe el texto de la marca de agua."));

  const size = mark.size;
  const lineHeight = size * 1.2;
  const ascent = font.heightAtSize(size, { descender: false });
  const widths = lines.map((line) => font.widthOfTextAtSize(line, size));
  const width = Math.max(...widths);
  const height = (lines.length - 1) * lineHeight + ascent;

  const stamp: Mark = {
    width,
    height,
    draw(page, cx, cy) {
      lines.forEach((line, k) => {
        if (line === "") return;
        // Block centred on (cx, cy); each line centred horizontally, baselines lineHeight apart.
        const baseline = ((lines.length - 1) / 2 - k) * lineHeight - ascent / 2;
        const o = rotate(-widths[k] / 2, baseline, angle);
        drawTextAt(page, line, cx + o.x, cy + o.y, { font, size, color: mark.color, opacity, angle });
      });
    },
  };
  return () => stamp;
}

async function imageMark(doc: PDFDocument, mark: ImageWatermark, opacity: number, angle: number): Promise<MarkFactory> {
  const mime = detectImageMime(mark.bytes) ?? mark.mime;
  let image: PDFImage;
  try {
    image = mime === "image/png" ? await doc.embedPng(mark.bytes) : await doc.embedJpg(mark.bytes);
  } catch {
    throw new Error(t("No se pudo leer la imagen de la marca de agua: el archivo está dañado o no es un PNG o JPEG válido."));
  }
  const ratio = clamp(Number.isFinite(mark.widthRatio) ? mark.widthRatio : 0.5, 0.01, 1);
  return (g) => {
    let width = g.width * ratio;
    let height = (width * image.height) / image.width;
    if (height > g.height) {
      width *= g.height / height;
      height = g.height;
    }
    return {
      width,
      height,
      draw: (page, cx, cy) => drawImageBox(page, image, cx - width / 2, cy - height / 2, width, height, { opacity, angle }),
    };
  };
}

// ---------------------------------------------------------------------------------------------
// Placement (display space: origin bottom-left, y up)

/** Centre of the mark along one axis. A mark that does not fit inside the margins is centred. */
function place(side: "start" | "middle" | "end", size: number, extent: number, margin: number): number {
  if (side === "middle" || extent + 2 * margin >= size) return size / 2;
  return side === "start" ? margin + extent / 2 : size - margin - extent / 2;
}

function edgeCenter(position: Exclude<WatermarkPosition, "tile">, g: DisplayGeometry, mark: Mark, angle: number, margin: number): Point {
  const ext = rotatedExtent(mark.width, mark.height, angle);
  // Every position but "center" reads "<vertical>-<horizontal>".
  const [vertical, horizontal] = (position === "center" ? "middle-center" : position).split("-");
  return {
    x: place(horizontal === "left" ? "start" : horizontal === "right" ? "end" : "middle", g.width, ext.w, margin),
    y: place(vertical === "bottom" ? "start" : vertical === "top" ? "end" : "middle", g.height, ext.h, margin),
  };
}

/**
 * Centres of a staggered grid aligned with the text direction that covers the page. Odd rows
 * are shifted by half a step; one mark sits exactly at the page centre.
 */
function tileCenters(g: DisplayGeometry, mark: Mark, angle: number): Point[] {
  const ext = rotatedExtent(mark.width, mark.height, angle);
  const along = rotate(1, 0, angle);
  const across = rotate(0, 1, angle);
  const reach = Math.hypot(g.width, g.height) / 2 + Math.hypot(ext.w, ext.h);

  for (let spread = 1; ; spread *= 1.5) {
    const stepU = (mark.width + Math.max(40, mark.width * 0.35)) * spread;
    const stepV = (mark.height + Math.max(50, mark.height * 1.5)) * spread;
    const nu = Math.ceil(reach / stepU) + 1;
    const nv = Math.ceil(reach / stepV) + 1;
    const out: Point[] = [];
    for (let j = -nv; j <= nv; j++) {
      const shift = j % 2 !== 0 ? stepU / 2 : 0;
      for (let i = -nu; i <= nu; i++) {
        const du = i * stepU + shift;
        const dv = j * stepV;
        const x = g.width / 2 + du * along.x + dv * across.x;
        const y = g.height / 2 + du * along.y + dv * across.y;
        if (x + ext.w / 2 < 0 || x - ext.w / 2 > g.width || y + ext.h / 2 < 0 || y - ext.h / 2 > g.height) continue;
        out.push({ x, y });
      }
    }
    if (out.length <= MAX_TILES) return out;
  }
}

// ---------------------------------------------------------------------------------------------
// Content stream order

function contentCount(page: PDFPage): number {
  const contents = page.node.Contents();
  return contents instanceof PDFArray ? contents.size() : 0;
}

/** Move the content streams appended after the first `previous` ones to the front of /Contents. */
function moveAppendedToFront(page: PDFPage, previous: number): void {
  const contents = page.node.Contents();
  if (!(contents instanceof PDFArray) || contents.size() <= previous) return;
  const appended: PDFObject[] = [];
  for (let i = contents.size() - 1; i >= previous; i--) {
    appended.unshift(contents.get(i));
    contents.remove(i);
  }
  appended.forEach((stream, k) => contents.insert(k, stream));
}

/**
 * Stamp a text or image watermark on the selected pages. Positions, margins and the angle are
 * in display space (the page as it looks, after /Rotate), so a mark at "bottom-right" is at the
 * visual bottom-right and reads upright on any page. "tile" repeats the mark in a staggered
 * grid over the whole page.
 *
 * With layer "under" the mark is painted before the page's own content (it can be hidden by
 * opaque backgrounds); with "over" it is painted last.
 */
export async function addWatermark(bytes: Uint8Array, opts: WatermarkOptions): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const opacity = Number.isFinite(opts.opacity) ? clamp(opts.opacity, 0, 1) : 1;
  const angle = Number.isFinite(opts.angle) ? opts.angle : 0;
  const margin = opts.margin !== undefined && Number.isFinite(opts.margin) ? Math.max(0, opts.margin) : DEFAULT_MARGIN;
  const indices = parsePageSelection(opts.pages ?? "", doc.getPageCount());
  const prepare =
    opts.mark.kind === "text"
      ? await textMark(doc, opts.mark, opacity, angle)
      : await imageMark(doc, opts.mark, opacity, angle);

  for (const index of indices) {
    const page = doc.getPage(index);
    const g = getDisplayGeometry(page);
    const mark = prepare(g);
    const centers = opts.position === "tile" ? tileCenters(g, mark, angle) : [edgeCenter(opts.position, g, mark, angle, margin)];

    let previous = 0;
    if (opts.layer === "under") {
      page.node.normalize(); // wraps the original content in q/Q so the mark starts from a clean state
      previous = contentCount(page);
    }
    for (const c of centers) mark.draw(page, c.x, c.y);
    if (opts.layer === "under") moveAppendedToFront(page, previous);
  }
  return savePdf(doc);
}
