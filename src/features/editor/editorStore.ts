import { create } from "zustand";
import type { FontAsset, FontFamily, Frame, SymbolName } from "@/model/types";
import { openingView, usePrefs } from "@/model/prefs";
import { closestFace, findSystemFamily, loadSystemFace } from "@/render/systemFonts";

export type EditorTool =
  | "select"
  | "hand"
  | "text"
  | "editText"
  | "image"
  | "signature"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "ink"
  | "highlight"
  | "whiteout"
  | "redact"
  | "erase"
  | "symbol"
  | "date";

export interface ToolStyles {
  text: {
    font: FontFamily;
    size: number;
    color: string;
    bold: boolean;
    italic: boolean;
    align: "left" | "center" | "right";
    /** Family of the last text's installed or document font, or null for `font` alone. */
    systemFamily: string | null;
    /** Registered FontAsset new texts use (installed regular face or the document font). */
    systemFont: string | null;
  };
  shape: { stroke: string | null; fill: string | null; strokeWidth: number; opacity: number };
  line: { stroke: string; strokeWidth: number; dashed: boolean; opacity: number };
  ink: { color: string; strokeWidth: number; opacity: number };
  highlight: { color: string; opacity: number };
  whiteout: { color: string };
  redact: { color: string };
  symbol: { symbol: SymbolName; color: string; size: number };
  date: { format: "dd/mm/yyyy" | "d de mmmm de yyyy" | "yyyy-mm-dd" };
}

export const DEFAULT_STYLES: ToolStyles = {
  text: { font: "helvetica", size: 12, color: "#111827", bold: false, italic: false, align: "left", systemFamily: null, systemFont: null },
  shape: { stroke: "#dc2626", fill: null, strokeWidth: 2, opacity: 1 },
  line: { stroke: "#dc2626", strokeWidth: 2, dashed: false, opacity: 1 },
  ink: { color: "#1d4ed8", strokeWidth: 2, opacity: 1 },
  highlight: { color: "#facc15", opacity: 0.45 },
  whiteout: { color: "#ffffff" },
  redact: { color: "#000000" },
  symbol: { symbol: "check", color: "#111827", size: 16 },
  date: { format: "dd/mm/yyyy" },
};

/** Left panel: only the search remains there (page thumbnails live in the right column). */
export type SidebarPanel = "search" | null;

interface EditorState {
  tool: EditorTool;
  /** Image/signature waiting to be placed with a click. */
  placing: { assetId: string; signature: boolean } | null;
  selection: string[];
  /** Text object whose content is being typed. */
  editingId: string | null;
  /** 1 = 100 %. */
  zoom: number;
  fit: "width" | "page" | null;
  currentPage: number;
  sidebar: SidebarPanel;
  /** Page thumbnails in the right column. */
  thumbnails: boolean;
  showProps: boolean;
  styles: ToolStyles;
  /** Page the viewer should scroll to; the viewer clears it once applied. */
  scrollRequest: number | null;
  /** Last scroll offset of the viewer (CSS px), written by the viewer; tabs restore it. */
  scroll: { top: number; left: number };
  /** Search result shown briefly on a page. */
  flash: { pageId: string; frames: Frame[]; at: number } | null;
  /** Signature dialog visibility (opened by the toolbar or the "Firmar" tool). */
  signatureDialog: boolean;
  /** Acrobat-like "Herramientas" pane on the left (remembered across sessions). */
  toolsPanel: boolean;
  /** Entry of the "Herramientas" pane to open as soon as the pane is shown (from the home page). */
  toolRequest: string | null;

  reset(tool?: EditorTool): void;
  setTool(tool: EditorTool): void;
  setPlacing(p: EditorState["placing"]): void;
  select(ids: string[]): void;
  setEditing(id: string | null): void;
  setZoom(zoom: number, fit?: EditorState["fit"]): void;
  setCurrentPage(index: number): void;
  setScroll(scroll: { top: number; left: number }): void;
  goToPage(index: number): void;
  setSidebar(panel: SidebarPanel): void;
  setThumbnails(open: boolean): void;
  toggleProps(): void;
  setStyle<K extends keyof ToolStyles>(key: K, patch: Partial<ToolStyles[K]>): void;
  setFlash(flash: EditorState["flash"]): void;
  setSignatureDialog(open: boolean): void;
  setToolsPanel(open: boolean): void;
  /** Open the "Herramientas" pane on one of its entries (DOC_TOOLS id). */
  requestDocTool(id: string | null): void;
}

const TOOLS_PANEL_KEY = "snowpdf.toolsPanel";

function loadToolsPanel(): boolean {
  try {
    return localStorage.getItem(TOOLS_PANEL_KEY) === "1";
  } catch {
    return false;
  }
}

const STYLES_KEY = "snowpdf.toolStyles";

const TEXT_DEFAULT_KEYS = ["size", "font", "color", "systemFamily", "systemFont"] as const;

