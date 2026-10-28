import { EncryptedPDFError, type PDFDocument } from "@cantoo/pdf-lib";
import { createPdf, loadPdf, savePdf, stripPdfExtension } from "@/pdf/docUtils";
import { copyPagesWithFields } from "@/pdf/acroform";
import { setOutline, type OutlineItem } from "@/pdf/outline";
import { appendImagePage, type ImagePageSize } from "./imagesToPdf";
import { t } from "@/i18n";

export interface MergeInput {
  /** File name, used for bookmarks and error messages. */
  name: string;
  bytes: Uint8Array;
  kind: "pdf" | "image";
  /** Declared type of an image input (the real format is sniffed from the bytes anyway). */
  mime?: "image/png" | "image/jpeg";
  /** 0-based subset (and order) of pages to take from a PDF input; all pages when omitted. */
  pages?: number[];
}

export interface MergeOptions {
  /** One bookmark per input, titled with the file name without extension. */
  bookmarks?: boolean;
  /** Page size for image inputs; default "A4". */
  imagePageSize?: ImagePageSize;
}

/** Margin around images placed on A4/Letter pages. */
const IMAGE_MARGIN = 36;

/**
 * Open a source PDF for copying. Problems come out as readable Spanish errors that name the
 * file, instead of pdf-lib's parser messages.
 */
export async function openSourcePdf(bytes: Uint8Array, name: string): Promise<PDFDocument> {
  try {
    return await loadPdf(bytes);
  } catch (err) {
    if (err instanceof EncryptedPDFError) {
      throw new Error(t('"{name}" está protegido con contraseña. Desbloquéalo antes de usarlo.', { name }));
    }
    throw new Error(t('No se pudo leer "{name}": el archivo está dañado o no es un PDF válido.', { name }));
  }
}

/** "Informe final.pdf" / "foto.JPG" -> "Informe final" / "foto" */
function bookmarkTitle(name: string, position: number): string {
  const title = stripPdfExtension(name).replace(/\.(png|jpe?g)$/i, "").trim();
  return title === "" ? t("Documento {n}", { n: position }) : title;
}

/**
 * Join PDFs and images into one PDF, in the order given. Page rotation and form fields are
 * preserved; every image becomes one page.
 *
 * @throws Error (Spanish message) when there is nothing to merge or an input cannot be read.
 */
export async function mergeDocuments(inputs: MergeInput[], opts: MergeOptions = {}): Promise<Uint8Array> {
  if (inputs.length === 0) throw new Error(t("Añade al menos un archivo para unir."));

  const out = await createPdf();
  const imageSize = opts.imagePageSize ?? "A4";
  const outline: OutlineItem[] = [];

  for (const [position, input] of inputs.entries()) {
    const firstPage = out.getPageCount();

    if (input.kind === "image") {
      await appendImagePage(
        out,
        { bytes: input.bytes, mime: input.mime ?? "image/jpeg", name: input.name },
        { pageSize: imageSize, orientation: "auto", margin: imageSize === "fit" ? 0 : IMAGE_MARGIN },
      );
    } else {
      const src = await openSourcePdf(input.bytes, input.name);
      const pageCount = src.getPageCount();
      const indices = input.pages ?? src.getPageIndices();
      const missing = indices.find((i) => !Number.isInteger(i) || i < 0 || i >= pageCount);
      if (missing !== undefined) {
        throw new RangeError(t('En "{name}": la página {n} no existe (el documento tiene {total}).', { name: input.name, n: missing + 1, total: pageCount }));
      }
      const pages = await copyPagesWithFields(out, src, indices);
      for (const page of pages) out.addPage(page);
    }

    if (opts.bookmarks && out.getPageCount() > firstPage) {
      outline.push({ title: bookmarkTitle(input.name, position + 1), pageIndex: firstPage });
    }
  }

  if (out.getPageCount() === 0) throw new Error(t("Los archivos seleccionados no tienen páginas que unir."));
  if (outline.length > 0) setOutline(out, outline);
  return savePdf(out);
}
