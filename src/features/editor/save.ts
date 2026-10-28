import { useAppStore } from "@/model/appStore";
import { useDocStore } from "@/model/docStore";
import { getAsset, getFont, getSource } from "@/model/registry";
import { baseName, platform } from "@/platform";
import { composeDocument } from "@/pdf/compose";
import { stripPdfExtension } from "@/pdf/docUtils";
import { callMupdf } from "@/pdf/mupdf/client";
import type { CompressLevel } from "@/pdf/mupdf/ops";
import { protectPdf, type ProtectOptions } from "@/pdf/protect";
import { confirmDialog, toast } from "@/ui";
import { cleanSuffix, usePrefs } from "@/model/prefs";
import { useExportPrefs } from "./exportPrefs";
import { whenErasesSettled } from "./erase";
import { t } from "@/i18n";

export interface ExportOptions {
  flattenForms: boolean;
  compress: CompressLevel | null;
  protect: ProtectOptions | null;
  /** Author written when the document has none (see Settings). */
  author?: string;
  stripMetadata?: boolean;
}

export const DEFAULT_EXPORT: ExportOptions = { flattenForms: false, compress: null, protect: null };

/** What Ctrl+S / "Guardar" uses: this document's flatten choice and the compression setting. */
export function quickSaveOptions(): ExportOptions {
  const { compress } = usePrefs.getState();
  return { ...DEFAULT_EXPORT, flattenForms: useExportPrefs.getState().flattenForms, compress: compress === "none" ? null : compress };
}

/** Metadata settings applied to every file written to disk. */
function metadataPrefs(): Pick<ExportOptions, "author" | "stripMetadata"> {
  const { author, stripMetadata } = usePrefs.getState();
  return { author, stripMetadata };
}

/** Real redaction marks (edited text also removes content, but needs no warning). */
export function hasRedactions(): boolean {
  return useDocStore.getState().doc.objects.some((o) => o.kind === "redact");
}

/** Build the final PDF bytes from the open workspace (optionally only some pages). */
export async function buildPdf(opts: ExportOptions, pageIds?: string[]): Promise<Uint8Array> {
  // Magic erasers are analysed in the background; export uses what the analysis decided.
  await whenErasesSettled();
  const full = useDocStore.getState().doc;
  const doc = pageIds ? { pages: full.pages.filter((p) => pageIds.includes(p.id)), objects: full.objects.filter((o) => pageIds.includes(o.pageId)) } : full;
  const sources: Record<string, Uint8Array> = {};
  for (const id of new Set(doc.pages.map((p) => p.sourceId).filter((x): x is string => !!x))) {
    const s = getSource(id);
    // Filled-in form values live in pdf.js' annotation storage until written out.
    sources[id] = s.pdf.annotationStorage.size > 0 ? await s.pdf.saveDocument() : s.bytes;
  }
  let bytes = await composeDocument({
    sources,
    pages: doc.pages,
    objects: doc.objects,
    asset: (id) => getAsset(id),
    font: (id) => getFont(id),
    flattenForms: opts.flattenForms,
    author: opts.author,
    stripMetadata: opts.stripMetadata,
    redact: (b, areas) => callMupdf("redact", { bytes: b, areas }),
  });
  // Installed fonts are embedded whole: trim them to the letters used.
  const usesSystemFont = doc.objects.some((o) => o.kind === "text" && o.useSourceFont && o.sourceFont && getFont(o.sourceFont)?.origin === "system");
  if (usesSystemFont) {
    try {
      bytes = await callMupdf("subsetFonts", { bytes });
    } catch {
      // Keep the larger but valid file.
    }
  }
  if (opts.compress) bytes = (await callMupdf("compress", { bytes, level: opts.compress })).bytes;
  if (opts.protect) bytes = await protectPdf(bytes, opts.protect);
  return bytes;
}

/** Save some pages as a new PDF, leaving the workspace untouched. */
export async function extractPages(pageIds: string[]): Promise<void> {
  const app = useAppStore.getState();
  app.setBusy(t("Extrayendo páginas…"));
  try {
    const bytes = await buildPdf({ ...DEFAULT_EXPORT, ...metadataPrefs() }, pageIds);
    app.setBusy(null);
    const name = `${stripPdfExtension(useDocStore.getState().title)}${t("_extraido")}.pdf`;
    const path = await platform.saveFile(bytes, { suggestedName: name, kind: "pdf", title: t("Guardar páginas extraídas") });
    if (path) toast.success(t(pageIds.length === 1 ? "{n} página extraída" : "{n} páginas extraídas", { n: pageIds.length }), { description: path });
  } catch (err) {
    toast.error(t("No se pudieron extraer las páginas"), { description: err instanceof Error ? err.message : String(err) });
  } finally {
    app.setBusy(null);
  }
}

function suggestedName(): string {
  let title = stripPdfExtension(useDocStore.getState().title.replace(/\s\(\+\d+\)$/, "")).replace(/\.(png|jpe?g|webp|gif|bmp)$/i, "");
  const suffix = cleanSuffix(usePrefs.getState().copySuffix);
  if (suffix && !title.endsWith(suffix)) title += suffix;
  const redacted = t("_redactado");
  return `${title}${hasRedactions() && !title.endsWith(redacted) ? redacted : ""}.pdf`;
}

/**
 * Save the workspace. `saveAs` (or no known path, or redactions, or the "always ask" setting)
 * asks where; otherwise the original file is overwritten, like Ctrl+S in Acrobat.
 */
export async function saveWorkspace(opts: ExportOptions = DEFAULT_EXPORT, saveAs = false): Promise<boolean> {
  const app = useAppStore.getState();
  const state = useDocStore.getState();
  const redacting = hasRedactions();
  if (redacting) {
    const ok = await confirmDialog({
      title: t("Aplicar redacciones"),
      message: t("El texto, las imágenes y los trazos bajo las zonas marcadas se eliminarán definitivamente del archivo guardado. Se guardará como una copia nueva."),
      confirmLabel: t("Redactar y guardar"),
      danger: true,
    });
    if (!ok) return false;
  }
  app.setBusy(t("Guardando…"));
  try {
    const bytes = await buildPdf({ ...metadataPrefs(), ...opts });
    const inPlace = !saveAs && usePrefs.getState().saveMode === "overwrite" && !redacting && !!state.filePath && platform.kind === "tauri";
    let path: string | null;
    if (inPlace) {
      await platform.overwriteFile(state.filePath!, bytes);
      path = state.filePath;
    } else {
      app.setBusy(null);
      path = await platform.saveFile(bytes, { suggestedName: suggestedName(), kind: "pdf", title: t("Guardar PDF") });
      if (!path) return false;
    }
    // Re-arm form change tracking (pdf.js only reports the first change).
    for (const id of Object.keys(useDocStore.getState().sources)) getSource(id).pdf.annotationStorage.resetModified();
    const savedToDisk = platform.kind === "tauri" && !!path;
    useDocStore.getState().markSaved(savedToDisk ? path : state.filePath, savedToDisk && path ? baseName(path) : undefined);
    if (savedToDisk && path) app.addRecent(path, baseName(path));
    toast.success(t("PDF guardado"), { description: savedToDisk ? path ?? undefined : t("Descargado en tu carpeta de descargas") });
    return true;
  } catch (err) {
    toast.error(t("No se pudo guardar"), { description: err instanceof Error ? err.message : String(err) });
    return false;
  } finally {
    app.setBusy(null);
  }
}
