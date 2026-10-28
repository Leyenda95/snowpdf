import { create } from "zustand";
import type { CompressLevel } from "@/pdf/mupdf/ops";

/**
 * User preferences (Settings screen). Settings that already have a home elsewhere are NOT
 * duplicated here: theme and recent files live in appStore, the tools pane and the date
 * format live in editorStore.
 */
export interface Prefs {
  /** Desktop: reopen the files that were open when the app was closed. */
  restoreTabs: boolean;
  /** Files dropped onto an open document. */
  dropAction: "ask" | "insert" | "tab";
  initialZoom: "width" | "page" | "actual";
  /** Page thumbnails sidebar when a document opens. */
  showThumbnails: boolean;
  /** Written as the PDF author on save when the document has none ("" = off). */
  author: string;
  /** Size of new texts in a document with no text to learn from (e.g. a scan). */
  textSize: number;
  /** "Editar texto" tries to reuse the document's own font. */
  useSourceFont: boolean;
  /** Ctrl+S: overwrite the original file, or always ask where to save. */
  saveMode: "overwrite" | "ask";
  /** Appended to the suggested file name when saving a copy (e.g. "_editado"). */
  copySuffix: string;
  /** Compression applied by Ctrl+S and preselected in "Guardar como". */
  compress: CompressLevel | "none";
  /** Initial "Aplanar formulario" choice for each opened document. */
  flattenForms: boolean;
  /** Remove the document properties (Info dictionary and XMP) when saving. */
  stripMetadata: boolean;
  rememberRecent: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  restoreTabs: false,
  dropAction: "ask",
  initialZoom: "width",
  showThumbnails: true,
  author: "",
  textSize: 12,
  useSourceFont: true,
  saveMode: "overwrite",
  copySuffix: "",
  compress: "none",
  flattenForms: false,
  stripMetadata: false,
  rememberRecent: true,
};

const ALLOWED: { [K in keyof Prefs]?: readonly Prefs[K][] } = {
  dropAction: ["ask", "insert", "tab"],
  initialZoom: ["width", "page", "actual"],
  saveMode: ["overwrite", "ask"],
  compress: ["none", "low", "medium", "high"],
};

const PREFS_KEY = "snowpdf.prefs";

/** Characters Windows does not allow in file names. */
export function cleanSuffix(text: string): string {
  return text.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").slice(0, 40);
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, unknown> = { ...DEFAULT_PREFS };
    for (const key of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
      const value = saved[key];
      const allowed = ALLOWED[key] as readonly unknown[] | undefined;
      if (typeof value !== typeof DEFAULT_PREFS[key]) continue;
      if (allowed && !allowed.includes(value)) continue;
      out[key] = value;
    }
    out.copySuffix = cleanSuffix(out.copySuffix as string);
    const size = out.textSize as number;
    if (!(size >= 4 && size <= 400)) out.textSize = DEFAULT_PREFS.textSize;
    return out as unknown as Prefs;
  } catch {
    return DEFAULT_PREFS;
  }
}

interface PrefsState extends Prefs {
  setPrefs(patch: Partial<Prefs>): void;
}

export const usePrefs = create<PrefsState>((set, get) => ({
  ...loadPrefs(),
  setPrefs: (patch) => {
    set(patch);
    const state = get();
    const prefs = Object.fromEntries(Object.keys(DEFAULT_PREFS).map((k) => [k, state[k as keyof Prefs]]));
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Storage unavailable: settings simply won't persist.
    }
  },
}));

/** Editor view state for a freshly opened document. */
export function openingView(): { fit: "width" | "page" | null; zoom?: number; thumbnails: boolean } {
  const { initialZoom, showThumbnails } = usePrefs.getState();
  const thumbnails = showThumbnails;
  return initialZoom === "actual" ? { fit: null, zoom: 1, thumbnails } : { fit: initialZoom, thumbnails };
}
