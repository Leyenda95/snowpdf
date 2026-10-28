import { useRef, type KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "./cn";
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
  className?: string;
}

const SIZES = {
  sm: { segment: "h-7 gap-1.5 px-2.5 text-xs", icon: 14 },
  md: { segment: "h-8 gap-2 px-3 text-sm", icon: 16 },
} as const;

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  fullWidth,
  label,
  className,
}: SegmentedControlProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const { segment, icon: iconSize } = SIZES[size];

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
    <div className={cn("flex flex-col gap-1.5", fullWidth ? "w-full" : "w-fit", className)}>
      {label && <span className={LABEL_CLASS}>{label}</span>}
      <div
        role="radiogroup"
        aria-label={label}
        onKeyDown={handleKeyDown}
        className={cn("flex gap-0.5 rounded-lg bg-surface-3 p-0.5", fullWidth ? "w-full" : "w-fit")}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
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
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(option.value)}
              className={cn(
                "inline-flex select-none items-center justify-center whitespace-nowrap rounded-md font-medium outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-brand-500/50",
                segment,
                fullWidth && "flex-1",
                selected
                  ? "bg-surface text-fg shadow-sm dark:bg-line-strong"
                  : "text-muted hover:text-fg",
              )}
            >
              {Icon && <Icon size={iconSize} aria-hidden />}
              {option.label}
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
