import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "./cn";
import { getTabbable } from "./hooks";
import { IconButton } from "./IconButton";
import { useEscapeLayer } from "./layers";
import { t } from "@/i18n";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Rendered right-aligned under the body (usually buttons). */
  footer?: ReactNode;
  size?: ModalSize;
  /** Close when the backdrop is clicked (default true). Escape always closes. */
  closeOnBackdrop?: boolean;
  /** Element that receives focus when the modal opens. Defaults to the first field/button in the body. */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

const SIZES: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "h-full max-w-none",
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeOnBackdrop = true,
  initialFocusRef,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pressedBackdrop = useRef(false);

  // Remember who had focus before opening. Captured while rendering, i.e. before any
  // `autoFocus` child can steal it.
  const wasOpen = useRef(false);
  const restoreFocusTo = useRef<Element | null>(null);
  if (open && !wasOpen.current) restoreFocusTo.current = document.activeElement;
  wasOpen.current = open;

  useEscapeLayer(open, onClose);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const explicit = initialFocusRef?.current ?? null;
      const target =
        explicit ??
        (bodyRef.current && getTabbable(bodyRef.current)[0]) ??
        (footerRef.current && getTabbable(footerRef.current)[0]) ??
        closeRef.current ??
        panel;
      target.focus({ preventScroll: true });
      if (explicit instanceof HTMLInputElement || explicit instanceof HTMLTextAreaElement) explicit.select();
    }
    return () => {
      const previous = restoreFocusTo.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  const focusEdge = (edge: "first" | "last") => {
    const panel = panelRef.current;
    if (!panel) return;
    const items = getTabbable(panel);
    (items[edge === "first" ? 0 : items.length - 1] ?? panel).focus({ preventScroll: true });
  };

  const hasHeader = Boolean(title || description);
  const hasBody = children !== undefined && children !== null && children !== false;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 sm:p-6",
        "transition-opacity duration-150 starting:opacity-0 motion-reduce:transition-none",
      )}
      onKeyDown={(e) => {
        // Modal means modal: app-wide shortcuts (undo, delete...) must not fire behind an open dialog.
        // Escape is left alone, it is handled by the layer stack.
        if (e.key !== "Escape") e.stopPropagation();
      }}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (closeOnBackdrop && pressedBackdrop.current && e.target === e.currentTarget) onClose();
        pressedBackdrop.current = false;
      }}
    >
      <span tabIndex={0} className="sr-only" onFocus={() => focusEdge("last")} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : t("Diálogo")}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface text-fg shadow-pop outline-none",
          "transition duration-150 ease-out starting:translate-y-2 starting:scale-[0.98] starting:opacity-0 motion-reduce:transition-none",
          SIZES[size],
        )}
      >
        {hasHeader ? (
          <div className="flex shrink-0 items-start gap-4 px-6 pb-2 pt-5">
            <div className="min-w-0 flex-1">
              {title && (
                <h2 id={titleId} className="text-lg font-semibold leading-snug text-fg">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-muted">
                  {description}
                </p>
              )}
            </div>
            <IconButton ref={closeRef} icon={X} label={t("Cerrar")} size="sm" className="-mr-2 -mt-0.5" onClick={onClose} />
          </div>
        ) : (
          <IconButton
            ref={closeRef}
            icon={X}
            label={t("Cerrar")}
            size="sm"
            className="absolute right-3 top-3 z-10"
            onClick={onClose}
          />
        )}

        {hasBody && (
          <div ref={bodyRef} className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-4", !hasHeader && "pt-10")}>
            {children}
          </div>
        )}

        {footer && (
          <div
            ref={footerRef}
            className={cn(
              "flex shrink-0 flex-wrap items-center justify-end gap-2",
              hasBody ? "border-t border-line bg-surface-2/60 px-6 py-3.5" : "px-6 pb-5 pt-3",
            )}
          >
            {footer}
          </div>
        )}
      </div>
      <span tabIndex={0} className="sr-only" onFocus={() => focusEdge("first")} />
    </div>,
    document.body,
  );
}
