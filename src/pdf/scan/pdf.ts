import { createPdf, savePdf } from "@/pdf/docUtils";
import { embedImageInput, type ImageInput } from "@/pdf/tools/imagesToPdf";
import { t } from "@/i18n";

/** Longest side of a scanned page: an A4 sheet's (points). */
const LONG_SIDE_PT = 841.89;

/**
 * One page per scanned sheet, each exactly as large as its picture: the longest side measures
 * like an A4's, so the pages print and zoom like ordinary documents whatever the photo's resolution.
 */
export async function scanToPdf(images: ImageInput[]): Promise<Uint8Array> {
  if (images.length === 0) throw new Error(t("Añade al menos una imagen para crear el PDF."));
  const doc = await createPdf();
  for (const input of images) {
    const { image } = await embedImageInput(doc, input);
    const k = LONG_SIDE_PT / Math.max(image.width, image.height);
    const w = image.width * k;
    const h = image.height * k;
    doc.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
  }
  return savePdf(doc);
}
