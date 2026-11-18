import { useAppStore } from "@/model/appStore";
import { newId } from "@/model/registry";
import { openDocuments } from "@/model/workspace";
import { scanToPdf } from "@/pdf/scan/pdf";
import { fullQuad } from "@/pdf/scan/raster";
import type { ImageInput } from "@/pdf/tools/imagesToPdf";
import { platform } from "@/platform";
import { confirmDialog, toast } from "@/ui";
import { t } from "@/i18n";
import { callScan, closeScanEngine } from "./scanEngine";
import { useScanStore, type ScanPage } from "./scanStore";

/** Longest side of the on-screen copy of a photo. */
const PREVIEW_SIDE = 1280;
/** Longest side of the photo read for the PDF, and of the page made from it (about 290 dpi on A4). */
const SOURCE_SIDE = 4096;
const PAGE_SIDE = 2400;
const JPEG_QUALITY = 0.82;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// The worker holds the photos: let it drop those of pages that are gone, and end with the scan.
useScanStore.subscribe((s, prev) => {
  if (s.pages === prev.pages) return;
  const gone = prev.pages.filter((p) => !s.pages.some((q) => q.id === p.id)).map((p) => p.id);
  if (s.pages.length === 0) {
    if (prev.pages.length > 0) closeScanEngine();
  } else if (gone.length > 0) void callScan("drop", { pages: gone }).catch(() => undefined);
});

/**
 * A photo for a new page: an encoded image (a file, or the camera's still) or a camera frame.
 * A still may come with the frame that was on screen, in case it cannot be used.
 */
type PhotoSource = ImageBitmap | Uint8Array | { still: Uint8Array; frame: ImageBitmap | null };

async function toScanPage(photo: PhotoSource): Promise<ScanPage> {
  const id = newId("scan");
  const source = photo instanceof ImageBitmap || photo instanceof Uint8Array ? photo : photo.still;
  const backup = photo instanceof ImageBitmap || photo instanceof Uint8Array ? null : photo.frame;
  // Camera frames are handed over, not copied.
  const frames = [source, backup].filter((v) => v instanceof ImageBitmap);
  const { preview, auto } = await callScan("add", { page: id, source, backup, previewSide: PREVIEW_SIDE }, frames);
  // A new page starts with the filter of the last one: a scan usually uses the same throughout.
  const { pages } = useScanStore.getState();
  const filter = pages.length > 0 ? pages[pages.length - 1].filter : "color";
  return { id, preview, quad: auto ?? fullQuad(preview.width, preview.height), auto, filter, turns: 0 };
}

/**
 * Turns photos into pages: the first one redoes the page being retaken, if any, and the rest are
 * added. Returns whether any photo could be used. `quiet` skips the busy message (the camera
 * shows the frozen frame meanwhile).
 */
async function addPhotos(sources: PhotoSource[], quiet = false): Promise<boolean> {
  if (sources.length === 0) return false;
  const app = useAppStore.getState();
  if (!quiet) app.setBusy(t("Preparando la foto…"));
  try {
    const added: ScanPage[] = [];
    for (const source of sources) {
      try {
        added.push(await toScanPage(source));
      } catch (err) {
        toast.error(t("No se pudo leer la foto"), { description: message(err) });
      }
    }
    const scan = useScanStore.getState();
    const retake = scan.pages.some((p) => p.id === scan.retakeId) ? scan.retakeId : null;
    if (retake && added.length > 0) {
      // The extra ones first: the retaken page is the one left on screen.
      scan.add(added.slice(1));
      scan.replace(retake, added[0]);
    } else scan.add(added);
    return added.length > 0;
  } finally {
    if (!quiet) app.setBusy(null);
  }
}

/**
 * A photo just taken with the scanner's own camera: the still, if the camera took one, and the
 * frame that was on screen. Returns false if neither could be used.
 */
export async function addCameraPhoto(still: Uint8Array | null, frame: ImageBitmap | null): Promise<boolean> {
  const photo = still ? { still, frame } : frame;
  return photo ? addPhotos([photo], true) : false;
}

/** The phone's camera app, for when the scanner's own camera cannot be used. Call it from a tap handler. */
export async function takeSystemPhoto(): Promise<void> {
  try {
    const photo = await platform.capturePhoto();
    if (photo) await addPhotos([photo.bytes]);
  } catch (err) {
    toast.error(message(err));
  }
}

/** Pages from pictures already on the device. Call it from a tap handler. */
export async function pickScanPhotos(): Promise<void> {
  try {
    const files = await platform.openFiles({ kinds: ["image"], multiple: true });
    await addPhotos(files.map((f) => f.bytes));
  } catch (err) {
    toast.error(message(err));
  }
}

/** "Escanear": shows the scanner, which starts on its camera. */
export function startScan(): void {
  useAppStore.getState().navigate({ name: "scan" });
}

/** Leaves the scanner; asks first when pages would be lost. Returns false if the user stays. */
export async function leaveScan(): Promise<boolean> {
  const n = useScanStore.getState().pages.length;
  if (n > 0) {
    const ok = await confirmDialog({
      title: t("¿Descartar el escaneo?"),
      message: t(n === 1 ? "Se perderá la página escaneada." : "Se perderán las {n} páginas escaneadas.", { n }),
      confirmLabel: t("Descartar"),
      danger: true,
    });
    if (!ok) return false;
  }
  useScanStore.getState().reset();
  useAppStore.getState().navigate({ name: "home" });
  return true;
}

/**
 * Back (header arrow, Android back button). From the review it leads to the corners of the page
 * on screen, the step before it: the photo is kept whole, so the outline can always be set
 * again. From there, back again leaves the scanner. From the camera, or from corners opened any
 * other way, it returns to the pages taken so far.
 */
export function scanBack(): void {
  const s = useScanStore.getState();
  const current = s.currentId ?? s.pages[0]?.id;
  if (!current) void leaveScan();
  else if (s.step === "review") s.show(current, "crop", true);
  else if (s.step === "crop" && s.backLeaves) void leaveScan();
  else s.show(current, "review");
}

function scanName(): string {
  const d = new Date();
  const two = (v: number) => String(v).padStart(2, "0");
  const date = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}`;
  return `${t("Escaneo {date}", { date })}.pdf`;
}

/** Builds the PDF from the pages at full quality and opens it in the editor (unsaved). */
export async function finishScan(): Promise<void> {
  const { pages } = useScanStore.getState();
  if (pages.length === 0) return;
  const app = useAppStore.getState();
  try {
    const images: ImageInput[] = [];
    for (const [i, page] of pages.entries()) {
      app.setBusy(t("Creando PDF… ({n} de {total})", { n: i + 1, total: pages.length }));
      const settings = { quad: page.quad, filter: page.filter, turns: page.turns };
      images.push(await callScan("encode", { page: page.id, settings, sourceSide: SOURCE_SIDE, pageSide: PAGE_SIDE, quality: JPEG_QUALITY }));
    }
    const bytes = await scanToPdf(images);
    app.setBusy(null);
    await openDocuments([{ name: scanName(), path: null, bytes }], { view: "editor", unsaved: true });
    useScanStore.getState().reset();
  } catch (err) {
    toast.error(t("No se pudo crear el PDF"), { description: message(err) });
  } finally {
    app.setBusy(null);
  }
}
