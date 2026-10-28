import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/** pdf.js setup for the browser. Assets are served locally from public/pdfjs (no network). */

GlobalWorkerOptions.workerSrc = workerSrc;

const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;

/** CSS pixels per PDF point at 100 % zoom (same convention as Acrobat and pdf.js). */
export const PDF_TO_CSS = 96 / 72;

export function loadPdfjs(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({
    // pdf.js transfers the buffer to its worker: hand it a copy so ours stays usable.
    data: bytes.slice(),
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
    enableXfa: false,
    // Keep font programs (and their names) on the main thread: "edit text" reuses them.
    fontExtraProperties: true,
  }).promise;
}

/** Cheap check for an /Encrypt entry in the trailer(s), avoiding loading MuPDF for normal files. */
export function looksEncrypted(bytes: Uint8Array): boolean {
  const needle = [0x2f, 0x45, 0x6e, 0x63, 0x72, 0x79, 0x70, 0x74]; // "/Encrypt"
  const scan = (from: number, to: number) => {
    outer: for (let i = Math.max(0, from); i <= Math.min(bytes.length, to) - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
      return true;
    }
    return false;
  };
  return scan(0, 64 * 1024) || scan(bytes.length - 256 * 1024, bytes.length);
}
