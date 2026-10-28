import { kindOfName, platform, type PickedFile } from "@/platform";
import { useAppStore } from "./appStore";
import { useDocStore } from "./docStore";
import { insertPages } from "./docActions";
import { newId, putSource } from "./registry";
import { abortTab, beginTab, commitTab, switchTab, useTabsStore } from "./tabs";
import type { PageRef, PdfBox, Rotation, SourceInfo } from "./types";
import { loadPdfjs, looksEncrypted } from "@/render/pdfjs";
import { normalizeImage } from "@/render/imageDecode";
import { callMupdf, MupdfPasswordError } from "@/pdf/mupdf/client";
import { createPdf, savePdf } from "@/pdf/docUtils";
import { useEditorStore } from "@/features/editor/editorStore";
import { promptDialog, toast } from "@/ui";
import { t } from "@/i18n";

export interface OpenDocumentsOptions {
  view?: "editor" | "organize";
  /** Several files become one document (organize/merge) instead of one tab each. */
  combine?: boolean;
}

class Cancelled extends Error {}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Ask for the password until it is right; resolve with decrypted bytes. */
async function decryptInteractively(file: PickedFile): Promise<Uint8Array> {
  const info = await callMupdf("inspect", { bytes: file.bytes });
  if (!info.encrypted) return file.bytes;
  if (!info.needsPassword) return callMupdf("decrypt", { bytes: file.bytes });
  for (let attempt = 0; ; attempt++) {
    const password = await promptDialog({
      title: t("PDF protegido"),
      message: attempt === 0 ? t("«{name}» necesita contraseña para abrirse.", { name: file.name }) : t("La contraseña no es correcta. Inténtalo de nuevo."),
      label: t("Contraseña"),
      type: "password",
      confirmLabel: t("Abrir"),
    });
    if (password === null) throw new Cancelled();
    try {
      return await callMupdf("decrypt", { bytes: file.bytes, password });
    } catch (err) {
      if (!(err instanceof MupdfPasswordError)) throw err;
    }
  }
}

/** A picture opened as a document becomes a one-page PDF (longest side ≤ A4). */
async function imageToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const img = await normalizeImage(bytes);
  const doc = await createPdf();
  const embedded = img.mime === "image/png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
  const scale = Math.min(0.75, 842 / Math.max(img.width, img.height));
  const w = img.width * scale;
  const h = img.height * scale;
  doc.addPage([w, h]).drawImage(embedded, { x: 0, y: 0, width: w, height: h });
  return savePdf(doc);
}

/** Load a file as a new source: registers it and returns its pages. */
export async function loadSource(file: PickedFile): Promise<{ info: SourceInfo; pages: PageRef[] }> {
  const kind = kindOfName(file.name) ?? "pdf";
  let bytes = kind === "image" ? await imageToPdf(file.bytes) : file.bytes;
  let wasEncrypted = false;
  if (kind === "pdf" && looksEncrypted(bytes)) {
    const decrypted = await decryptInteractively(file);
    wasEncrypted = decrypted !== bytes;
    bytes = decrypted;
  }
  const pdf = await loadPdfjs(bytes);
  const id = newId("src");
  putSource(id, bytes, pdf);
  // Typing in a form field happens in the visible tab, so it marks the active document.
  (pdf.annotationStorage as { onSetModified: (() => void) | null }).onSetModified = () => useDocStore.getState().markFormChanged();

  const fields = await pdf.getFieldObjects().catch(() => null);
  const pages: PageRef[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    pages.push({
      id: newId("pg"),
      sourceId: id,
      sourceIndex: i - 1,
      baseRotation: (((page.rotate % 360) + 360) % 360) as Rotation,
      rotation: 0,
      view: [...page.view] as PdfBox,
      crop: null,
    });
  }
  const info: SourceInfo = {
    id,
    name: file.name,
    path: kind === "pdf" ? file.path : null,
    size: file.bytes.length,
    pageCount: pdf.numPages,
    wasEncrypted,
    hasForm: !!fields && fields.size > 0,
  };
  return { info, pages };
}

/**
 * Load PDFs (and images, converted to pages) into a new tab and show it. Several files given
 * together become one document (pages in order); a file that is already open is just focused.
 */
export async function openDocuments(files: PickedFile[], opts: OpenDocumentsOptions = {}): Promise<void> {
  if (files.length === 0) return;
  if (files.length > 1 && !opts.combine) {
    for (const f of files) await openDocuments([f], opts);
    return;
  }
  const app = useAppStore.getState();
  if (files.length === 1 && files[0].path) {
    const existing = findTabWithPath(files[0].path);
    if (existing) {
      switchTab(existing);
      if (opts.view) app.navigate({ name: opts.view });
      return;
    }
  }
  const tabId = beginTab();
  app.setBusy(files.length > 1 ? t("Abriendo {n} archivos…", { n: files.length }) : t("Abriendo «{name}»…", { name: files[0].name }));
  try {
    const loaded: { info: SourceInfo; pages: PageRef[] }[] = [];
    for (const f of files) {
      try {
        loaded.push(await loadSource(f));
      } catch (err) {
        if (!(err instanceof Cancelled)) toast.error(t("No se pudo abrir «{name}»", { name: f.name }), { description: message(err) });
      }
    }
    if (loaded.length === 0) {
      abortTab(tabId);
      return;
    }
    const first = loaded[0].info;
    commitTab(
      tabId,
      {
        title: loaded.length === 1 ? first.name : `${first.name} (+${loaded.length - 1})`,
        filePath: loaded.length === 1 && !first.wasEncrypted ? first.path : null,
        sources: Object.fromEntries(loaded.map((l) => [l.info.id, l.info])),
        doc: { pages: loaded.flatMap((l) => l.pages), objects: [] },
        dirty: loaded.length > 1,
      },
      opts.view ?? "editor",
    );
    useEditorStore.getState().reset();
    app.navigate({ name: opts.view ?? "editor" });
    for (const l of loaded) if (l.info.path) app.addRecent(l.info.path, l.info.name);
    if (first.wasEncrypted) toast.info(t("Documento desbloqueado"), { description: t("Al guardar puedes volver a protegerlo con contraseña.") });
  } finally {
    app.setBusy(null);
  }
}

function findTabWithPath(path: string): string | null {
  const norm = (p: string | null | undefined) => (p ?? "").replace(/\//g, "\\").toLowerCase();
  const { tabs, activeId } = useTabsStore.getState();
  for (const t of tabs) {
    const filePath = t.id === activeId ? useDocStore.getState().filePath : t.doc?.filePath;
    if (filePath && norm(filePath) === norm(path)) return t.id;
  }
  return null;
}

/** Insert the pages of other files into the open workspace. Returns how many pages were added. */
export async function addFilesToWorkspace(files: PickedFile[], atIndex: number): Promise<number> {
  const app = useAppStore.getState();
  app.setBusy(t("Añadiendo páginas…"));
  try {
    let index = atIndex;
    let added = 0;
    for (const f of files) {
      try {
        const { info, pages } = await loadSource(f);
        useDocStore.getState().addSources([info]);
        insertPages(index, pages);
        index += pages.length;
        added += pages.length;
      } catch (err) {
        if (!(err instanceof Cancelled)) toast.error(t("No se pudo añadir «{name}»", { name: f.name }), { description: message(err) });
      }
    }
    return added;
  } finally {
    app.setBusy(null);
  }
}

/** Re-open a file from the recent list (desktop). */
export async function openRecent(path: string): Promise<void> {
  const file = await platform.readFile(path);
  await openDocuments([file]);
}
