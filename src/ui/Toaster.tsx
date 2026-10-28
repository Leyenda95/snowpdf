import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./IconButton";
import { Spinner } from "./Spinner";
import { toast, useToastStore, type ToastItem, type ToastKind } from "./toast";
import { t } from "@/i18n";

const ICONS: Record<Exclude<ToastKind, "loading">, LucideIcon> = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
  warning: TriangleAlert,
};

const ICON_COLORS: Record<ToastKind, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  error: "text-red-600 dark:text-red-400",
  info: "text-brand-600 dark:text-brand-300",
  warning: "text-amber-600 dark:text-amber-400",
  loading: "text-brand-600 dark:text-brand-300",
};

const BORDERS: Record<ToastKind, string> = {
  success: "border-line",
  error: "border-red-300 dark:border-red-500/40",
  info: "border-line",
  warning: "border-amber-300 dark:border-amber-500/40",
  loading: "border-line",
};

function ToastCard({ item }: { item: ToastItem }) {
  // Hovering a toast pauses its countdown so there is time to read it.
  const [paused, setPaused] = useState(false);
  const Icon = item.kind === "loading" ? null : ICONS[item.kind];

  useEffect(() => {
    if (item.duration === null || paused) return;
    const timer = window.setTimeout(() => toast.dismiss(item.id), item.duration);
    return () => window.clearTimeout(timer);
  }, [item.id, item.duration, item.revision, paused]);

  return (
    <div
      role={item.kind === "error" ? "alert" : "status"}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-xl border bg-surface p-3 pr-2 shadow-pop",
        "transition duration-200 ease-out starting:translate-y-2 starting:opacity-0 motion-reduce:transition-none",
        BORDERS[item.kind],
      )}
    >
      <span className={cn("mt-0.5 shrink-0", ICON_COLORS[item.kind])}>
        {Icon ? <Icon size={20} aria-hidden /> : <Spinner size={20} />}
      </span>
      <div className="min-w-0 flex-1 py-px">
        <p className="break-words text-sm font-medium leading-snug text-fg">{item.message}</p>
        {item.description && <p className="mt-0.5 break-words text-sm leading-snug text-muted">{item.description}</p>}
      </div>
      <IconButton
        icon={X}
        label={t("Cerrar")}
        size="sm"
        tooltipSide="left"
        onClick={() => toast.dismiss(item.id)}
        className="shrink-0"
      />
    </div>
  );
}

/** Bottom-right stack of notifications. Mount once (see App). */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);

  return createPortal(
    <div
      aria-live="polite"
      aria-relevant="additions text"
      className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>,
    document.body,
  );
}
