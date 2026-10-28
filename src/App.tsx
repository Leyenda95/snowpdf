import { useEffect } from "react";
import { useAppStore } from "@/model/appStore";
import { openDocuments } from "@/model/workspace";
import { closeAllTabs, hasUnsavedTabs, useTabsStore } from "@/model/tabs";
import { platform } from "@/platform";
import { AppHeader } from "@/features/shell/AppHeader";
import { useThemeEffect } from "@/features/shell/theme";
import { useLanguageEffect } from "@/features/shell/language";
import { HomePage } from "@/features/home/HomePage";
import { EditorPage } from "@/features/editor/EditorPage";
import { OrganizePage } from "@/features/organize/OrganizePage";
import { ToolPage } from "@/features/tools/ToolPage";
import { SettingsPage, openSettings } from "@/features/settings/SettingsPage";
import { restoreSession, saveSession, sessionPaths, useSessionTracking } from "@/model/session";
import { DialogHost, Spinner, Toaster, toast } from "@/ui";
import { t } from "@/i18n";

function BusyOverlay() {
  const busy = useAppStore((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/25 backdrop-blur-[1px]" role="status" aria-live="polite">
      <div className="flex items-center gap-3 rounded-xl bg-surface px-5 py-3 text-sm font-medium shadow-pop">
        <Spinner size={18} />
        {busy}
      </div>
    </div>
  );
}

/** Closing the window with unsaved documents asks first (desktop) / warns (browser). */
function useCloseGuard() {
  useEffect(() => {
    if (platform.kind === "tauri") {
      let unlisten: (() => void) | undefined;
      let closing = false;
      void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        unlisten = await win.onCloseRequested(async (event) => {
          if (closing || !hasUnsavedTabs()) return;
          event.preventDefault();
          // Closing the tabs one by one would empty the remembered session.
          const session = sessionPaths();
          if (await closeAllTabs()) {
            saveSession(session);
            closing = true;
            await win.destroy();
          }
        });
      });
      return () => unlisten?.();
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedTabs()) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
}

/** Open files passed on the command line (double-click on an associated PDF). */
function useStartupFiles() {
  useEffect(() => {
    let done = false;
    void platform.takeStartupFiles().then(async (paths) => {
      if (done) return;
      await restoreSession(paths);
      if (paths.length === 0) return;
      try {
        const files = await Promise.all(paths.map((p) => platform.readFile(p)));
        await openDocuments(files);
      } catch (err) {
        toast.error(t("No se pudo abrir el archivo"), { description: err instanceof Error ? err.message : String(err) });
      }
    });
    return () => {
      done = true;
    };
  }, []);
}

/** Ctrl+, opens the settings, like most desktop apps. */
function useSettingsShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.key !== ",") return;
      e.preventDefault();
      openSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function App() {
  useThemeEffect();
  const locale = useLanguageEffect();
  useStartupFiles();
  useCloseGuard();
  useSessionTracking();
  useSettingsShortcut();
  const view = useAppStore((s) => s.view);
  const activeTab = useTabsStore((s) => s.activeId);

  return (
    // Keyed on the language: switching it re-renders every text (the stores keep the documents).
    <div key={locale} className="flex h-full flex-col bg-app text-fg">
      {view.name === "home" && (
        <>
          <AppHeader />
          <HomePage />
        </>
      )}
      {view.name === "editor" && <EditorPage key={activeTab} />}
      {view.name === "organize" && <OrganizePage key={activeTab} />}
      {view.name === "tool" && <ToolPage key={view.toolId} toolId={view.toolId} />}
      {view.name === "settings" && (
        <>
          <AppHeader />
          <SettingsPage />
        </>
      )}
      <BusyOverlay />
      <Toaster />
      <DialogHost />
    </div>
  );
}
