import { useDocStore } from "@/model/docStore";
import { addObjects, deleteObjects } from "@/model/docActions";
import { newId, putAsset } from "@/model/registry";
import type { EditorObject } from "@/model/types";
import { platform } from "@/platform";
import { normalizeImage } from "@/render/imageDecode";
import { toast } from "@/ui";
import { useEditorStore } from "./editorStore";
import { t } from "@/i18n";

/** Pick a picture and let the user click where to place it. */
export async function pickImageToPlace(): Promise<void> {
  const ed = useEditorStore.getState();
  try {
    const [file] = await platform.openFiles({ kinds: ["image"], title: t("Elige una imagen") });
    if (!file) return;
    const img = await normalizeImage(file.bytes);
    const asset = putAsset(img.bytes, img.mime, img.width, img.height);
    ed.setTool("select");
    ed.setPlacing({ assetId: asset.id, signature: false });
    toast.info(t("Haz clic en la página para colocar la imagen"), { duration: 2500 });
  } catch (err) {
    toast.error(t("No se pudo cargar la imagen"), { description: err instanceof Error ? err.message : String(err) });
  }
}

/** Signature PNG chosen in the dialog -> click to place. */
export function placeSignature(sig: { bytes: Uint8Array; width: number; height: number }): void {
  const asset = putAsset(sig.bytes, "image/png", sig.width, sig.height);
  const ed = useEditorStore.getState();
  ed.setTool("select");
  ed.setPlacing({ assetId: asset.id, signature: true });
  toast.info(t("Haz clic donde quieras colocar la firma"), { duration: 2500 });
}

// ------------------------------------------------------------------ clipboard

let clipboard: EditorObject[] = [];

export function copySelection(): number {
  const { selection } = useEditorStore.getState();
  clipboard = useDocStore.getState().doc.objects.filter((o) => selection.includes(o.id)).map((o) => structuredClone(o));
  return clipboard.length;
}

export function cutSelection(): void {
  if (copySelection()) deleteObjects(useEditorStore.getState().selection);
}

export function paste(): void {
  if (!clipboard.length) return;
  const { currentPage } = useEditorStore.getState();
  const page = useDocStore.getState().doc.pages[currentPage];
  if (!page) return;
  const samePage = clipboard.every((o) => o.pageId === page.id);
  const copies = clipboard.map((o) => {
    const c = structuredClone(o) as EditorObject;
    c.id = newId("obj");
    c.pageId = page.id;
    if (samePage) {
      c.frame.cx += 12;
      c.frame.cy -= 12;
    }
    return c;
  });
  addObjects(copies);
  // Next paste goes a bit further.
  clipboard = copies.map((o) => structuredClone(o));
  useEditorStore.getState().select(copies.map((c) => c.id));
}
