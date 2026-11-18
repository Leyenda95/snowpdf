import { useDocStore } from "@/model/docStore";
import { addObjects, deleteObjects } from "@/model/docActions";
import { keepEntry, newId, putAsset, releaseOwner } from "@/model/registry";
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
const CLIPBOARD_OWNER = "clipboard";

/** Images and fonts (registry ids) an object needs. */
function registryIds(o: EditorObject): string[] {
  const ids = o.kind === "text" ? [o.sourceFont, o.documentFont] : "assetId" in o ? [o.assetId] : [];
  return ids.filter((id): id is string => !!id);
}

/**
 * A copy that can live on any page of any document: what tied the original to its own page is
 * dropped. An edited line no longer replaces (and removes on export) the original text under
 * it, nor carries its links, and a magic eraser is analysed again where it lands.
 */
function detached(o: EditorObject): EditorObject {
  const c = structuredClone(o) as EditorObject;
  if (c.kind === "text" && c.replaces) {
    c.replaces = null;
    c.links = null;
    // The fill only hid the original line.
    c.background = null;
  }
  if (c.kind === "erase") {
    c.method = null;
    c.assetId = null;
    c.renderBox = null;
  }
  return c;
}

export function copySelection(): number {
  const { selection } = useEditorStore.getState();
  const picked = useDocStore.getState().doc.objects.filter((o) => selection.includes(o.id));
  if (picked.length === 0) return 0;
  clipboard = picked.map(detached);
  // The clipboard outlives its document: it keeps what the copies need until the next copy.
  const ids = clipboard.flatMap(registryIds);
  for (const id of ids) keepEntry(id, "clipboard-next");
  releaseOwner(CLIPBOARD_OWNER);
  for (const id of ids) keepEntry(id, CLIPBOARD_OWNER);
  releaseOwner("clipboard-next");
  return clipboard.length;
}

export function cutSelection(): void {
  if (!copySelection()) return;
  const ed = useEditorStore.getState();
  deleteObjects(ed.selection);
  ed.select([]);
}

export function paste(): void {
  if (!clipboard.length) return;
  const { currentPage } = useEditorStore.getState();
  const page = useDocStore.getState().doc.pages[currentPage];
  if (!page) return;
  const samePage = clipboard.every((o) => o.pageId === page.id);
  const copies = clipboard.map((o) => {
    const c = detached(o);
    c.id = newId("obj");
    c.pageId = page.id;
    // The document pasted into now uses these too.
    for (const id of registryIds(c)) keepEntry(id);
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
