import { create } from "zustand";
import { produce, type Draft } from "immer";
import type { DocState, SourceInfo } from "./types";

const HISTORY_LIMIT = 200;
/** Consecutive changes with the same coalesce key within this window form one undo step. */
const COALESCE_MS = 1500;

interface DocStoreState {
  open: boolean;
  /** Display name, e.g. "contrato.pdf". */
  title: string;
  /** Where "Guardar" writes (desktop), null = ask. */
  filePath: string | null;
  sources: Record<string, SourceInfo>;
  doc: DocState;
  past: DocState[];
  future: DocState[];
  dirty: boolean;
  /** Bumped when pdf.js form values change (they live outside the undo history). */
  formRevision: number;
  coalesce: { key: string; at: number } | null;

  load(init: { title: string; filePath: string | null; sources: Record<string, SourceInfo>; doc: DocState }): void;
  close(): void;
  addSources(infos: SourceInfo[]): void;
  /** Undoable change. Pass `coalesce` for continuous edits (dragging, typing). */
  apply(recipe: (draft: Draft<DocState>) => void, opts?: { coalesce?: string }): void;
  /**
   * Change that is not an editing step: it adds no undo entry and does not mark the document
   * as modified (results computed in the background). With `history` it is also applied to
   * every undo/redo snapshot, so going back finds the result already there.
   */
  patch(recipe: (draft: Draft<DocState>) => void, opts?: { history?: boolean }): void;
  undo(): void;
  redo(): void;
  markFormChanged(): void;
  markSaved(filePath: string | null, title?: string): void;
}

const EMPTY: DocState = { pages: [], objects: [] };

export const useDocStore = create<DocStoreState>((set, get) => ({
  open: false,
  title: "",
  filePath: null,
  sources: {},
  doc: EMPTY,
  past: [],
  future: [],
  dirty: false,
  formRevision: 0,
  coalesce: null,

  load: ({ title, filePath, sources, doc }) =>
    set({ open: true, title, filePath, sources, doc, past: [], future: [], dirty: false, formRevision: 0, coalesce: null }),

  close: () =>
    set({ open: false, title: "", filePath: null, sources: {}, doc: EMPTY, past: [], future: [], dirty: false, coalesce: null }),

  addSources: (infos) => set((s) => ({ sources: { ...s.sources, ...Object.fromEntries(infos.map((i) => [i.id, i])) } })),

  apply: (recipe, opts = {}) => {
    const s = get();
    const next = produce(s.doc, recipe);
    if (next === s.doc) return;
    const now = Date.now();
    const merge = !!opts.coalesce && s.coalesce?.key === opts.coalesce && now - s.coalesce.at < COALESCE_MS;
    set({
      doc: next,
      past: merge ? s.past : [...s.past.slice(-(HISTORY_LIMIT - 1)), s.doc],
      future: [],
      dirty: true,
      coalesce: opts.coalesce ? { key: opts.coalesce, at: now } : null,
    });
  },

  patch: (recipe, opts = {}) => {
    const s = get();
    const doc = produce(s.doc, recipe);
    if (!opts.history) {
      if (doc !== s.doc) set({ doc });
      return;
    }
    const each = (list: DocState[]) => {
      const next = list.map((d) => produce(d, recipe));
      return next.some((d, i) => d !== list[i]) ? next : list;
    };
    set({ doc, past: each(s.past), future: each(s.future) });
  },

  undo: () => {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    set({ doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future], dirty: true, coalesce: null });
  },

  redo: () => {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    set({ doc: next, past: [...s.past, s.doc], future: s.future.slice(1), dirty: true, coalesce: null });
  },

  markFormChanged: () => set((s) => ({ formRevision: s.formRevision + 1, dirty: true })),

  markSaved: (filePath, title) => set((s) => ({ dirty: false, filePath, title: title ?? s.title })),
}));

/** Stop merging the next change into the current undo step (e.g. at the end of a drag). */
export function breakCoalescing(): void {
  useDocStore.setState({ coalesce: null });
}
