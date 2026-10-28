import { useEffect } from "react";
import { platform } from "@/platform";
import { useDocStore } from "./docStore";
import { usePrefs } from "./prefs";
import { useTabsStore } from "./tabs";
import { openDocuments } from "./workspace";

/**
 * "Restaurar las pestañas abiertas" (desktop only): the paths of the open tabs that are saved
 * on disk are remembered, and reopened at the next start. Unsaved changes are never restored:
 * the file is read again from disk.
 */

const SESSION_KEY = "snowpdf.session";

/** Paths on disk of the open tabs, in tab order. */
export function sessionPaths(): string[] {
  const { tabs, activeId } = useTabsStore.getState();
  const paths: string[] = [];
  for (const t of tabs) {
    const path = t.id === activeId ? useDocStore.getState().filePath : t.doc?.filePath;
    if (path && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

export function saveSession(paths: string[]): void {
  try {
    if (paths.length && usePrefs.getState().restoreTabs) localStorage.setItem(SESSION_KEY, JSON.stringify(paths));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Not persisted: fine.
  }
}

function loadSession(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** Keeps the stored session in sync with the open tabs. Mount once, in <App />. */
export function useSessionTracking(): void {
  useEffect(() => {
    if (platform.kind !== "tauri") return;
    let last = "";
    const sync = () => {
      const paths = sessionPaths();
      const key = `${usePrefs.getState().restoreTabs}|${paths.join("\n")}`;
      if (key === last) return;
      last = key;
      saveSession(paths);
    };
    const unsubs = [useTabsStore.subscribe(sync), useDocStore.subscribe(sync), usePrefs.subscribe(sync)];
    return () => unsubs.forEach((u) => u());
  }, []);
}

/** Reopen the previous session's files (skipping `skip`, e.g. files passed on the command line). */
export async function restoreSession(skip: string[]): Promise<void> {
  if (platform.kind !== "tauri" || !usePrefs.getState().restoreTabs) return;
  const norm = (p: string) => p.replace(/\//g, "\\").toLowerCase();
  const skipped = new Set(skip.map(norm));
  for (const path of loadSession()) {
    if (skipped.has(norm(path))) continue;
    try {
      await openDocuments([await platform.readFile(path)]);
    } catch {
      // Moved or deleted since: skip it.
    }
  }
}
