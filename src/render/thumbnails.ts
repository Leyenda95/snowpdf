import { AnnotationMode } from "pdfjs-dist";
import { getSource } from "@/model/registry";
import { enqueueRender } from "./renderQueue";
import { t } from "@/i18n";

/**
 * Page thumbnails rendered once per source page (with the page's own /Rotate) and cached as
 * object URLs. Extra user rotation is applied with CSS, so rotating in the organizer is free.
 */

const THUMB_WIDTH = 220;
const cache = new Map<string, Promise<string>>();

export function thumbnailKey(sourceId: string, index: number): string {
  return `${sourceId}:${index}`;
}

export function getThumbnail(sourceId: string, index: number, priority = 10): Promise<string> {
  const key = thumbnailKey(sourceId, index);
  let url = cache.get(key);
  if (!url) {
    url = new Promise<string>((resolve, reject) => {
      const job = enqueueRender(async () => {
        const page = await getSource(sourceId).pdf.getPage(index + 1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (THUMB_WIDTH * 1.5) / Math.max(base.width, base.height) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport, annotationMode: AnnotationMode.ENABLE }).promise;
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
        if (!blob) throw new Error(t("No se pudo generar la miniatura"));
        resolve(URL.createObjectURL(blob));
      }, priority);
      job.promise.catch(reject);
    });
    url.catch(() => cache.delete(key));
    cache.set(key, url);
  }
  return url;
}

/** Forget thumbnails of a source (its rendering changed, e.g. after filling a form). */
export function invalidateThumbnails(sourceId: string): void {
  for (const [key, url] of cache) {
    if (!key.startsWith(`${sourceId}:`)) continue;
    void url.then(URL.revokeObjectURL, () => undefined);
    cache.delete(key);
  }
}

export function clearThumbnails(): void {
  for (const url of cache.values()) void url.then(URL.revokeObjectURL, () => undefined);
  cache.clear();
}
