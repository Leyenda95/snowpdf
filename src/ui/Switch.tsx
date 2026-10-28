import type { ReactNode } from "react";
import { cn } from "./cn";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
  return (
    <label
      className={cn("flex items-start gap-3", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer", className)}
    >
      <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-full bg-slate-400 transition-colors dark:bg-slate-600",
            "peer-checked:bg-brand-600 dark:peer-checked:bg-brand-500",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface",
          )}
        />
        <span
          aria-hidden
          className="absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4"
        />
      </span>
      {(label || description) && (
        <span className="flex min-w-0 flex-col gap-0.5">
          {label && <span className="text-sm font-medium leading-5 text-fg">{label}</span>}
          {description && <span className="text-xs leading-snug text-muted">{description}</span>}
        </span>
      )}
    </label>
  );
}
