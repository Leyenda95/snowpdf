import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { join } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
import { exists, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { browserPlatform, filesToPicked, pickWithInput } from "./browser";
import { zipFiles } from "./zip";
import { EXTENSIONS, IS_ANDROID, SAVE_FILTERS, baseName, type FileKind, type SaveKind, type OutputFile, type PickedFile, type Platform } from "./types";
import { t } from "@/i18n";

function openFilters(kinds: FileKind[]) {
  const filters = kinds.map((k) => ({
    name: k === "pdf" ? t("Documentos PDF") : t("Imágenes"),
    extensions: EXTENSIONS[k],
  }));
  if (kinds.length > 1) {
    filters.unshift({ name: t("Compatibles"), extensions: kinds.flatMap((k) => EXTENSIONS[k]) });
  }
  return filters;
}

async function uniquePath(dir: string, name: string): Promise<string> {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = await join(dir, name);
  for (let i = 1; await exists(candidate); i++) {
    candidate = await join(dir, `${stem} (${i})${ext}`);
  }
  return candidate;
}

export const tauriPlatform: Platform = {
  kind: "tauri",

  async openFiles({ kinds, multiple = false, title }) {
    if (IS_ANDROID) {
      // The dialog plugin only returns opaque content:// URIs on Android; the HTML picker gives real names.
      const accept = kinds.flatMap((k) => [...EXTENSIONS[k].map((e) => `.${e}`), k === "pdf" ? "application/pdf" : "image/*"]).join(",");
      return filesToPicked(await pickWithInput(accept, multiple));
    }
    const picked = await open({ multiple, directory: false, title, filters: openFilters(kinds) });
    if (!picked) return [];
    const paths = Array.isArray(picked) ? picked : [picked];
    return Promise.all(paths.map((p) => this.readFile(p)));
  },

  async saveFile(bytes, { suggestedName, kind, title }) {
    const f = SAVE_FILTERS[kind];
    const path = await save({
      title,
      defaultPath: suggestedName,
      filters: [{ name: t(f.name), extensions: f.extensions }],
    });
    if (!path) return null;
    await writeFile(path, bytes);
    return path;
  },

  // The WebView's own file chooser launches the camera app (no camera permission involved).
  capturePhoto: () => browserPlatform.capturePhoto(),

  async overwriteFile(path, bytes) {
    await writeFile(path, bytes);
  },

  async saveFiles(files: OutputFile[], { title, zipName }) {
    if (IS_ANDROID) {
      // Folder picking is not available on mobile: one file is saved as is, several go in a ZIP.
      if (files.length === 1) {
        const ext = files[0].name.split(".").pop()?.toLowerCase() ?? "";
        const kind: SaveKind = ext === "jpeg" ? "jpg" : ext in SAVE_FILTERS ? (ext as SaveKind) : "pdf";
        return this.saveFile(files[0].bytes, { suggestedName: files[0].name, kind, title });
      }
      return this.saveFile(zipFiles(files), { suggestedName: zipName, kind: "zip", title });
    }
    const dir = await open({ directory: true, multiple: false, title: title ?? t("Elige la carpeta de destino") });
    if (!dir || Array.isArray(dir)) return null;
    for (const f of files) {
      await writeFile(await uniquePath(dir, f.name), f.bytes);
    }
    return dir;
  },

  async readFile(path): Promise<PickedFile> {
    const bytes = await readFile(path);
    // Temporary copies of files received from other apps must not be overwritten by "Guardar".
    const temporary = IS_ANDROID && path.replace(/\\/g, "/").includes("/cache/incoming/");
    return { name: baseName(path), path: temporary ? null : path, bytes: new Uint8Array(bytes) };
  },

  async takeStartupFiles() {
    try {
      return await invoke<string[]>("take_startup_files");
    } catch {
      return [];
    }
  },

  onIncomingFiles(handler) {
    if (IS_ANDROID) {
      // MainActivity leaves the shared files while the app is in the background.
      const check = () => {
        if (document.visibilityState === "visible") handler();
      };
      document.addEventListener("visibilitychange", check);
      return () => document.removeEventListener("visibilitychange", check);
    }
    // Desktop: the shell emits this when a second launch handed over its files.
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("incoming-files", () => handler()).then((stop) => {
      if (disposed) return stop();
      unlisten = stop;
      // Anything queued before the listener existed.
      handler();
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  },

  async openExternalUrl(url) {
    await openUrl(url);
  },

  async listSystemFonts() {
    try {
      const fonts = await invoke<[string, string][]>("list_system_fonts");
      return fonts.map(([name, path]) => ({ name, path }));
    } catch {
      return [];
    }
  },
};
