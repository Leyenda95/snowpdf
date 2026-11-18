import { zipSync } from "fflate";
import type { OutputFile } from "./types";

/** Stores the files in a ZIP (no compression: PDFs and images are already compressed), de-duplicating names. */
export function zipFiles(files: OutputFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    let name = f.name;
    for (let i = 1; name in entries; i++) name = f.name.replace(/(\.[^.]+)?$/, ` (${i})$1`);
    entries[name] = f.bytes;
  }
  return zipSync(entries, { level: 0 });
}
