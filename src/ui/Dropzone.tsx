import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FileUp, Upload } from "lucide-react";
import { cn } from "./cn";
import { useLatest } from "./hooks";
import { toast } from "./toast";
import { t } from "@/i18n";

export interface DropzoneProps {
  onFiles: (files: File[]) => void;
  /** Accepted extensions without the dot, e.g. ["pdf", "png"]. */
  accept?: string[];
  multiple?: boolean;
  /** When set, click / Enter call this instead of opening the browser's file picker. */
  onBrowse?: () => void;
  /** Replaces the default content. */
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** True while the drag carries real files (not text, links or in-page drags). */
function carriesFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

/** Filters by extension, enforces `multiple`, and reports unsupported drops. */
function deliver(files: File[], accept: string[] | undefined, multiple: boolean, onFiles: (files: File[]) => void): void {
  if (files.length === 0) return;
  const allowed = accept?.map((ext) => ext.replace(/^\./, "").toLowerCase());
  const valid = allowed ? files.filter((f) => allowed.includes(extensionOf(f.name))) : files;
  if (valid.length === 0) {
    toast.error(t("Tipo de archivo no admitido"));
    return;
  }
  onFiles(multiple ? valid : valid.slice(0, 1));
}

export function Dropzone({
  onFiles,
  accept,
  multiple = false,
  onBrowse,
  children,
  className,
  disabled = false,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // dragenter/dragleave also fire for every child element: count them to know when the drag truly left.
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const browse = () => {
    if (disabled) return;
    if (onBrowse) onBrowse();
    else inputRef.current?.click();
  };

  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    if (disabled) return;
    depth.current += 1;
    setDragging(true);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = disabled ? "none" : "copy";
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!carriesFiles(e) || disabled) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!carriesFiles(e)) return;
    // Always cancel the default so the webview never navigates to a dropped file.
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    if (!disabled) deliver(Array.from(e.dataTransfer.files), accept, multiple, onFiles);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      browse();
    }
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      onClick={(e) => {
        // The hidden <input>'s own click bubbles up here: ignore it to avoid re-opening the picker.
        if (e.target !== inputRef.current) browse();
      }}
      onKeyDown={onKeyDown}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "group flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 text-center outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-brand-500/50",
        disabled
          ? "cursor-not-allowed border-line bg-surface-2 opacity-60"
          : dragging
            ? "cursor-copy border-brand-500 bg-brand-50 dark:bg-brand-500/10"
            : "cursor-pointer border-line-strong bg-surface-2/60 hover:border-brand-400 hover:bg-brand-50/60 dark:hover:bg-brand-500/5",
        className,
      )}
    >
      {children ?? (
        <>
          <div
            className={cn(
              "grid size-12 place-items-center rounded-2xl transition-colors",
              dragging
                ? "bg-brand-100 text-brand-600 dark:bg-brand-500/20 dark:text-brand-200"
                : "bg-surface-3 text-muted group-hover:bg-brand-100 group-hover:text-brand-600 dark:group-hover:bg-brand-500/20 dark:group-hover:text-brand-200",
            )}
          >
            <Upload size={22} aria-hidden />
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-fg">{t("Arrastra aquí tus archivos o haz clic para elegirlos")}</p>
            {accept && accept.length > 0 && (
              <p className="text-xs text-subtle">{t("Admite")} {accept.map((ext) => ext.replace(/^\./, "").toUpperCase()).join(", ")}</p>
            )}
          </div>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        hidden
        tabIndex={-1}
        multiple={multiple}
        accept={accept?.map((ext) => `.${ext.replace(/^\./, "")}`).join(",")}
        onChange={(e) => {
          deliver(Array.from(e.target.files ?? []), accept, multiple, onFiles);
          e.target.value = ""; // let the same file be chosen again
        }}
      />
    </div>
  );
}

function WindowDropOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center bg-brand-700/25 p-6 backdrop-blur-sm transition-opacity duration-150 starting:opacity-0 dark:bg-brand-950/60">
      <div className="flex flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-brand-500 bg-surface/95 px-14 py-12 text-center shadow-pop">
        <div className="grid size-16 place-items-center rounded-2xl bg-brand-100 text-brand-600 dark:bg-brand-500/20 dark:text-brand-200">
          <FileUp size={32} aria-hidden />
        </div>
        <p className="text-lg font-semibold text-fg">{t("Suelta los archivos para abrirlos")}</p>
      </div>
    </div>
  );
}

/**
 * Accepts files dropped anywhere on the window. While a file drag is over the window a
 * translucent overlay announces it. Drops already handled by a `Dropzone` are ignored.
 * Files are filtered by `accept` (extensions without dot); unsupported drops show an error toast.
 */
export function useWindowFileDrop(onFiles: (files: File[]) => void, accept?: string[]): void {
  const handler = useLatest(onFiles);
  const allowed = useLatest(accept);

  useEffect(() => {
    let depth = 0;
    let host: HTMLDivElement | null = null;
    let root: Root | null = null;

    const show = () => {
      if (host) return;
      host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
      root.render(<WindowDropOverlay />);
    };

    const hide = () => {
      depth = 0;
      if (!host || !root) return;
      const staleHost = host;
      const staleRoot = root;
      host = null;
      root = null;
      // Unmounting synchronously from inside another React event/commit logs a warning.
      window.setTimeout(() => {
        staleRoot.unmount();
        staleHost.remove();
      }, 0);
    };

    const onDragEnter = (e: globalThis.DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth += 1;
      show();
    };
    const onDragOver = (e: globalThis.DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      show();
    };
    const onDragLeave = (e: globalThis.DragEvent) => {
      if (!carriesFiles(e)) return;
      depth -= 1;
      if (depth <= 0) hide();
    };
    // Capture phase: always clear the overlay, even if something stops the event later.
    const onDropCapture = () => hide();
    const onDrop = (e: globalThis.DragEvent) => {
      if (!carriesFiles(e)) return;
      // A Dropzone (or any other handler) already took care of it: it called preventDefault.
      if (e.defaultPrevented) return;
      e.preventDefault();
      deliver(Array.from(e.dataTransfer?.files ?? []), allowed.current, true, handler.current);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDropCapture, true);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", hide);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDropCapture, true);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", hide);
      hide();
    };
  }, [handler, allowed]);
}
