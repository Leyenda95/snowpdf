import { useEffect, useRef } from "react";
import { cn } from "./cn";

export interface ProgressBarProps {
  /** 0..1. Leave undefined for an indeterminate bar. */
  value?: number;
  label?: string;
  className?: string;
}

export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const indeterminate = value === undefined;
  const pct = indeterminate ? 0 : Math.round(Math.min(1, Math.max(0, value)) * 100);
  const sliderRef = useRef<HTMLDivElement>(null);

  // The indeterminate bar slides back and forth (Web Animations API: no custom CSS needed).
  useEffect(() => {
    const el = sliderRef.current;
    if (!indeterminate || !el || typeof el.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = el.animate(
      [{ transform: "translateX(-100%)" }, { transform: "translateX(260%)" }],
      { duration: 1400, iterations: Infinity, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
    );
    return () => animation.cancel();
  }, [indeterminate]);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {(label || !indeterminate) && (
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="truncate text-muted">{label}</span>
          {!indeterminate && <span className="tabular-nums text-fg">{pct} %</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : pct}
        className="relative h-2 w-full overflow-hidden rounded-full bg-surface-3"
      >
        {indeterminate ? (
          <div ref={sliderRef} className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-brand-500 motion-reduce:animate-pulse" />
        ) : (
          <div
            className="h-full rounded-full bg-brand-500 transition-[width] duration-200 ease-out motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}
