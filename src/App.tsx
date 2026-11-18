import { useEffect } from "react";
import { useAppStore } from "@/model/appStore";
import { openDocuments } from "@/model/workspace";
import { closeAllTabs, hasUnsavedTabs, useTabsStore } from "@/model/tabs";
import { IS_ANDROID, platform } from "@/platform";
import { useEditorStore } from "@/features/editor/editorStore";
import { AppHeader } from "@/features/shell/AppHeader";
import { useThemeEffect } from "@/features/shell/theme";
import { useLanguageEffect } from "@/features/shell/language";
import { HomePage } from "@/features/home/HomePage";
import { EditorPage } from "@/features/editor/EditorPage";
import { OrganizePage } from "@/features/organize/OrganizePage";
import { ToolPage } from "@/features/tools/ToolPage";
import { SettingsPage, closeSettings, openSettings } from "@/features/settings/SettingsPage";
import { ScanPage } from "@/features/scan/ScanPage";
import { scanBack } from "@/features/scan/scanActions";
import { restoreSession, saveSession, sessionPaths, useSessionTracking } from "@/model/session";
import { DialogHost, Spinner, Toaster, dismissTopLayer, toast } from "@/ui";
import { t } from "@/i18n";

function BusyOverlay() {
  const busy = useAppStore((s) => s.busy);
  const blocking = !!busy;
  // The overlay stops the pointer; the keyboard must wait too. A shortcut in the middle of a
  // save (switch tab, undo, close) would act on a document that is being written.
  useEffect(() => {
    if (!blocking) return;
    const block = (e: KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("keydown", block, true);
    return () => window.removeEventListener("keydown", block, true);
  }, [blocking]);
  if (!busy) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/25 backdrop-blur-[1px]" role="status" aria-live="polite">
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
    // Android has no window close event: the back button handler covers it.
    if (platform.kind === "tauri" && IS_ANDROID) return;
    if (platform.kind === "tauri") {
      let unlisten: (() => void) | undefined;
      let disposed = false;
      let closing = false;
      void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        const stop = await win.onCloseRequested(async (event) => {
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
        // Registered after the effect was already cleaned up: nobody else would remove it.
        if (disposed) stop();
        else unlisten = stop;
      });
      return () => {
        disposed = true;
        unlisten?.();
      };
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedTabs()) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
}

/** The startup files can be taken only once (the shell forgets them), whatever React does with the effect. */
let startupTaken = false;
/** Settles once the session and the startup files are open; files arriving later wait for it. */
let startupDone: Promise<void> = Promise.resolve();

/** Open files passed on the command line (double-click on an associated PDF). */
function useStartupFiles() {
  useEffect(() => {
    if (startupTaken) return;
    startupTaken = true;
    startupDone = platform.takeStartupFiles().then(async (paths) => {
      await restoreSession(paths);
      if (paths.length === 0) return;
      try {
        const files = await Promise.all(paths.map((p) => platform.readFile(p)));
        await openDocuments(files);
      } catch (err) {
        toast.error(t("No se pudo abrir el archivo"), { description: err instanceof Error ? err.message : String(err) });
      }
    });
  }, []);
}

/**
 * Files that arrive while the app is already running: a second launch on desktop (double-click on
 * another PDF hands them to this window) or "Abrir con" on Android.
 */
function useIncomingFiles() {
  useEffect(() => {
    let busy = false;
    let again = false;
    const check = async () => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        await startupDone;
        do {
          again = false;
          const paths = await platform.takeStartupFiles();
          if (paths.length === 0) continue;
          const files = await Promise.all(paths.map((p) => platform.readFile(p)));
          await openDocuments(files);
        } while (again);
      } catch (err) {
        toast.error(t("No se pudo abrir el archivo"), { description: err instanceof Error ? err.message : String(err) });
      } finally {
        busy = false;
      }
    };
    return platform.onIncomingFiles(() => void check());
  }, []);
}

/**
 * Android back button. Closes the top layer, then steps back through the editor state and the
 * views; on the home screen it needs a second press (within 2 s) to leave the app, which is done
 * by dropping the JS listener so the native default (finish the activity) takes over.
 */
function useAndroidBackButton() {
  useEffect(() => {
    if (!(platform.kind === "tauri" && IS_ANDROID)) return;
    let disposed = false;
    let unregister: (() => Promise<void>) | undefined;
    let rearm: ReturnType<typeof setTimeout> | undefined;
    let stopRearm: (() => void) | undefined;
    let registering = false;

    const onBack = () => {
      const app = useAppStore.getState();
      // Mid-save or mid-open: wait for it.
      if (app.busy) return;
      if (dismissTopLayer()) return;
      const view = app.view.name;
      if (view === "editor") {
        const ed = useEditorStore.getState();
        if (ed.placing) return ed.setPlacing(null);
        if (ed.selection.length > 0) return ed.select([]);
      }
      if (view === "scan") return scanBack();
      if (view === "settings") return closeSettings();
      if (view === "organize") return app.navigate({ name: "editor" });
      if (view !== "home") return app.navigate({ name: "home" });
      toast.info(hasUnsavedTabs() ? t("Tienes documentos sin guardar. Pulsa atrás otra vez para salir sin guardar.") : t("Pulsa atrás otra vez para salir"));
      void drop();
      // The exit window closes after 2 s, or at once if the user goes somewhere else meanwhile
      // (back must then step back from there, not leave the app).
      const listenAgain = () => {
        clearTimeout(rearm);
        stopWatching();
        void register();
      };
      const stopWatching = useAppStore.subscribe((s) => {
        if (s.view.name !== "home") listenAgain();
      });
      rearm = setTimeout(listenAgain, 2000);
      stopRearm = stopWatching;
    };

    const drop = async () => {
      const u = unregister;
      unregister = undefined;
      await u?.();
    };

    const register = async () => {
      if (disposed || registering || unregister) return;
      registering = true;
      try {
        const { onBackButtonPress } = await import("@tauri-apps/api/app");
        const listener = await onBackButtonPress(onBack);
        if (disposed) await listener.unregister();
        else unregister = () => listener.unregister();
      } catch {
        // No back button support: the system default applies.
      } finally {
        registering = false;
      }
    };

    void register();
    return () => {
      disposed = true;
      clearTimeout(rearm);
      stopRearm?.();
      void drop();
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
  useIncomingFiles();
  useAndroidBackButton();
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
      {view.name === "scan" && <ScanPage />}
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
