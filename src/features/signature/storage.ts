import type { SignatureKind } from "./types";

const STORAGE_KEY = "snowpdf.signatures";
export const MAX_SAVED_SIGNATURES = 8;

export interface SavedSignature {
  id: string;
  kind: SignatureKind;
  dataUrl: string;
  width: number;
  height: number;
  createdAt: number;
}

function isSaved(value: unknown): value is SavedSignature {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    (v.kind === "firma" || v.kind === "iniciales") &&
    typeof v.dataUrl === "string" &&
    v.dataUrl.startsWith("data:image/") &&
    typeof v.width === "number" &&
    typeof v.height === "number" &&
    typeof v.createdAt === "number"
  );
}

/** Saved signatures, oldest first. Never throws. */
export function loadSavedSignatures(): SavedSignature[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSaved) : [];
  } catch {
    return [];
  }
}

function persist(list: SavedSignature[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Appends a signature (dropping the oldest beyond the limit). Returns the new list, or null if storage failed. */
export function addSavedSignature(item: Omit<SavedSignature, "id" | "createdAt">): SavedSignature[] | null {
  const entry: SavedSignature = {
    ...item,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  const list = [...loadSavedSignatures(), entry].slice(-MAX_SAVED_SIGNATURES);
  return persist(list) ? list : null;
}

export function removeSavedSignature(id: string): SavedSignature[] {
  const list = loadSavedSignatures().filter((s) => s.id !== id);
  persist(list);
  return list;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToDataUrl(bytes: Uint8Array, mime = "image/png"): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
