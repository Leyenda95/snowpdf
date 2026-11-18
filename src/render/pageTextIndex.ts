import { getSource } from "@/model/registry";
import { callMupdf } from "@/pdf/mupdf/client";
import { indexLayout, type TextIndex } from "./charSelection";

/*
 * Exact glyph layout of source pages for touch text selection, computed by MuPDF in its worker
 * and kept for the most recently used pages. Ask early (e.g. on pointerdown) so it's ready by the
 * time a long press fires; the first call also loads MuPDF.
 */

const MAX_PAGES = 16;
const cache = new Map<string, Promise<TextIndex>>();

export function getTextIndex(sourceId: string, pageIndex: number): Promise<TextIndex> {
  const key = `${sourceId}:${pageIndex}`;
  let entry = cache.get(key);
  if (entry) {
    // Most recently used last.
    cache.delete(key);
    cache.set(key, entry);
    return entry;
  }
  entry = callMupdf("textLayout", { bytes: getSource(sourceId).bytes, pageIndex }).then(indexLayout);
  // A failure must not stick: the next long press asks again.
  entry.catch(() => cache.delete(key));
  cache.set(key, entry);
  while (cache.size > MAX_PAGES) cache.delete(cache.keys().next().value!);
  return entry;
}

/** Forget a closed source's pages. */
export function dropTextIndex(sourceId: string): void {
  for (const key of [...cache.keys()]) if (key.startsWith(`${sourceId}:`)) cache.delete(key);
}
