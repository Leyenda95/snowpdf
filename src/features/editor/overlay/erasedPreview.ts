import { useEffect, useState } from "react";
import { getSource } from "@/model/registry";
import type { PageRef, PdfBox } from "@/model/types";
import { callMupdf } from "@/pdf/mupdf/client";

/**
 * On-screen preview of "edit text": the page zone as it looks once the original glyphs are
 * removed (what export does), instead of a flat patch of the sampled background colour. The
 * render comes from the same engine as the magic eraser, limited to removing glyphs.
 */

export interface ErasedPreview {
  url: string;
  /** User-space box the picture covers. */
  box: PdfBox;
}

/** Previews are small pictures; keep the most recent ones. */
const CACHE_LIMIT = 80;
const cache = new Map<string, Promise<ErasedPreview | null>>();
const urls = new Map<string, string>();

const round = (v: number) => Math.round(v * 100) / 100;

function previewFor(page: PageRef, box: PdfBox): Promise<ErasedPreview | null> | null {
  if (!page.sourceId) return null;
  const key = `${page.sourceId}:${page.sourceIndex}:${box.map(round).join(",")}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      try {
        const res = await callMupdf("eraseRegion", {
          bytes: getSource(page.sourceId!).bytes,
          pageIndex: page.sourceIndex,
          box,
          maxMethod: "text",
        });
        // "none": the glyphs could not be removed cleanly (a scan, a textured background...).
        if (res.method !== "text") return null;
        const url = URL.createObjectURL(new Blob([res.png as Uint8Array<ArrayBuffer>], { type: "image/png" }));
        urls.set(key, url);
        return { url, box: res.box };
      } catch {
        return null;
      }
    })();
    cache.set(key, hit);
    if (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value as string;
      cache.delete(oldest);
      const url = urls.get(oldest);
      if (url) URL.revokeObjectURL(url);
      urls.delete(oldest);
    }
  }
  return hit;
}

/** The preview of `box` on `page`, or null while it is being made (or when it cannot be). */
export function useErasedPreview(page: PageRef, box: PdfBox): ErasedPreview | null {
  const [state, setState] = useState<{ key: string; preview: ErasedPreview | null } | null>(null);
  const key = `${page.id}:${box.map(round).join(",")}`;
  useEffect(() => {
    let alive = true;
    previewFor(page, box)?.then((preview) => alive && setState({ key, preview }));
    return () => {
      alive = false;
    };
    // `box` and `page` are identified by the key and the page's source position.
  }, [key, page.sourceId, page.sourceIndex]);
  return state?.key === key ? state.preview : null;
}
