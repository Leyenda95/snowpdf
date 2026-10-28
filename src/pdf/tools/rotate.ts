import { degrees } from "@cantoo/pdf-lib";
import { loadPdf, savePdf } from "@/pdf/docUtils";
import { normalizeRotation } from "@/pdf/pageGeometry";
import { parsePageSelection } from "@/pdf/ranges";
import { t } from "@/i18n";

/**
 * Rotate pages clockwise: `angle` is added to each selected page's current rotation.
 * `pages` is a range such as "1-3, 5"; empty or missing rotates every page.
 */
export async function rotatePages(bytes: Uint8Array, opts: { angle: 90 | 180 | 270; pages?: string }): Promise<Uint8Array> {
  if (!Number.isFinite(opts.angle) || opts.angle % 90 !== 0) {
    throw new RangeError(t("El ángulo de giro debe ser 90, 180 o 270 grados."));
  }
  const doc = await loadPdf(bytes);
  for (const index of parsePageSelection(opts.pages ?? "", doc.getPageCount())) {
    const page = doc.getPage(index);
    page.setRotation(degrees(normalizeRotation(page.getRotation().angle + opts.angle)));
  }
  return savePdf(doc);
}
