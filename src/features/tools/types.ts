import type { ComponentType, ReactNode } from "react";
import type { Msg } from "@/i18n";

/** One input file of a batch tool, already decoded (PDFs decrypted, pictures normalised). */
export interface ToolFile {
  id: string;
  name: string;
  kind: "pdf" | "image";
  /** PDF bytes in the clear, or PNG/JPEG bytes with EXIF orientation applied. */
  bytes: Uint8Array;
  mime?: "image/png" | "image/jpeg";
  size: number;
  /** Pages of a PDF (1 for pictures); null when the file could not be read. */
  pageCount: number | null;
  /** Displayed size of page 1 in points (pixels for pictures). */
  pageSize: { width: number; height: number } | null;
  /** Object URL of the first-page thumbnail (or of the picture itself). */
  thumbUrl: string | null;
  /** The PDF had a password or owner restrictions that were removed when it was added. */
  wasEncrypted: boolean;
  /** pdf.js could not open it (only the repair tool is useful then). */
  unreadable: boolean;
}

export interface ToolOutput {
  name: string;
  bytes: Uint8Array;
  kind: "pdf" | "png" | "jpg";
  /** Short remark shown next to the file in the result list. */
  note?: string;
}

export interface ToolResult {
  /** One line, e.g. "De 4,2 MB a 1,1 MB (−74 %)". */
  summary: string;
  outputs: ToolOutput[];
  /** Name of the ZIP offered when there are several outputs. */
  zipName: string;
  /** Files that failed or remarks about the run. */
  warnings: string[];
}

export interface RunContext {
  /** `fraction` in 0..1, or undefined for an indeterminate bar. */
  onProgress(fraction: number | undefined, label?: string): void;
}

export interface OptionsProps<O> {
  files: ToolFile[];
  options: O;
  onChange(next: O | ((prev: O) => O)): void;
  disabled?: boolean;
}

/** Extras drawn on a file card to preview the options. */
export interface CardExtras {
  /** Extra clockwise rotation of the thumbnail, degrees. */
  rotation?: number;
  /** Absolutely positioned content over the thumbnail (use container units: cqw). */
  overlay?: ReactNode;
}

export interface ToolModule<O> {
  /** Label of the primary button, e.g. "Unir PDF". */
  actionLabel: Msg;
  /** Files needed before the action is enabled (default 1). */
  minFiles?: number;
  /** Cards can be reordered by dragging (merge, images to PDF). */
  sortable?: boolean;
  /** Card size; default depends on whether the tool takes several files. */
  cardSize?: "md" | "lg";
  defaultOptions(): O;
  Options: ComponentType<OptionsProps<O>>;
  /** A reason why the action cannot run yet, or null. */
  validate?(files: ToolFile[], options: O): string | null;
  run(files: ToolFile[], options: O, ctx: RunContext): Promise<ToolResult>;
  cardExtras?(file: ToolFile, options: O): CardExtras;
}
