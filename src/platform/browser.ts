import { zipSync } from "fflate";
import { EXTENSIONS, SAVE_FILTERS, type OutputFile, type PickedFile, type Platform } from "./types";
import { t } from "@/i18n";

/** Browser fallback (development and future PWA): everything stays in the tab's memory. */

function pickWithInput(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

export async function filesToPicked(files: File[]): Promise<PickedFile[]> {
  return Promise.all(
    files.map(async (f) => ({ name: f.name, path: null, bytes: new Uint8Array(await f.arrayBuffer()) })),
  );
}

function download(bytes: Uint8Array, name: string, mime: string): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const browserPlatform: Platform = {
  kind: "browser",

  async openFiles({ kinds, multiple = false }) {
    const accept = kinds.flatMap((k) => EXTENSIONS[k].map((e) => `.${e}`)).join(",");
    return filesToPicked(await pickWithInput(accept, multiple));
  },

  async saveFile(bytes, { suggestedName, kind }) {
    download(bytes, suggestedName, SAVE_FILTERS[kind].mime);
    return suggestedName;
  },

  async overwriteFile() {
    throw new Error(t("Guardar sobre el archivo original solo está disponible en la app de escritorio."));
  },

  async saveFiles(files: OutputFile[], { zipName }) {
    if (files.length === 1) {
      download(files[0].bytes, files[0].name, "application/octet-stream");
      return files[0].name;
    }
    const entries: Record<string, Uint8Array> = {};
    for (const f of files) {
      let name = f.name;
      for (let i = 1; name in entries; i++) name = f.name.replace(/(\.[^.]+)?$/, ` (${i})$1`);
      entries[name] = f.bytes;
    }
    download(zipSync(entries, { level: 0 }), zipName, SAVE_FILTERS.zip.mime);
    return zipName;
  },

  async readFile(path) {
    throw new Error(t("No se puede leer {path} desde el navegador.", { path }));
  },

  async takeStartupFiles() {
    return [];
  },

  async listSystemFonts() {
    return [];
  },
};
