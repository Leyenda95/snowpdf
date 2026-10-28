import { kindOfName, type PickedFile } from "@/platform";
import { callMupdf, MupdfPasswordError } from "@/pdf/mupdf/client";
import { loadPdfjs, looksEncrypted } from "@/render/pdfjs";
import { normalizeImage } from "@/render/imageDecode";
import { promptDialog } from "@/ui";
import type { ToolFile } from "./types";
import { t } from "@/i18n";

/** Loading helpers: decode, decrypt (asking for passwords) and thumbnail the files a tool receives. */

/** Width in pixels of the generated thumbnails (they are shown at up to ~300 px). */
const THUMB_WIDTH = 420;
const MAX_THUMB_HEIGHT = 640;

let counter = 0;

/** Thrown internally when the user dismisses a password prompt. */
class Cancelled extends Error {}

/** Asks for the password until it is right; resolves with the decrypted bytes. */
async function decryptInteractively(name: string, bytes: Uint8Array): Promise<{ bytes: Uint8Array; wasEncrypted: boolean }> {
  if (!looksEncrypted(bytes)) return { bytes, wasEncrypted: false };
  let info;
  try {
    info = await callMupdf("inspect", { bytes });
  } catch {
    // Damaged file: let the tool (or the repair tool) deal with it.
    return { bytes, wasEncrypted: false };
  }
  if (!info.encrypted) return { bytes, wasEncrypted: false };
  // Owner-password-only files open without a password: remove the restrictions silently.
  if (!info.needsPassword) return { bytes: await callMupdf("decrypt", { bytes }), wasEncrypted: true };
  for (let attempt = 0; ; attempt++) {
    const password = await promptDialog({
      title: t("PDF protegido"),
      message: attempt === 0 ? t("«{name}» necesita contraseña para abrirse.", { name }) : t("La contraseña no es correcta. Inténtalo de nuevo."),
      label: t("Contraseña"),
      type: "password",
      confirmLabel: t("Abrir"),
    });
    if (password === null) throw new Cancelled();
    try {
      return { bytes: await callMupdf("decrypt", { bytes, password }), wasEncrypted: true };
    } catch (err) {
      if (!(err instanceof MupdfPasswordError)) throw err;
    }
  }
}

interface FirstPage {
  pageCount: number;
  pageSize: { width: number; height: number };
  thumbUrl: string;
}

/** Page count and first-page thumbnail with pdf.js; null when pdf.js cannot open the file. */
async function readFirstPage(bytes: Uint8Array): Promise<FirstPage | null> {
  let pdf;
  try {
    pdf = await loadPdfjs(bytes);
  } catch {
    return null;
  }
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(THUMB_WIDTH / base.width, MAX_THUMB_HEIGHT / base.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    await page.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return null;
    return { pageCount: pdf.numPages, pageSize: { width: base.width, height: base.height }, thumbUrl: URL.createObjectURL(blob) };
  } catch {
    return null;
  } finally {
    void pdf.loadingTask.destroy();
  }
}

/**
 * Turns a picked file into a ToolFile. Resolves to null when the user cancels the password
 * prompt. Throws a readable error for files that are not usable.
 */
export async function loadToolFile(picked: PickedFile): Promise<ToolFile | null> {
  const kind = kindOfName(picked.name);
  if (!kind) throw new Error(t("Tipo de archivo no admitido."));
  const id = `f${++counter}`;

  if (kind === "image") {
    let image;
    try {
      image = await normalizeImage(picked.bytes);
    } catch {
      throw new Error(t("No se pudo leer la imagen: el archivo está dañado o su formato no es compatible."));
    }
    const url = URL.createObjectURL(new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type: image.mime }));
    return {
      id,
      name: picked.name,
      kind,
      bytes: image.bytes,
      mime: image.mime,
      size: picked.bytes.length,
      pageCount: 1,
      pageSize: { width: image.width, height: image.height },
      thumbUrl: url,
      wasEncrypted: false,
      unreadable: false,
    };
  }

  let decrypted;
  try {
    decrypted = await decryptInteractively(picked.name, picked.bytes);
  } catch (err) {
    if (err instanceof Cancelled) return null;
    throw err;
  }
  const first = await readFirstPage(decrypted.bytes);
  return {
    id,
    name: picked.name,
    kind,
    bytes: decrypted.bytes,
    size: decrypted.bytes.length,
    pageCount: first?.pageCount ?? null,
    pageSize: first?.pageSize ?? null,
    thumbUrl: first?.thumbUrl ?? null,
    wasEncrypted: decrypted.wasEncrypted,
    unreadable: first === null,
  };
}

export function releaseFile(file: ToolFile): void {
  if (file.thumbUrl) URL.revokeObjectURL(file.thumbUrl);
}