function pickTextDefaults(patch: Partial<ToolStyles["text"]>): Partial<ToolStyles["text"]> {
  return Object.fromEntries(TEXT_DEFAULT_KEYS.filter((k) => k in patch).map((k) => [k, patch[k]]));
}

/**
 * Remember the font for new texts, whatever its kind: a standard family; an installed family
 * (its regular face); or a document font, replaced by the same family when it is installed
 * (complete) and otherwise used as is (missing letters fall back to the standard font).
 */
export async function rememberTextFont(font: { standard: FontFamily } | { system: string } | { document: FontAsset }): Promise<void> {
  const { setStyle } = useEditorStore.getState();
  if ("standard" in font) {
    setStyle("text", { font: font.standard, systemFamily: null, systemFont: null });
    return;
  }
  const name = "system" in font ? font.system : font.document.family;
  setStyle("text", { systemFamily: name, systemFont: "document" in font ? font.document.id : null });
  const family = await findSystemFamily(name);
  if (!family) return;
  const asset = await loadSystemFace(family.family, closestFace(family, 400, false)).catch(() => null);
  if (asset && useEditorStore.getState().styles.text.systemFamily === name) setStyle("text", { systemFont: asset.id });
}

/** Text style a document starts from before its own typography is known. */
export function defaultTextStyle(): ToolStyles["text"] {
  return { ...DEFAULT_STYLES.text, size: usePrefs.getState().textSize };
}

function loadStyles(): ToolStyles {
  try {
    const raw = localStorage.getItem(STYLES_KEY);
    if (!raw) return { ...DEFAULT_STYLES, text: defaultTextStyle() };
    const saved = JSON.parse(raw) as Partial<ToolStyles>;
    const merged = { ...DEFAULT_STYLES } as Record<string, unknown>;
    for (const k of Object.keys(DEFAULT_STYLES) as (keyof ToolStyles)[]) {
      merged[k] = { ...DEFAULT_STYLES[k], ...(saved[k] ?? {}) };
    }
    // Text defaults belong to each open document (see tabs.ts), never to the saved styles.
    merged.text = defaultTextStyle();
    return merged as unknown as ToolStyles;
  } catch {
    return { ...DEFAULT_STYLES, text: defaultTextStyle() };
  }
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 6;

export const useEditorStore = create<EditorState>((set, get) => ({
  tool: "select",
  placing: null,
  selection: [],
  editingId: null,
  zoom: 1,
  fit: "width",
  currentPage: 0,
  sidebar: null,
  thumbnails: true,
  showProps: true,
  styles: loadStyles(),
  scrollRequest: null,
  scroll: { top: 0, left: 0 },
  flash: null,
  signatureDialog: false,
  toolsPanel: loadToolsPanel(),
  toolRequest: null,

  reset: (tool = "select") =>
    set({ tool, placing: null, selection: [], editingId: null, sidebar: null, ...openingView(), currentPage: 0, scrollRequest: null, scroll: { top: 0, left: 0 }, flash: null, signatureDialog: tool === "signature" }),
  // Leaving "edit text" clears the selection: edited texts are page content in the other tools.
  setTool: (tool) =>
    set({ tool, placing: tool === get().tool ? get().placing : null, editingId: null, selection: tool === "select" && get().tool !== "editText" ? get().selection : [] }),
  setPlacing: (placing) => set({ placing }),
  select: (selection) => set({ selection, editingId: selection.includes(get().editingId ?? "") ? get().editingId : null }),
  setEditing: (editingId) => set({ editingId, selection: editingId ? [editingId] : get().selection }),
  setZoom: (zoom, fit = null) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)), fit }),
  setCurrentPage: (currentPage) => set({ currentPage }),
  setScroll: (scroll) => set({ scroll }),
  goToPage: (index) => set({ currentPage: index, scrollRequest: index }),
  setSidebar: (sidebar) => set({ sidebar }),
  setThumbnails: (thumbnails) => set({ thumbnails }),
  toggleProps: () => set((s) => ({ showProps: !s.showProps })),
  setStyle: (key, patch) => {
    // Text defaults: size, font and colour are remembered between texts (not bold/italic).
    const next = key === "text" ? pickTextDefaults(patch as Partial<ToolStyles["text"]>) : patch;
    const styles = { ...get().styles, [key]: { ...get().styles[key], ...next } };
    try {
      localStorage.setItem(STYLES_KEY, JSON.stringify(styles));
    } catch {
      // Not persisted: fine.
    }
    set({ styles });
  },
  setFlash: (flash) => set({ flash }),
  setSignatureDialog: (signatureDialog) => set({ signatureDialog }),
  setToolsPanel: (toolsPanel) => {
    try {
      localStorage.setItem(TOOLS_PANEL_KEY, toolsPanel ? "1" : "0");
    } catch {
      // Not persisted: fine.
    }
    set({ toolsPanel });
  },
  // Shows the pane for this once, without changing the remembered open/closed preference.
  requestDocTool: (toolRequest) => set({ toolRequest, toolsPanel: true }),
}));

