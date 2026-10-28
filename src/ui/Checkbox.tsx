import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "./cn";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({ checked, onChange, label, disabled, className }: CheckboxProps) {
  return (
    <label
      className={cn(
        "inline-flex items-start gap-2.5",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <span className="relative mt-0.5 inline-grid size-4 shrink-0 place-items-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-[5px] border border-line-strong bg-surface transition-colors",
            "peer-hover:border-subtle peer-checked:border-brand-600 peer-checked:bg-brand-600 dark:peer-checked:border-brand-500 dark:peer-checked:bg-brand-500",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/50 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-surface",
          )}
        />
        {checked && <Check size={12} strokeWidth={3.5} aria-hidden className="pointer-events-none relative text-white" />}
      </span>
      {label && <span className="text-sm leading-5 text-fg">{label}</span>}
    </label>
  );
}
