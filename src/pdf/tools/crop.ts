import { PDFName } from "@cantoo/pdf-lib";
import { loadPdf, savePdf } from "@/pdf/docUtils";
import { getDisplayGeometry } from "@/pdf/pageGeometry";
import { parsePageSelection } from "@/pdf/ranges";
import { t } from "@/i18n";

/** Points to remove from each edge, as the page is seen on screen. */
export interface CropMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A page smaller than this (in either direction) is not worth keeping. */
const MIN_SIZE = 36;

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Shrink the CropBox of the selected pages by `margins`. The margins are measured on the page
 * as displayed (after /Rotate), so "top" is the visual top whatever the page rotation is.
 *
 * @throws RangeError (Spanish message) for negative margins or margins that leave less than
 * 36 pt of width or height.
 */
export async function cropPages(bytes: Uint8Array, opts: { margins: CropMargins; pages?: string }): Promise<Uint8Array> {
  const { top, right, bottom, left } = opts.margins;
  for (const m of [top, right, bottom, left]) {
    if (!Number.isFinite(m) || m < 0) throw new RangeError(t("Los márgenes de recorte deben ser números mayores o iguales que 0."));
  }

  const doc = await loadPdf(bytes);
  const indices = parsePageSelection(opts.pages ?? "", doc.getPageCount());

  // Check every page before changing any of them.
  const plans = indices.map((index) => {
    const page = doc.getPage(index);
    const g = getDisplayGeometry(page);
    const width = g.width - left - right;
    const height = g.height - top - bottom;
    if (width < MIN_SIZE || height < MIN_SIZE) {
      throw new RangeError(
        t("Los márgenes son demasiado grandes: la página {n} se quedaría con menos de {min} pt de ancho o de alto.", { n: index + 1, min: MIN_SIZE }),
      );
    }
    // Both corners of the new visible area in user space; the page may be rotated.
    const a = g.toUser(left, bottom);
    const b = g.toUser(g.width - right, g.height - top);
    return { page, x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
  });

  // Written as corners (not x, y, width, height) so the stored numbers are exactly the rounded ones.
  for (const { page, x0, y0, x1, y1 } of plans) {
    page.node.set(PDFName.of("CropBox"), doc.context.obj([round(x0), round(y0), round(x1), round(y1)]));
  }
  return savePdf(doc);
}
