import { create } from "zustand";
import type { CharRange } from "@/render/charSelection";

/** Phone text selection over exact glyph boxes (see `render/charSelection.ts`). */
export interface TouchSel {
  pageId: string;
  sourceId: string;
  sourceIndex: number;
  range: CharRange;
}

interface TouchSelectionState {
  sel: TouchSel | null;
  set(sel: TouchSel | null): void;
  clear(): void;
}

export const useTouchSelection = create<TouchSelectionState>((set, get) => ({
  sel: null,
  set: (sel) => set({ sel }),
  clear: () => {
    if (get().sel) set({ sel: null });
  },
}));

export function clearTouchSelection(): void {
  useTouchSelection.getState().clear();
}
