import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./IconButton";
import { useEscapeLayer } from "./layers";
import { t } from "@/i18n";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Optional element shown next to the close button (e.g. a "new" action). */
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/**
 * Phone-style panel that slides up from the bottom edge over a dimmed backdrop.
 * Escape, the Android back button (via `dismissTopLayer`) and tapping the backdrop close it.
 * Body scrolls vertically; never use horizontal scrolling inside it.
 */
export function BottomSheet({ open, onClose, title, action, children, className }: BottomSheetProps) {
  const titleId = useId();
  useEscapeLayer(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div aria-hidden className="absolute inset-0 bg-black/40 transition-opacity duration-150 starting:opacity-0" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative flex max-h-[80dvh] flex-col overflow-hidden rounded-t-2xl border-t border-line bg-surface shadow-pop",
          "pb-[env(safe-area-inset-bottom)] transition-transform duration-200 ease-out starting:translate-y-full",
          className,
        )}
      >
        <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong" />
        <div className="flex h-12 shrink-0 items-center gap-2 pl-4 pr-2">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            {title}
          </h2>
          {action}
          <IconButton icon={X} label={t("Cerrar")} onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
