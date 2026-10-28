import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
import { exists, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { EXTENSIONS, SAVE_FILTERS, baseName, type FileKind, type OutputFile, type PickedFile, type Platform } from "./types";
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

  async overwriteFile(path, bytes) {
    await writeFile(path, bytes);
  },

  async saveFiles(files: OutputFile[], { title }) {
    const dir = await open({ directory: true, multiple: false, title: title ?? t("Elige la carpeta de destino") });
    if (!dir || Array.isArray(dir)) return null;
    for (const f of files) {
      await writeFile(await uniquePath(dir, f.name), f.bytes);
    }
    return dir;
  },

  async readFile(path): Promise<PickedFile> {
    const bytes = await readFile(path);
    return { name: baseName(path), path, bytes: new Uint8Array(bytes) };
  },

  async takeStartupFiles() {
    try {
      return await invoke<string[]>("take_startup_files");
    } catch {
      return [];
    }
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
