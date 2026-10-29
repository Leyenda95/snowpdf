import { create } from "zustand";
import { useAppStore } from "./appStore";
import { useDocStore } from "./docStore";
import { usePrefs } from "./prefs";
import { newId, releaseOwner, setRegistryOwner } from "./registry";
import type { DocState, SourceInfo } from "./types";
import { documentTextStyle } from "@/features/editor/docTypography";
import { defaultTextStyle, useEditorStore, type ToolStyles } from "@/features/editor/editorStore";
import { useExportPrefs } from "@/features/editor/exportPrefs";
import { invalidateThumbnails } from "@/render/thumbnails";
import { clearTextCache } from "@/render/textContent";
import { confirmDialog } from "@/ui";
import { t } from "@/i18n";

/**
 * Several open documents. The active tab lives in the regular stores (docStore, editorStore);
 * inactive tabs keep a snapshot of that state, swapped in when they are activated. Each tab
 * owns the sources/assets it registered, released when the tab closes.
 */

type DocSnapshot = Pick<
  ReturnType<typeof useDocStore.getState>,
  "open" | "title" | "filePath" | "sources" | "doc" | "past" | "future" | "dirty" | "formRevision"
>;

type EditorSnapshot = Pick<
  ReturnType<typeof useEditorStore.getState>,
  "tool" | "placing" | "selection" | "zoom" | "fit" | "currentPage" | "scroll" | "sidebar" | "thumbnails" | "showProps"
>;

export interface Tab {
  id: string;
  view: "editor" | "organize";
  /** Only for inactive tabs. */
  doc?: DocSnapshot;
  editor?: EditorSnapshot;
  /** Style of new texts: each document has its own (see docTypography.ts). */
  textStyle?: ToolStyles["text"];
  flattenForms?: boolean;
}

interface TabsState {
  tabs: Tab[];
  activeId: string | null;
}

export const useTabsStore = create<TabsState>(() => ({ tabs: [], activeId: null }));

/** Store the live state of the active tab into its entry. */
function stashActive(): void {
  const { activeId, tabs } = useTabsStore.getState();
  if (!activeId) return;
  const d = useDocStore.getState();
  const e = useEditorStore.getState();
  const app = useAppStore.getState().view.name;
  const tab: Tab = {
    id: activeId,
    view: app === "editor" || app === "organize" ? app : (tabs.find((t) => t.id === activeId)?.view ?? "editor"),
    doc: { open: d.open, title: d.title, filePath: d.filePath, sources: d.sources, doc: d.doc, past: d.past, future: d.future, dirty: d.dirty, formRevision: d.formRevision },
    editor: { tool: e.tool, placing: e.placing, selection: e.selection, zoom: e.zoom, fit: e.fit, currentPage: e.currentPage, scroll: e.scroll, sidebar: e.sidebar, thumbnails: e.thumbnails, showProps: e.showProps },
    textStyle: e.styles.text,
    flattenForms: useExportPrefs.getState().flattenForms,
  };
  useTabsStore.setState({ tabs: tabs.map((t) => (t.id === activeId ? tab : t)) });
}

function restore(tab: Tab): void {
  if (tab.doc) useDocStore.setState({ ...tab.doc, coalesce: null });
  if (tab.editor) {
    useEditorStore.setState((s) => ({
      ...tab.editor!,
      styles: { ...s.styles, text: tab.textStyle ?? defaultTextStyle() },
      editingId: null,
      flash: null,
      signatureDialog: false,
      scrollRequest: null,
    }));
  }
  useExportPrefs.getState().set({ flattenForms: tab.flattenForms ?? false });
  setRegistryOwner(tab.id);
  useTabsStore.setState((s) => ({
    activeId: tab.id,
    tabs: s.tabs.map((t) => (t.id === tab.id ? { id: t.id, view: t.view } : t)),
  }));
}

// ------------------------------------------------------------------ opening

/** Reserve an id for a tab about to be loaded: sources registered from now on belong to it. */
export function beginTab(): string {
  const id = newId("tab");
  setRegistryOwner(id);
  return id;
}

/** Loading failed or was cancelled: free what was registered and go back to the active tab. */
export function abortTab(id: string): void {
  releaseOwner(id);
  setRegistryOwner(useTabsStore.getState().activeId ?? "default");
}

