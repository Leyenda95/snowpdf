import type { PDFDocument } from "@cantoo/pdf-lib";
import { createPdf, savePdf } from "@/pdf/docUtils";
import { copyPagesWithFields } from "@/pdf/acroform";
import { parsePageRanges, parsePageSelection } from "@/pdf/ranges";
import { openSourcePdf } from "./merge";
import { t } from "@/i18n";

export type SplitMode =
  /** One file per range ("1-3, 5, 8-"), or every range in a single file when `mergeIntoOne`. */
  | { kind: "ranges"; ranges: string; mergeIntoOne?: boolean }
  /** Chunks of `size` pages. */
  | { kind: "every"; size: number }
  /** One file per page. */
  | { kind: "each" }
  /** The selected pages in one file. */
  | { kind: "select"; pages: string };

interface Part {
  name: string;
  /** 0-based pages of the source, in output order. */
  indices: number[];
}

/** `X_pagina_5.pdf` for one page, `X_paginas_1-3.pdf` for a run of pages. */
function partName(base: string, indices: number[]): string {
  const first = indices[0] + 1;
  const last = indices[indices.length - 1] + 1;
  return indices.length === 1 ? `${base}${t("_pagina_{n}", { n: first })}.pdf` : `${base}${t("_paginas_{range}", { range: `${first}-${last}` })}.pdf`;
}

/** Keep names unique so saving them to one folder (or zip) never overwrites a file. */
function uniqueNames(parts: Part[]): Part[] {
  const used = new Set<string>();
  return parts.map((part) => {
    let name = part.name;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = part.name.replace(/\.pdf$/i, `_${n}.pdf`);
    used.add(name.toLowerCase());
    return { ...part, name };
  });
}

function planParts(base: string, pageCount: number, mode: SplitMode): Part[] {
  switch (mode.kind) {
    case "ranges": {
      const groups = parsePageRanges(mode.ranges, pageCount).filter((g) => g.length > 0);
      if (groups.length === 0) throw new Error(t("Indica los rangos de páginas, por ejemplo 1-3, 5, 8-."));
      if (mode.mergeIntoOne) return [{ name: `${base}${t("_extraido")}.pdf`, indices: groups.flat() }];
      return groups.map((indices) => ({ name: partName(base, indices), indices }));
    }
    case "every": {
      const size = Math.floor(mode.size);
      if (!Number.isFinite(size) || size < 1) throw new RangeError(t("El número de páginas por archivo debe ser 1 o más."));
      const parts: Part[] = [];
      for (let start = 0; start < pageCount; start += size) {
        const indices = Array.from({ length: Math.min(size, pageCount - start) }, (_, i) => start + i);
        parts.push({ name: partName(base, indices), indices });
      }
      return parts;
    }
    case "each":
      return Array.from({ length: pageCount }, (_, i) => ({ name: partName(base, [i]), indices: [i] }));
    case "select": {
      if (mode.pages.trim() === "") throw new Error(t("Indica qué páginas quieres extraer, por ejemplo 1-3, 5."));
      return [{ name: `${base}${t("_extraido")}.pdf`, indices: parsePageSelection(mode.pages, pageCount) }];
    }
  }
}

/** pdf-lib's getters throw on malformed Info entries; a broken field is simply not copied. */
function safe<T>(read: () => T | undefined): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** Title, author, subject, keywords and language travel with every piece. */
function copyDescriptiveInfo(from: PDFDocument, to: PDFDocument): void {
  const title = safe(() => from.getTitle());
  const author = safe(() => from.getAuthor());
  const subject = safe(() => from.getSubject());
  const keywords = safe(() => from.getKeywords());
  const language = safe(() => from.getLanguage());
  if (title) to.setTitle(title);
  if (author) to.setAuthor(author);
  if (subject) to.setSubject(subject);
  if (keywords) to.setKeywords([keywords]);
  if (language) to.setLanguage(language);
}

/**
 * Split a PDF into several files (or extract pages into one). Form fields and page rotation
 * are preserved. `baseName` (without extension) prefixes the generated file names:
 * `${baseName}_paginas_1-3.pdf`, `${baseName}_pagina_5.pdf` and `${baseName}${t("_extraido")}.pdf`.
 *
 * @throws Error / RangeError (Spanish message) for unreadable files, empty or invalid page
 * ranges and pages that do not exist.
 */
export async function splitDocument(
  bytes: Uint8Array,
  baseName: string,
  mode: SplitMode,
): Promise<{ name: string; bytes: Uint8Array }[]> {
  const base = baseName.trim() === "" ? t("documento") : baseName.trim();
  const src = await openSourcePdf(bytes, `${base}.pdf`);
  const pageCount = src.getPageCount();
  if (pageCount === 0) throw new Error(t("El documento no tiene páginas."));

  const files: { name: string; bytes: Uint8Array }[] = [];
  for (const part of uniqueNames(planParts(base, pageCount, mode))) {
    const doc = await createPdf();
    copyDescriptiveInfo(src, doc);
    const pages = await copyPagesWithFields(doc, src, part.indices);
    for (const page of pages) doc.addPage(page);
    files.push({ name: part.name, bytes: await savePdf(doc) });
  }
  return files;
}
