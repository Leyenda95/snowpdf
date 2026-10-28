import type { Msg } from "@/i18n";

export type FileKind = "pdf" | "image";

export interface PickedFile {
  name: string;
  /** Absolute path on disk (desktop) or null (browser / drag & drop). */
  path: string | null;
  bytes: Uint8Array;
}

export interface OpenOptions {
  kinds: FileKind[];
  multiple?: boolean;
  title?: string;
}

export type SaveKind = "pdf" | "zip" | "png" | "jpg" | "txt";

export interface SaveOptions {
  suggestedName: string;
  kind: SaveKind;
  title?: string;
}

export interface OutputFile {
  name: string;
  bytes: Uint8Array;
}

export interface Platform {
  readonly kind: "tauri" | "browser";
  /** Resolves to [] when the user cancels. */
  openFiles(opts: OpenOptions): Promise<PickedFile[]>;
  /** Asks where to save. Resolves to the saved path/name, or null when cancelled. */
  saveFile(bytes: Uint8Array, opts: SaveOptions): Promise<string | null>;
  /** Writes to a known path without asking (desktop "Guardar"). */
  overwriteFile(path: string, bytes: Uint8Array): Promise<void>;
  /** Desktop: pick a folder and write every file. Browser: download a ZIP. */
  saveFiles(files: OutputFile[], opts: { zipName: string; title?: string }): Promise<string | null>;
  readFile(path: string): Promise<PickedFile>;
  /** Files passed on the command line (file association). */
  takeStartupFiles(): Promise<string[]>;
  /** Installed fonts (desktop): registry name, e.g. "Segoe UI Semibold (TrueType)", and file. */
  listSystemFonts(): Promise<{ name: string; path: string }[]>;
}

export const EXTENSIONS: Record<FileKind, string[]> = {
  pdf: ["pdf"],
  image: ["png", "jpg", "jpeg", "webp", "gif", "bmp"],
};

/** `name` is Spanish source text: translate it with `t()` where it is shown. */
export const SAVE_FILTERS: Record<SaveKind, { name: Msg; extensions: string[]; mime: string }> = {
  pdf: { name: "Documento PDF", extensions: ["pdf"], mime: "application/pdf" },
  zip: { name: "Archivo ZIP", extensions: ["zip"], mime: "application/zip" },
  png: { name: "Imagen PNG", extensions: ["png"], mime: "image/png" },
  jpg: { name: "Imagen JPEG", extensions: ["jpg", "jpeg"], mime: "image/jpeg" },
  txt: { name: "Texto", extensions: ["txt"], mime: "text/plain" },
};

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function kindOfName(name: string): FileKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (EXTENSIONS.pdf.includes(ext)) return "pdf";
  if (EXTENSIONS.image.includes(ext)) return "image";
  return null;
}
