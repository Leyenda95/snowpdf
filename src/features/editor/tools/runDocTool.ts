import { useAppStore } from "@/model/appStore";
import { useDocStore } from "@/model/docStore";
import { getSource, hasSource } from "@/model/registry";
import { loadSource } from "@/model/workspace";
import { platform } from "@/platform";
import type { ToolFile, ToolModule, ToolResult } from "@/features/tools/types";
import { messageOf, uniqueOutputs } from "@/features/tools/utils";
import { confirmDialog, toast } from "@/ui";
import { useEditorStore } from "../editorStore";
import { DEFAULT_EXPORT, buildPdf, hasRedactions } from "../save";
import { baseSize } from "../viewer/geometry";
import { t } from "@/i18n";

/**
 * Runs the batch tool modules (src/features/tools/options) on the document open in the editor:
 * the workspace is composed into one PDF, the module processes it, and the result either
 * replaces the workspace content (undoable) or is saved as new file(s).
 */

export type DocToolMode = "replace" | "save";

/**
 * Stand-in for the open document while the options are shown: page count and first-page size
 * come from the live workspace; the bytes are those of the first page's source (enough for
 * reading metadata). The real bytes are composed when the tool runs.
 */
export function previewFile(): ToolFile | null {
  const { doc, title } = useDocStore.getState();
  const first = doc.pages[0];
  if (!first) return null;
  const bytes = first.sourceId && hasSource(first.sourceId) ? getSource(first.sourceId).bytes : new Uint8Array();
  return {
    id: `doc_${first.sourceId ?? "blank"}`,
    name: title || "documento.pdf",
    kind: "pdf",
    bytes,
    size: bytes.length,
    pageCount: doc.pages.length,
    pageSize: baseSize(first),
    thumbUrl: null,
    wasEncrypted: false,
    unreadable: false,
  };
}

/** Compose the workspace into PDF bytes, keeping the preview's identity. */
async function composedFile(preview: ToolFile): Promise<ToolFile> {
  const bytes = await buildPdf(DEFAULT_EXPORT);
  return { ...preview, bytes, size: bytes.length };
}

/**
 * Replace the pages of the workspace with the pages of `bytes` (objects are already baked in).
 * It is one undo step: the previous pages and their source stay registered, so Ctrl+Z restores
 * them exactly.
 */
export async function replaceWorkspaceWith(bytes: Uint8Array): Promise<void> {
  const { info, pages } = await loadSource({ name: useDocStore.getState().title, path: null, bytes });
  const store = useDocStore.getState();
  store.addSources([info]);
  store.apply((d) => {
    d.pages = pages;
    d.objects = [];
  });
  const ed = useEditorStore.getState();
  ed.setPlacing(null);
  ed.select([]);
  ed.goToPage(Math.min(ed.currentPage, Math.max(0, pages.length - 1)));
}

/** Pending redactions get applied by composing: say so, and stop "Guardar" overwriting the original. */
async function confirmRedactions(): Promise<boolean> {
  if (!hasRedactions()) return true;
  const ok = await confirmDialog({
    title: t("Aplicar redacciones"),
    message:
      t("Para usar esta herramienta se aplicarán las redacciones marcadas: el contenido bajo ellas se eliminará. Al guardar se te preguntará dónde, para no sobrescribir el original."),
    confirmLabel: t("Aplicar y continuar"),
    danger: true,
  });
  if (ok) useDocStore.setState({ filePath: null });
  return ok;
}

async function saveOutputs(result: ToolResult): Promise<void> {
  const outputs = uniqueOutputs(result.outputs);
  if (outputs.length === 0) {
    toast.info(result.summary);
    return;
  }
  const single = outputs.length === 1 ? outputs[0] : null;
  const where = single
    ? await platform.saveFile(single.bytes, { suggestedName: single.name, kind: single.kind })
    : await platform.saveFiles(
        outputs.map(({ name, bytes }) => ({ name, bytes })),
        { zipName: result.zipName },
      );
  if (where) toast.success(result.summary, { description: where });
}

/**
 * Run `mod` on the open document. Resolves true when something was applied or saved.
 * `mode` "replace" swaps the workspace content for the (single PDF) result.
 */
export async function runDocTool<O>(mod: ToolModule<O>, options: O, mode: DocToolMode): Promise<boolean> {
  const preview = previewFile();
  if (!preview) return false;
  if (mode === "replace" && !(await confirmRedactions())) return false;
  const app = useAppStore.getState();
  app.setBusy(t("Preparando el documento…"));
  try {
    const file = await composedFile(preview);
    const result = await mod.run([file], options, {
      onProgress: (fraction, label) => {
        const text = label ?? useAppStore.getState().busy ?? t("Procesando…");
        const base = text.replace(/\s\d+\s%$/, "");
        app.setBusy(fraction === undefined ? base : `${base} ${Math.round(fraction * 100)} %`);
      },
    });
    for (const w of result.warnings) toast.info(w);
    if (mode === "save") {
      app.setBusy(null);
      await saveOutputs(result);
      return true;
    }
    const out = result.outputs.find((o) => o.kind === "pdf");
    if (!out || out.bytes === file.bytes) {
      // Nothing changed (e.g. the file was already compressed as much as it can be).
      toast.info(result.summary);
      return false;
    }
    app.setBusy(t("Actualizando el documento…"));
    await replaceWorkspaceWith(out.bytes);
    toast.success(result.summary, { description: t("Puedes deshacerlo con Ctrl+Z.") });
    return true;
  } catch (err) {
    toast.error(t("No se pudo completar la operación"), { description: messageOf(err) });
    return false;
  } finally {
    app.setBusy(null);
  }
}
