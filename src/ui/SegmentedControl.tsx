import { useRef, type KeyboardEvent } from "react";
import { Check, type LucideIcon } from "lucide-react";
import { cn } from "./cn";
import { useIsMobile } from "./responsive";
import { LABEL_CLASS } from "./fieldStyles";
import { Tooltip } from "./Tooltip";

export interface SegmentedOption<T extends string> {
  value: T;
  label?: string;
  icon?: LucideIcon;
  /** Tooltip (and accessible name for icon-only options). */
  title?: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: "sm" | "md";
  fullWidth?: boolean;
  label?: string;
  disabled?: boolean;
  className?: string;
}

const SIZES = {
  sm: { segment: "h-7 gap-1.5 px-2.5 text-xs pointer-coarse:h-9", icon: 14 },
  md: { segment: "h-8 gap-2 px-3 text-sm pointer-coarse:h-10", icon: 16 },
} as const;

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  fullWidth,
  label,
  disabled = false,
  className,
}: SegmentedControlProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const { segment, icon: iconSize } = SIZES[size];
  // Phones: text options that would not fit side by side become a vertical list (like Android settings).
  const mobile = useIsMobile();
  const textChars = options.reduce((n, o) => n + (o.label?.length ?? 0), 0);
  const stacked = mobile && options.every((o) => o.label) && (options.length > 3 || textChars > 24);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = options.findIndex((o) => o.value === value);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (current + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (current - 1 + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    buttons.current[next]?.focus();
  };

  return (
    <div className={cn("flex flex-col gap-1.5", fullWidth || stacked ? "w-full" : "w-fit", className)}>
      {label && <span className={LABEL_CLASS}>{label}</span>}
      <div
        role="radiogroup"
        aria-label={label}
        aria-disabled={disabled || undefined}
        onKeyDown={disabled ? undefined : handleKeyDown}
        className={cn(
          stacked
            ? "flex w-full flex-col divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface"
            : "flex gap-0.5 rounded-lg bg-surface-3 p-0.5",
          !stacked && (fullWidth ? "w-full" : "w-fit"),
        )}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          // A value outside the options (set elsewhere) must not leave the group unreachable by Tab.
          const tabStop = selected || (index === 0 && !options.some((o) => o.value === value));
          const Icon = option.icon;
          const button = (
            <button
              key={option.value}
              ref={(el) => {
                buttons.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={option.label ? undefined : option.title}
              tabIndex={tabStop ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                stacked
                  ? cn(
                      "flex min-h-12 w-full select-none items-center gap-3 px-3.5 text-left text-sm outline-none transition-colors focus-visible:bg-surface-2 disabled:opacity-50",
                      selected ? "font-medium text-fg" : "text-fg",
                    )
                  : cn(
                      "inline-flex select-none items-center justify-center whitespace-nowrap rounded-md font-medium outline-none transition-colors disabled:opacity-50",
                      "focus-visible:ring-2 focus-visible:ring-brand-500/50",
                      segment,
                      fullWidth && "flex-1",
                      selected
                        ? "bg-surface text-fg shadow-sm dark:bg-line-strong"
                        : "text-muted hover:text-fg",
                    ),
              )}
            >
              {Icon && <Icon size={stacked ? 18 : iconSize} aria-hidden className={stacked ? "shrink-0 text-muted" : undefined} />}
              {stacked ? <span className="min-w-0 flex-1">{option.label}</span> : option.label}
              {stacked && selected && <Check size={18} aria-hidden className="shrink-0 text-brand-600 dark:text-brand-300" />}
            </button>
          );
          return option.title ? (
            <Tooltip key={option.value} content={option.title}>
              {button}
            </Tooltip>
          ) : (
            button
          );
        })}
      </div>
    </div>
  );
}
