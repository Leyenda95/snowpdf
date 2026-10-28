import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { keyLabel } from "@/i18n";
import { cn } from "./cn";
import type { Side } from "./floating";
import { Tooltip } from "./Tooltip";

export type IconButtonSize = "sm" | "md" | "lg";
export type IconButtonVariant = "ghost" | "subtle" | "primary";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: LucideIcon;
  /** Accessible name; also shown as the tooltip. */
  label: string;
  /** Shortcut hint appended to the tooltip, e.g. "Ctrl+Z". */
  shortcut?: string;
  /** Toggle state: sets aria-pressed and a highlighted look. */
  active?: boolean;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  tooltipSide?: Side;
}

const VARIANTS: Record<IconButtonVariant, string> = {
  ghost: "text-muted hover:bg-surface-3 hover:text-fg active:bg-line",
  subtle: "bg-surface-3 text-muted hover:bg-line hover:text-fg active:bg-line-strong",
  primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 dark:hover:bg-brand-500",
};

const ACTIVE =
  "bg-brand-100 text-brand-700 hover:bg-brand-200 active:bg-brand-200 dark:bg-brand-500/20 dark:text-brand-200 dark:hover:bg-brand-500/30 dark:active:bg-brand-500/30";

const SIZES: Record<IconButtonSize, { box: string; icon: number }> = {
  sm: { box: "size-7 rounded-md", icon: 16 },
  md: { box: "size-8 rounded-lg", icon: 18 },
  lg: { box: "size-10 rounded-lg", icon: 20 },
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon: Icon,
    label,
    shortcut,
    active,
    size = "md",
    variant = "ghost",
    tooltipSide = "bottom",
    type = "button",
    className,
    ...rest
  },
  ref,
) {
  const { box, icon } = SIZES[size];
  return (
    <Tooltip
      side={tooltipSide}
      content={
        shortcut ? (
          <span className="flex items-center gap-2">
            {label}
            <span className="rounded bg-white/20 px-1 text-[10px] font-semibold dark:bg-slate-900/10">{keyLabel(shortcut)}</span>
          </span>
        ) : (
          label
        )
      }
    >
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "inline-flex shrink-0 select-none items-center justify-center outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-brand-500/50",
          "disabled:pointer-events-none disabled:opacity-50",
          box,
          active ? ACTIVE : VARIANTS[variant],
          className,
        )}
        {...rest}
      >
        <Icon size={icon} aria-hidden />
      </button>
    </Tooltip>
  );
});
