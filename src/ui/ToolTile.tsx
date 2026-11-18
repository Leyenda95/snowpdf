import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "./cn";

export interface ToolTileProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: LucideIcon;
  label: string;
  /** Text colour classes of the icon when inactive (e.g. "text-rose-600 dark:text-rose-300"); defaults to the text colour. */
  iconClass?: string;
  /** Currently selected tool. */
  active?: boolean;
  /** "danger" tints the active state rose (redaction). */
  tone?: "default" | "danger";
}

/**
 * Phone tool tile: the icon in a flat square with its name below, laid out in grids (home tools,
 * the editor's tool sheets). A flat tile with a hairline border; the active tile is inverted.
 */
export function ToolTile({ icon: Icon, label, iconClass, active = false, tone = "default", className, ...rest }: ToolTileProps) {
  const danger = tone === "danger";
  return (
    <button
      type="button"
      aria-pressed={active || undefined}
      className={cn(
        "flex min-h-[5.5rem] w-full min-w-0 select-none flex-col items-center justify-start gap-2 rounded-2xl px-1.5 pb-2.5 pt-3 text-center outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-brand-500/50 active:scale-[0.97] motion-reduce:active:scale-100",
        active
          ? danger
            ? "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-100"
            : "bg-fg text-surface"
          : "border border-line bg-surface text-fg hover:bg-surface-2 active:bg-surface-3",
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-xl",
          active
            ? danger
              ? "bg-current/10 text-rose-600 dark:text-rose-300"
              : "bg-surface/15 text-surface"
            : cn("bg-surface-3", iconClass ?? "text-fg"),
        )}
      >
        <Icon size={22} />
      </span>
      <span className="line-clamp-2 w-full break-words text-xs font-medium leading-tight">{label}</span>
    </button>
  );
}
