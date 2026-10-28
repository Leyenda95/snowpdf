import { Combine, FileSearch, GitCompareArrows, ImagePlus, ScanText, type LucideIcon } from "lucide-react";
import type { Msg } from "@/i18n";

/** Tailwind colour family used for the tool's icon tile. */
export type ToolColor = "orange" | "emerald" | "amber" | "violet" | "sky";

/** Ids of every batch module in ./options (the editor's tools pane reuses most of them). */
export type BatchToolId =
  | "merge"
  | "split"
  | "rotate"
  | "compress"
  | "repair"
  | "flatten"
  | "images-to-pdf"
  | "pdf-to-images"
  | "watermark"
  | "page-numbers"
  | "crop"
  | "metadata"
  | "protect";

export type FutureToolId = "ocr" | "compare" | "pdf-to-text";

export type ToolId = BatchToolId | FutureToolId;

interface ToolBase {
  title: Msg;
  description: Msg;
  icon: LucideIcon;
  color: ToolColor;
  keywords: string[];
}

/** iLovePDF-style page: pick files, set options, process, save. */
export interface BatchToolDef extends ToolBase {
  id: BatchToolId;
  kind: "batch";
  accepts: ("pdf" | "image")[];
  multiple: boolean;
}

export interface FutureToolDef extends ToolBase {
  id: FutureToolId;
  kind: "future";
}

export type ToolDef = BatchToolDef | FutureToolDef;

/**
 * Tools with their own page: only what makes no sense from a single open PDF (merging several files, building a PDF
 * from images) plus the upcoming tools. Single-document operations live in the editor's tools pane.
 */
export const TOOLS: ToolDef[] = [
  { id: "merge", kind: "batch", accepts: ["pdf", "image"], multiple: true, color: "orange", icon: Combine,
    title: "Unir PDF", description: "Combina varios PDF e imágenes en un solo documento, en el orden que quieras.", keywords: ["combinar", "juntar", "fusionar"] },
  { id: "images-to-pdf", kind: "batch", accepts: ["image"], multiple: true, color: "amber", icon: ImagePlus,
    title: "Imágenes a PDF", description: "Convierte JPG, PNG y otras imágenes en un PDF.", keywords: ["jpg", "png", "foto", "convertir"] },

  // Próximamente
  { id: "ocr", kind: "future", color: "amber", icon: ScanText,
    title: "OCR", description: "Reconoce el texto de documentos escaneados.", keywords: ["escaneado", "reconocer"] },
  { id: "compare", kind: "future", color: "violet", icon: GitCompareArrows,
    title: "Comparar PDF", description: "Encuentra las diferencias entre dos versiones.", keywords: ["diferencias", "versiones"] },
  { id: "pdf-to-text", kind: "future", color: "amber", icon: FileSearch,
    title: "PDF a texto", description: "Extrae todo el texto del documento.", keywords: ["txt", "extraer"] },
];

export function getTool(id: ToolId): ToolDef {
  const t = TOOLS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown tool ${id}`);
  return t;
}
