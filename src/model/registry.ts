import type { PDFDocumentProxy } from "pdfjs-dist";
import { cssFontName } from "@/pdf/fonts";
import { registerFontProgram, unloadFontProgram, type FontProgram } from "@/pdf/fontProgram";
import type { FontAsset, ImageAsset } from "./types";
import { t } from "@/i18n";

/**
 * Heavy, non-serialisable data kept outside the zustand stores: original PDF bytes, pdf.js
 * document proxies, image assets and document fonts. Undo/redo snapshots only hold ids that
 * point here.
 */

interface SourceEntry {
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
}

const sources = new Map<string, SourceEntry>();
const assets = new Map<string, ImageAsset>();
const fonts = new Map<string, { asset: FontAsset; face: FontFace }>();

/** Every source/asset belongs to the tab that was active when it was registered. */
const owners = new Map<string, string>();
let currentOwner = "default";

export function setRegistryOwner(tabId: string): void {
  currentOwner = tabId;
}

/** Free everything a closed tab registered. Returns the released source ids. */
export function releaseOwner(tabId: string): string[] {
  const released: string[] = [];
  for (const [id, owner] of owners) {
    if (owner !== tabId) continue;
    owners.delete(id);
    const s = sources.get(id);
    if (s) {
      void s.pdf.loadingTask.destroy();
      sources.delete(id);
      released.push(id);
    }
    const a = assets.get(id);
    if (a) {
      URL.revokeObjectURL(a.url);
      assets.delete(id);
    }
    if (fonts.has(id)) dropFont(id);
  }
  return released;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

export function putSource(id: string, bytes: Uint8Array, pdf: PDFDocumentProxy): void {
  sources.set(id, { bytes, pdf });
  owners.set(id, currentOwner);
}

export function getSource(id: string): SourceEntry {
  const s = sources.get(id);
  if (!s) throw new Error(t("Fuente {id} no cargada", { id }));
  return s;
}

export function hasSource(id: string): boolean {
  return sources.has(id);
}

export function putAsset(bytes: Uint8Array, mime: ImageAsset["mime"], width: number, height: number): ImageAsset {
  const id = newId("img");
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
  const asset: ImageAsset = { id, mime, bytes, width, height, url };
  assets.set(id, asset);
  owners.set(id, currentOwner);
  return asset;
}

export function getAsset(id: string): ImageAsset {
  const a = assets.get(id);
  if (!a) throw new Error(t("Imagen {id} no encontrada", { id }));
  return a;
}

/**
 * Register a document font: its parsed program (layout) and a FontFace (screen). The face
 * declares the original weight/style, so CSS asks for that weight and fallback letters get a
 * real bold/italic instead of a synthetic one; the metric overrides pin the vertical metrics
 * to the ones the layout uses, whatever tables the OS would read.
 */
export async function putFont(meta: Omit<FontAsset, "id">, program: FontProgram): Promise<FontAsset> {
  const asset: FontAsset = { id: newId("font"), ...meta };
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
  const face = new FontFace(cssFontName(asset.id), meta.bytes as Uint8Array<ArrayBuffer>, {
    weight: String(meta.weight),
    style: meta.italic ? "italic" : "normal",
    ascentOverride: pct(program.ascent),
    descentOverride: pct(program.descent),
    lineGapOverride: "0%",
  });
  try {
    await face.load();
  } catch {
    throw new Error(t("El navegador no acepta la fuente {name}", { name: meta.name }));
  }
  document.fonts.add(face);
  registerFontProgram(asset.id, program);
  fonts.set(asset.id, { asset, face });
  owners.set(asset.id, currentOwner);
  return asset;
}

export function getFont(id: string): FontAsset | null {
  return fonts.get(id)?.asset ?? null;
}

function dropFont(id: string): void {
  const f = fonts.get(id);
  if (f) document.fonts.delete(f.face);
  fonts.delete(id);
  unloadFontProgram(id);
}

/** Drop everything (closing the workspace). */
export function clearRegistry(): void {
  for (const s of sources.values()) void s.pdf.loadingTask.destroy();
  for (const a of assets.values()) URL.revokeObjectURL(a.url);
  for (const id of [...fonts.keys()]) dropFont(id);
  sources.clear();
  assets.clear();
}
