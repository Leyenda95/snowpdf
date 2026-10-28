import type { FontFamily } from "@/model/types";
import { loadPdf, savePdf } from "@/pdf/docUtils";
import { embedStandardFont, encodableText } from "@/pdf/fonts";
import { drawTextAt, getDisplayGeometry } from "@/pdf/pageGeometry";
import { parsePageSelection } from "@/pdf/ranges";

export type NumberPosition = "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";

export interface PageNumberOptions {
  position: NumberPosition;
  /** Placeholders {n} and {total}: "{n}", "Página {n} de {total}", "Confidencial · {n}/{total}". */
  template: string;
  /** Number printed on the first numbered page. */
  startAt: number;
  /** Which pages get a number ("1-3, 5"); default all. */
  pages?: string;
  /** {total} = pages in the document, or only the pages that get a number (default). */
  totalMode?: "document" | "numbered";
  font: FontFamily;
  bold?: boolean;
  size: number;
  color: string;
  /** Points between the text and the displayed edge of the page. */
  margin: number;
}

function fillTemplate(template: string, n: number, total: number): string {
  const text = template.trim() === "" ? "{n}" : template;
  return text
    .replace(/\{n\}/gi, String(n))
    .replace(/\{total\}/gi, String(total))
    .replace(/\s*[\r\n]+\s*/g, " ");
}

/**
 * Print page numbers. The text is placed in *display* space, so on a page rotated by /Rotate
 * the number still sits at the visual top/bottom and reads upright.
 */
export async function addPageNumbers(bytes: Uint8Array, opts: PageNumberOptions): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const pageCount = doc.getPageCount();
  const numbered = parsePageSelection(opts.pages ?? "", pageCount);
  const font = await embedStandardFont(doc, opts.font, opts.bold ?? false, false);
  const total = (opts.totalMode ?? "numbered") === "document" ? pageCount : numbered.length;
  const first = Number.isFinite(opts.startAt) ? Math.trunc(opts.startAt) : 1;
  const margin = Number.isFinite(opts.margin) ? Math.max(0, opts.margin) : 0;

  const ascent = font.heightAtSize(opts.size, { descender: false });
  const descent = font.heightAtSize(opts.size) - ascent;
  const [vertical, horizontal] = opts.position.split("-") as ["top" | "bottom", "left" | "center" | "right"];

  numbered.forEach((pageIndex, k) => {
    const page = doc.getPage(pageIndex);
    const g = getDisplayGeometry(page);
    const text = encodableText(font, fillTemplate(opts.template, first + k, total));
    const width = font.widthOfTextAtSize(text, opts.size);

    const x = horizontal === "left" ? margin : horizontal === "right" ? g.width - margin - width : (g.width - width) / 2;
    // The text box (descender line to ascender line) sits inside the margin.
    const baseline = vertical === "bottom" ? margin + descent : g.height - margin - ascent;
    drawTextAt(page, text, x, baseline, { font, size: opts.size, color: opts.color });
  });
  return savePdf(doc);
}
