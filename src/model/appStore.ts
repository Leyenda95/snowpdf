import { create } from "zustand";
import type { BatchToolId } from "@/features/tools/registry";
import { usePrefs } from "./prefs";

export type View =
  | { name: "home" }
  | { name: "editor" }
  | { name: "organize" }
  | { name: "tool"; toolId: BatchToolId }
  /** `back`: where "Volver" returns to. */
  | { name: "settings"; back: View };

export type ThemeSetting = "system" | "light" | "dark";

export interface RecentFile {
  path: string;
  name: string;
  openedAt: number;
}

interface AppState {
  view: View;
  theme: ThemeSetting;
  recent: RecentFile[];
  /** Global blocking task (e.g. "Guardando…"). */
  busy: string | null;
  navigate(view: View): void;
  setTheme(theme: ThemeSetting): void;
  addRecent(path: string, name: string): void;
  removeRecent(path: string): void;
  clearRecent(): void;
  setBusy(message: string | null): void;
}

const RECENT_KEY = "snowpdf.recent";
const THEME_KEY = "snowpdf.theme";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: settings simply won't persist.
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  view: { name: "home" },
  theme: load<ThemeSetting>(THEME_KEY, "system"),
  recent: load<RecentFile[]>(RECENT_KEY, []),
  busy: null,

  navigate: (view) => set({ view }),

  setTheme: (theme) => {
    persist(THEME_KEY, theme);
    set({ theme });
  },

  addRecent: (path, name) => {
    if (!usePrefs.getState().rememberRecent) return;
    const recent = [{ path, name, openedAt: Date.now() }, ...get().recent.filter((r) => r.path !== path)].slice(0, 12);
    persist(RECENT_KEY, recent);
    set({ recent });
  },

  removeRecent: (path) => {
    const recent = get().recent.filter((r) => r.path !== path);
    persist(RECENT_KEY, recent);
    set({ recent });
  },

  clearRecent: () => {
    persist(RECENT_KEY, []);
    set({ recent: [] });
  },

  setBusy: (busy) => set({ busy }),
}));
