import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  /** Shows a spinner (in place of the left icon) and disables the button. */
  loading?: boolean;
  fullWidth?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 dark:hover:bg-brand-500 dark:active:bg-brand-700",
  secondary:
    "border border-line-strong bg-surface text-fg shadow-sm hover:bg-surface-2 active:bg-surface-3",
  ghost: "text-fg hover:bg-surface-3 active:bg-line",
  subtle: "bg-surface-3 text-fg hover:bg-line active:bg-line-strong",
  danger: "bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800 dark:hover:bg-red-500 dark:active:bg-red-700",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-[13px]",
  md: "h-9 gap-2 rounded-lg px-4 text-sm",
  lg: "h-11 gap-2.5 rounded-xl px-5 text-base",
};

const ICON_SIZES: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    icon: Icon,
    iconRight: IconRight,
    loading = false,
    fullWidth = false,
    type = "button",
    disabled,
    className,
    children,
    ...rest
  },
  ref,
) {
  const iconSize = ICON_SIZES[size];
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-brand-500/50",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={iconSize} /> : Icon && <Icon size={iconSize} aria-hidden />}
      {children}
      {IconRight && !loading && <IconRight size={iconSize} aria-hidden />}
    </button>
  );
});
