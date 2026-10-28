import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useDocStore } from "@/model/docStore";
import type { PageRef } from "@/model/types";
import { MAX_ZOOM, MIN_ZOOM, useEditorStore } from "../editorStore";
import { baseSize, type PageGeometry } from "./geometry";
import { PageView } from "./PageView";

const PAD = 24;

interface ViewerProps {
  overlay: (page: PageRef, index: number, geom: PageGeometry) => ReactNode;
  underlay?: (page: PageRef, geom: PageGeometry) => ReactNode;
  textInteractive: boolean;
  formsInteractive: boolean;
  onOpenExternal: (url: string) => void;
  className?: string;
}

/** Pending scroll correction so a zoom keeps the point under the cursor fixed. */
interface Anchor {
  x: number;
  y: number;
  ratio: number;
}

let anchorRequest: Anchor | null = null;

/** Zoom around a point of the viewer (client coordinates), or its centre. */
export function zoomViewerTo(next: number, client?: { x: number; y: number }): void {
  const el = document.querySelector<HTMLElement>("[data-viewer-scroll]");
  const { zoom, setZoom } = useEditorStore.getState();
  const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
  if (el) {
    const r = el.getBoundingClientRect();
    anchorRequest = {
      x: (client?.x ?? r.left + r.width / 2) - r.left,
      y: (client?.y ?? r.top + r.height / 2) - r.top,
      ratio: target / zoom,
    };
  }
  setZoom(target, null);
}

export function Viewer({ overlay, underlay, textInteractive, formsInteractive, onOpenExternal, className }: ViewerProps) {
  const pages = useDocStore((s) => s.doc.pages);
  const zoom = useEditorStore((s) => s.zoom);
  const fit = useEditorStore((s) => s.fit);
  const scrollRequest = useEditorStore((s) => s.scrollRequest);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState<ReadonlySet<string>>(new Set());
  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set());

  // Fit modes follow the container size.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !fit || pages.length === 0) return;
    const apply = () => {
      const { currentPage } = useEditorStore.getState();
      const sizes = pages.map(baseSize);
      const maxW = Math.max(...sizes.map((s) => s.width));
      const cur = sizes[Math.min(currentPage, sizes.length - 1)];
      const availW = el.clientWidth - PAD * 2 - 16;
      const availH = el.clientHeight - PAD * 2;
      const z = fit === "width" ? Math.min(availW / maxW, 2) : Math.min(availW / cur.width, availH / cur.height);
      const s = useEditorStore.getState();
      if (Math.abs(s.zoom - z) > 0.001) s.setZoom(z, fit);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, pages]);

  // Keep the anchor point fixed after a zoom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchorRequest;
    anchorRequest = null;
    if (!el || !a) return;
    el.scrollLeft = (el.scrollLeft + a.x) * a.ratio - a.x;
    el.scrollTop = (el.scrollTop + a.y) * a.ratio - a.y;
  }, [zoom]);

  // Ctrl + wheel zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const z = useEditorStore.getState().zoom;
      zoomViewerTo(z * Math.exp(-e.deltaY * 0.0018), { x: e.clientX, y: e.clientY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Which pages are near (render) and in view (render first).
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const track = (setter: typeof setNear) => (entries: IntersectionObserverEntry[]) =>
      setter((prev) => {
        const next = new Set(prev);
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.slotId!;
          if (e.isIntersecting) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    const nearObs = new IntersectionObserver(track(setNear), { root, rootMargin: "150% 0px 150% 0px" });
    const visObs = new IntersectionObserver(track(setVisible), { root });
    root.querySelectorAll("[data-slot-id]").forEach((el) => {
      nearObs.observe(el);
      visObs.observe(el);
    });
    return () => {
      nearObs.disconnect();
      visObs.disconnect();
    };
  }, [pages]);

  // Current page = the one crossing the upper third of the viewport.
  const frame = useRef(0);
  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const root = scrollRef.current;
      if (!root) return;
      const line = root.getBoundingClientRect().top + root.clientHeight / 3;
      const slots = root.querySelectorAll<HTMLElement>("[data-slot-index]");
      for (const el of slots) {
        const r = el.getBoundingClientRect();
        if (r.bottom + 8 >= line) {
          const index = Number(el.dataset.slotIndex);
          if (useEditorStore.getState().currentPage !== index) useEditorStore.getState().setCurrentPage(index);
          break;
        }
      }
    });
  }, []);

  // "Go to page" requests.
  useEffect(() => {
    if (!scrollRequest) return;
    const root = scrollRef.current;
    const { currentPage } = useEditorStore.getState();
    const el = root?.querySelector<HTMLElement>(`[data-slot-index="${currentPage}"]`);
    if (root && el) root.scrollTo({ top: el.offsetTop - PAD + 8, behavior: "auto" });
  }, [scrollRequest]);

  const goToSourcePage = useCallback((sourceId: string, sourceIndex: number) => {
    const i = useDocStore.getState().doc.pages.findIndex((p) => p.sourceId === sourceId && p.sourceIndex === sourceIndex);
    if (i >= 0) useEditorStore.getState().goToPage(i);
  }, []);

  return (
    <div ref={scrollRef} data-viewer-scroll onScroll={onScroll} className={`relative overflow-auto bg-canvas ${className ?? ""}`}>
      <div className="flex w-max min-w-full flex-col gap-5" style={{ padding: PAD }}>
        {pages.map((page, index) => (
          <div key={page.id} className="mx-auto" data-slot-id={page.id} data-slot-index={index}>
            <PageView
              page={page}
              index={index}
              zoom={zoom}
              active={near.has(page.id)}
              priority={visible.has(page.id) ? 0 : 1}
              textInteractive={textInteractive}
              formsInteractive={formsInteractive}
              overlay={(geom) => overlay(page, index, geom)}
              underlay={underlay ? (geom) => underlay(page, geom) : undefined}
              onGoToSourcePage={goToSourcePage}
              onOpenExternal={onOpenExternal}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
