import { useEffect, useId, useRef, type CSSProperties } from "react";
import { cn } from "./cn";
import { LABEL_CLASS } from "./fieldStyles";
import { useLatest } from "./hooks";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label?: string;
  /** Formats the value shown at the right of the label. */
  format?: (value: number) => string;
  disabled?: boolean;
  /** Fires once when the user finishes a change (pointer released / key pressed). */
  onCommit?: (value: number) => void;
  className?: string;
}

const THUMB = 16;

// Native range input skinned through vendor pseudo-elements. Written out in full so Tailwind finds every class.
const RANGE_CLASS = cn(
  "h-5 w-full cursor-pointer appearance-none rounded-full bg-transparent outline-none",
  "disabled:cursor-not-allowed disabled:opacity-50",
  // Chromium / WebKit
  "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent",
  "[&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none",
  "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-solid [&::-webkit-slider-thumb]:border-brand-500",
  "[&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:transition-shadow",
  "[&:focus-visible::-webkit-slider-thumb]:ring-4 [&:focus-visible::-webkit-slider-thumb]:ring-brand-500/30",
  "[&:active::-webkit-slider-thumb]:ring-4 [&:active::-webkit-slider-thumb]:ring-brand-500/20",
  // Firefox
  "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent",
  "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-solid [&::-moz-range-thumb]:border-brand-500",
  "[&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow",
);

export function Slider({ value, onChange, min, max, step = 1, label, format, disabled, onCommit, className }: SliderProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const commit = useLatest(onCommit);

  // The native `change` event of a range input fires when an interaction ends.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const handle = () => commit.current?.(Number(input.value));
    input.addEventListener("change", handle);
    return () => input.removeEventListener("change", handle);
  }, [commit]);

  const ratio = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  // Filled part of the rail, ending under the centre of the thumb.
  const fill = `calc(${THUMB / 2}px + ${ratio} * (100% - ${THUMB}px))`;
  const railStyle: CSSProperties = {
    backgroundImage: "linear-gradient(var(--color-brand-500), var(--color-brand-500)), linear-gradient(var(--line-strong), var(--line-strong))",
    backgroundSize: `${fill} 6px, 100% 6px`,
    backgroundPosition: "left center, left center",
    backgroundRepeat: "no-repeat",
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {(label || format) && (
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={id} className={LABEL_CLASS}>
            {label}
          </label>
          <span className="text-xs tabular-nums text-fg">{format ? format(value) : value}</span>
        </div>
      )}
      <input
        ref={inputRef}
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className={RANGE_CLASS}
        style={railStyle}
      />
    </div>
  );
}
