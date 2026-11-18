import type { Msg } from "@/i18n";

export type FileKind = "pdf" | "image";

/** Running inside the Android app (or an Android browser). */
export const IS_ANDROID = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

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
  /**
   * Takes a picture with the system camera app (phones; elsewhere it asks for an image file).
   * Resolves to null when cancelled. Must be called from a tap/click handler.
   */
  capturePhoto(): Promise<PickedFile | null>;
  /** Asks where to save. Resolves to the saved path/name, or null when cancelled. */
  saveFile(bytes: Uint8Array, opts: SaveOptions): Promise<string | null>;
  /** Writes to a known path without asking (desktop "Guardar"). */
  overwriteFile(path: string, bytes: Uint8Array): Promise<void>;
  /** Desktop: pick a folder and write every file. Browser: download a ZIP. */
  saveFiles(files: OutputFile[], opts: { zipName: string; title?: string }): Promise<string | null>;
  readFile(path: string): Promise<PickedFile>;
  /** Files passed on the command line (file association). */
  takeStartupFiles(): Promise<string[]>;
  /**
   * Calls `handler` when `takeStartupFiles` may have new files while the app is running: a second
   * launch on desktop (double-click on another PDF), "Abrir con" on Android. Returns the unsubscribe.
   */
  onIncomingFiles(handler: () => void): () => void;
  /** Installed fonts (desktop): registry name, e.g. "Segoe UI Semibold (TrueType)", and file. */
  listSystemFonts(): Promise<{ name: string; path: string }[]>;
  /** Opens an http(s)/mailto URL in the system's default application. */
  openExternalUrl(url: string): Promise<void>;
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
  if (path.startsWith("content://")) {
    let decoded = path;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      // Malformed escape sequences: use the raw text.
    }
    const afterSlash = decoded.slice(decoded.lastIndexOf("/") + 1);
    const name = afterSlash.slice(afterSlash.lastIndexOf(":") + 1);
    return /\.[^./\\]+$/.test(name) ? name : "documento.pdf";
  }
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** What to show the user for a saved location: Android content URIs are opaque, show the file name. */
export function displayPath(path: string): string {
  return path.startsWith("content://") ? baseName(path) : path;
}

export function kindOfName(name: string): FileKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (EXTENSIONS.pdf.includes(ext)) return "pdf";
  if (EXTENSIONS.image.includes(ext)) return "image";
  return null;
}
