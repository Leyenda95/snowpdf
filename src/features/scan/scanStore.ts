import { create } from "zustand";
import type { Raster } from "@/pdf/inpaint";
import type { ScanFilter } from "@/pdf/scan/enhance";
import type { Quad } from "@/pdf/scan/raster";

/**
 * One photographed sheet of the scan in progress. The session is short-lived and never
 * snapshotted (no undo, no tabs), so unlike documents its pixels live right here in the store.
 */
export interface ScanPage {
  /** Also names the photo as taken, which the scan worker keeps (the PDF is made from it). */
  id: string;
  /** Reduced copy for the screen (RGBA, upright). `quad` and `auto` are in its pixels. */
  preview: Raster;
  /** The sheet's corners as currently set. */
  quad: Quad;
  /** The corners found automatically, if any. */
  auto: Quad | null;
  filter: ScanFilter;
  /** Clockwise quarter turns. */
  turns: number;
}

/**
 * "camera": taking the next photo. "crop": adjusting the corners of the current page, on the
 * whole photo (nothing is ever cut off it: the corners can be set again at any time).
 * "review": filters, order, more pages. Without pages there is only the camera.
 */
export type ScanStep = "camera" | "crop" | "review";

interface ScanState {
  pages: ScanPage[];
  currentId: string | null;
  step: ScanStep;
  /** On the camera: the page the next photo replaces, when it is a retake. */
  retakeId: string | null;
  /**
   * On the corners screen: whether going back leaves the scan. It does when the screen was
   * reached by going back from the review; otherwise back returns to the review.
   */
  backLeaves: boolean;
  /** Shows the camera, for one more page or to redo `retakeId`. */
  camera(retakeId?: string): void;
  /** Adds pages at the end and shows the first of them for cropping. */
  add(pages: ScanPage[]): void;
  /** Swaps a page for a new photo of the same sheet, keeping its place. */
  replace(id: string, page: ScanPage): void;
  update(id: string, patch: Partial<Pick<ScanPage, "quad" | "filter" | "turns">>): void;
  remove(id: string): void;
  /** Shows a page. `backLeaves`: see the field (only for "crop"). */
  show(id: string, step: ScanStep, backLeaves?: boolean): void;
  reset(): void;
}

export const useScanStore = create<ScanState>((set) => ({
  pages: [],
  currentId: null,
  step: "camera",
  retakeId: null,
  backLeaves: false,
  camera: (retakeId) => set({ step: "camera", retakeId: retakeId ?? null, backLeaves: false }),
  add: (added) => {
    if (added.length > 0) set((s) => ({ pages: [...s.pages, ...added], currentId: added[0].id, step: "crop", retakeId: null, backLeaves: false }));
  },
  replace: (id, page) =>
    set((s) => ({ pages: s.pages.map((p) => (p.id === id ? page : p)), currentId: page.id, step: "crop", retakeId: null, backLeaves: false })),
  update: (id, patch) => set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
  remove: (id) =>
    set((s) => {
      const index = s.pages.findIndex((p) => p.id === id);
      const pages = s.pages.filter((p) => p.id !== id);
      const next = pages[Math.min(index, pages.length - 1)];
      return { pages, currentId: s.currentId === id ? (next?.id ?? null) : s.currentId, step: pages.length > 0 ? "review" : "camera", retakeId: null, backLeaves: false };
    }),
  show: (currentId, step, backLeaves = false) => set({ currentId, step, retakeId: null, backLeaves: step === "crop" && backLeaves }),
  reset: () => set({ pages: [], currentId: null, step: "camera", retakeId: null, backLeaves: false }),
}));

/** The page on screen. */
export function currentScanPage(s: Pick<ScanState, "pages" | "currentId">): ScanPage | null {
  return s.pages.find((p) => p.id === s.currentId) ?? null;
}
