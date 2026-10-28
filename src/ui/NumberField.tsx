import { useEffect, useId, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { cn } from "./cn";
import { LABEL_CLASS } from "./fieldStyles";

export interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  suffix?: string;
  disabled?: boolean;
  /** Classes for the whole field (label + input). */
  className?: string;
  /** Classes for the <input> element. */
  inputClassName?: string;
}

/** Rounds away binary noise (0.1 + 0.2) and shows a decimal comma, as Spanish users expect. */
function formatNumber(n: number): string {
  return String(Math.round(n * 1e6) / 1e6).replace(".", ",");
}

/** Accepts "12", "12.5" and "12,5". Returns null for anything unfinished or invalid. */
function parseNumber(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  suffix,
  disabled,
  className,
  inputClassName,
}: NumberFieldProps) {
  const id = useId();
  // The text is local so the user can type "-", "1." or "" without the value snapping back.
  const [text, setText] = useState(() => formatNumber(value));

  // Follow outside changes, unless the text already means the same number.
  useEffect(() => {
    setText((current) => (parseNumber(current) === value ? current : formatNumber(value)));
  }, [value]);

  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const inRange = (n: number) => n === clamp(n);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);
    const n = parseNumber(raw);
    // Out-of-range numbers are kept as text and clamped on blur, so typing "5" on the way to "50" works.
    if (n !== null && inRange(n) && n !== value) onChange(n);
  };

  const commitText = () => {
    const n = parseNumber(text);
    if (n === null) {
      setText(formatNumber(value));
      return;
    }
    const next = clamp(n);
    setText(formatNumber(next));
    if (next !== value) onChange(next);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      commitText();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const direction = e.key === "ArrowUp" ? 1 : -1;
      const amount = step * (e.shiftKey ? 10 : 1);
      const next = clamp(Math.round(((parseNumber(text) ?? value) + direction * amount) * 1e6) / 1e6);
      setText(formatNumber(next));
      if (next !== value) onChange(next);
    }
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={id} className={LABEL_CLASS}>
          {label}
        </label>
      )}
      <div
        className={cn(
          "flex h-9 items-center rounded-lg border border-line-strong bg-surface text-sm text-fg transition-colors",
          "hover:border-subtle focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/30",
          disabled && "cursor-not-allowed bg-surface-2 opacity-60 hover:border-line-strong",
        )}
      >
        <input
          id={id}
          type="text"
          inputMode="decimal"
          role="spinbutton"
          autoComplete="off"
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          value={text}
          disabled={disabled}
          onChange={handleChange}
          onBlur={commitText}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={handleKeyDown}
          className={cn(
            "h-full min-w-0 flex-1 bg-transparent px-2.5 tabular-nums outline-none disabled:cursor-not-allowed",
            suffix && "pr-1",
            inputClassName,
          )}
        />
        {suffix && <span className="select-none pr-2.5 text-sm text-subtle">{suffix}</span>}
      </div>
    </div>
  );
}
