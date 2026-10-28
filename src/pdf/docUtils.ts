import { PDFDocument } from "@cantoo/pdf-lib";

export const PRODUCER = "SnowPDF";

/**
 * Load a PDF with pdf-lib without touching its metadata (pdf-lib's default would overwrite
 * Creator/Producer with "pdf-lib"). Encrypted files must be decrypted first (MuPDF).
 */
export async function loadPdf(bytes: Uint8Array, opts: { password?: string } = {}): Promise<PDFDocument> {
  return PDFDocument.load(bytes, {
    updateMetadata: false,
    ignoreEncryption: false,
    ...(opts.password ? { password: opts.password } : {}),
  });
}

export async function createPdf(): Promise<PDFDocument> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setCreator(PRODUCER);
  doc.setCreationDate(new Date());
  return doc;
}

/** Save with object streams (smaller files) and stamp Producer/ModDate. */
export async function savePdf(doc: PDFDocument): Promise<Uint8Array> {
  doc.setProducer(PRODUCER);
  doc.setModificationDate(new Date());
  // addDefaultPage: pdf-lib would otherwise silently add a blank page to an empty document.
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}

/** "Informe final.pdf" -> "Informe final" */
export function stripPdfExtension(name: string): string {
  return name.replace(/\.pdf$/i, "");
}
