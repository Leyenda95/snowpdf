/**
 * Tiny scroll signal for the viewer. Pages that need to react to scrolling (the phone's
 * high-resolution detail canvas) subscribe here instead of holding React state, so a scroll frame
 * never re-renders every PageView.
 */
const listeners = new Set<() => void>();

export function notifyViewerScroll(): void {
  for (const l of listeners) l();
}

export function subscribeViewerScroll(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Zoom animation state shared with the pages: sharp re-renders wait while the content is scaled. */
export const viewerZoom = { animating: false };
