import type { ReactNode } from "react";
import { parsePageRanges, parsePageSelection } from "@/pdf/ranges";
import { TextField, cn } from "@/ui";
import type { ToolFile } from "../types";
import { messageOf } from "../utils";
import { t, type Msg } from "@/i18n";

/** Vertical stack used by every options panel. */
export function OptionStack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5">{children}</div>;
}

/** Short paragraph of explanation under or instead of the options. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-muted">{children}</p>;
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs font-medium text-muted">{children}</span>;
}

/**
 * Validates a page selection against every PDF (empty = all pages). With several files the
 * message names the one that failed.
 */
export function pagesError(input: string, files: ToolFile[], opts: { ranges?: boolean; required?: boolean } = {}): string | null {
  if (opts.required && input.trim() === "") return t("Indica las páginas.");
  const pdfs = files.filter((f) => f.pageCount !== null);
  if (pdfs.length === 0 && input.trim() !== "") {
    try {
      parsePageRanges(input, 1_000_000);
    } catch (err) {
      return messageOf(err);
    }
  }
  for (const file of pdfs) {
    try {
      if (opts.ranges) parsePageRanges(input, file.pageCount!);
      else parsePageSelection(input, file.pageCount!);
    } catch (err) {
      return files.length > 1 ? t("{error} («{name}»)", { error: messageOf(err), name: file.name }) : messageOf(err);
    }
  }
  return null;
}

/** Text field for "1-3, 5, 8-" with live validation under it. */
export function PagesField({
  value,
  onChange,
  files,
  disabled,
  label = t("Páginas"),
  placeholder = t("Todas"),
  hint = t("Vacío = todas. Ejemplo: 1-3, 5, 8-"),
}: {
  value: string;
  onChange: (value: string) => void;
  files: ToolFile[];
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  hint?: string;
}) {
  const error = pagesError(value, files);
  return (
    <TextField
      label={label}
      value={value}
      placeholder={placeholder}
      hint={hint}
      error={error ?? undefined}
      disabled={disabled}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Smallest page count among the readable PDFs (null when none is readable). */
export function minPageCount(files: ToolFile[]): number | null {
  const counts = files.map((f) => f.pageCount).filter((n): n is number => n !== null);
  return counts.length ? Math.min(...counts) : null;
}

/** Grid of position buttons (3x3 for watermarks, 2x3 for page numbers). */
export function PositionGrid<T extends string>({
  value,
  onChange,
  rows,
  labels,
  disabled,
  label,
  muted,
}: {
  value: T;
  onChange: (value: T) => void;
  rows: T[][];
  labels: Record<T, Msg>;
  disabled?: boolean;
  label: string;
  /** Looks inactive (e.g. while tiling) but stays clickable. */
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <GroupLabel>{label}</GroupLabel>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn("inline-grid gap-1.5 self-start rounded-lg border border-line bg-surface-2 p-1.5", muted && "opacity-50")}
        style={{ gridTemplateColumns: `repeat(${rows[0].length}, 2rem)` }}
      >
        {rows.flat().map((pos) => {
          const selected = pos === value;
          return (
            <button
              key={pos}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={t(labels[pos])}
              title={t(labels[pos])}
              disabled={disabled}
              onClick={() => onChange(pos)}
              className={cn(
                "grid size-8 place-items-center rounded-md border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:cursor-not-allowed",
                selected
                  ? "border-brand-600 bg-brand-600 dark:border-brand-500 dark:bg-brand-500"
                  : "border-line-strong bg-surface hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-brand-500/10",
              )}
            >
              <span className={cn("size-2 rounded-full", selected ? "bg-white" : "bg-subtle")} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