/** Show a freshly loaded document in its new tab. */
export function commitTab(
  id: string,
  init: { title: string; filePath: string | null; sources: Record<string, SourceInfo>; doc: DocState; dirty?: boolean },
  view: Tab["view"],
): void {
  stashActive();
  useDocStore.getState().load(init);
  if (init.dirty) useDocStore.setState({ dirty: true });
  useExportPrefs.getState().set({ flattenForms: usePrefs.getState().flattenForms });
  useTabsStore.setState((s) => ({ tabs: [...s.tabs, { id, view }], activeId: id }));
  setRegistryOwner(id);
  // New texts start from the defaults, then from this document's own typography.
  useEditorStore.setState((s) => ({ styles: { ...s.styles, text: defaultTextStyle() } }));
  void documentTextStyle(init.doc.pages)
    .then((style) => style && applyTextStyle(id, style))
    .catch(() => undefined);
}

/** Merge into a tab's text style, whether it is active (live store) or stashed. */
function applyTextStyle(tabId: string, style: Partial<ToolStyles["text"]>): void {
  if (useTabsStore.getState().activeId === tabId) {
    useEditorStore.setState((s) => ({ styles: { ...s.styles, text: { ...s.styles.text, ...style } } }));
    return;
  }
  useTabsStore.setState((s) => ({
    tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, textStyle: { ...(t.textStyle ?? defaultTextStyle()), ...style } } : t)),
  }));
}

// ------------------------------------------------------------------ switching / closing

export function switchTab(id: string): void {
  const { activeId, tabs } = useTabsStore.getState();
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  if (id !== activeId) {
    stashActive();
    restore(useTabsStore.getState().tabs.find((t) => t.id === id)!);
  }
  useAppStore.getState().navigate({ name: tab.view });
}

export function cycleTab(step: 1 | -1): void {
  const { tabs, activeId } = useTabsStore.getState();
  if (tabs.length < 2) return;
  const i = tabs.findIndex((t) => t.id === activeId);
  switchTab(tabs[(i + step + tabs.length) % tabs.length].id);
}

export function tabTitle(tab: Tab): { title: string; dirty: boolean } {
  if (tab.id === useTabsStore.getState().activeId) {
    const d = useDocStore.getState();
    return { title: d.title, dirty: d.dirty };
  }
  return { title: tab.doc?.title ?? "", dirty: !!tab.doc?.dirty };
}

/** Close a tab (asking first when it has unsaved changes). Resolves false if cancelled. */
export async function closeTab(id: string): Promise<boolean> {
  const { tabs, activeId } = useTabsStore.getState();
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return true;
  const { title, dirty } = tabTitle(tab);
  if (dirty) {
    const ok = await confirmDialog({
      title: t("¿Cerrar sin guardar?"),
      message: t("Hay cambios sin guardar en «{title}». Si cierras se perderán.", { title }),
      confirmLabel: t("Cerrar sin guardar"),
      danger: true,
    });
    if (!ok) return false;
  }
  for (const sourceId of releaseOwner(id)) {
    invalidateThumbnails(sourceId);
    clearTextCache(sourceId);
  }
  const index = tabs.findIndex((t) => t.id === id);
  const rest = tabs.filter((t) => t.id !== id);
  useTabsStore.setState({ tabs: rest });
  if (id !== activeId) return true;

  const next = rest[Math.min(index, rest.length - 1)];
  if (next) {
    restore(next);
    if (useAppStore.getState().view.name !== "home") useAppStore.getState().navigate({ name: next.view });
  } else {
    useTabsStore.setState({ activeId: null });
    useDocStore.getState().close();
    setRegistryOwner("default");
    useAppStore.getState().navigate({ name: "home" });
  }
  return true;
}

/** Ask about every unsaved tab (used before quitting). Resolves false if any is kept. */
export async function closeAllTabs(): Promise<boolean> {
  for (const t of [...useTabsStore.getState().tabs]) {
    if (!(await closeTab(t.id))) return false;
  }
  return true;
}

export function hasUnsavedTabs(): boolean {
  return useTabsStore.getState().tabs.some((t) => tabTitle(t).dirty);
}
