import { useEffect, useId, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "./cn";
import { LABEL_CLASS } from "./fieldStyles";
import { Popover } from "./Popover";
import { t } from "@/i18n";

export interface ColorPickerProps {
  /** "#rrggbb" or null for "no colour". */
  value: string | null;
  onChange: (value: string | null) => void;
  presets?: string[];
  label?: string;
  /** Adds a "Sin color" option that calls onChange(null). */
  allowNone?: boolean;
  className?: string;
}

export const DEFAULT_COLOR_PRESETS = [
  "#000000", // black
  "#404040", // dark grey
  "#9ca3af", // grey
  "#ffffff", // white
  "#ef4444", // red
  "#f97316", // orange
  "#facc15", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#a855f7", // purple
];

/** White square crossed by a red diagonal: the universal "no colour" swatch. */
const NONE_BACKGROUND =
  "linear-gradient(to top right, transparent calc(50% - 1px), #ef4444 calc(50% - 1px), #ef4444 calc(50% + 1px), transparent calc(50% + 1px))";

/** Accepts "#abc", "abc", "#aabbcc" (any case) and returns "#rrggbb" lowercase, or null. */
function normalizeHex(input: string): string | null {
  const hex = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  return null;
}

function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

function Swatch({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block shrink-0 border border-black/15 dark:border-white/25", className)}
      style={color ? { backgroundColor: color } : { backgroundColor: "#ffffff", backgroundImage: NONE_BACKGROUND }}
    />
  );
}

function ColorPanel({
  value,
  onChange,
  presets,
  allowNone,
}: Required<Pick<ColorPickerProps, "value" | "onChange" | "presets">> & { allowNone: boolean }) {
  const [hex, setHex] = useState(value ?? "");
  useEffect(() => setHex(value ?? ""), [value]);

  return (
    <div className="flex w-56 flex-col gap-3">
      {allowNone && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            "flex h-8 items-center gap-2.5 rounded-lg px-2 text-sm text-fg outline-none transition-colors hover:bg-surface-3",
            "focus-visible:ring-2 focus-visible:ring-brand-500/50",
            value === null && "bg-surface-3",
          )}
        >
          <Swatch color={null} className="size-5 rounded-md" />
          <span className="flex-1 text-left">{t("Sin color")}</span>
          {value === null && <Check size={16} aria-hidden className="text-brand-600 dark:text-brand-300" />}
        </button>
      )}

      <div className="grid grid-cols-6 gap-2">
        {presets.map((preset) => {
          const selected = value?.toLowerCase() === preset.toLowerCase();
          return (
            <button
              key={preset}
              type="button"
              aria-label={preset}
              aria-pressed={selected}
              title={preset}
              onClick={() => onChange(preset)}
              style={{ backgroundColor: preset }}
              className={cn(
                "grid size-7 place-items-center rounded-lg border border-black/15 outline-none transition-transform dark:border-white/25",
                "hover:scale-110 focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                selected && "ring-2 ring-brand-500 ring-offset-2 ring-offset-surface",
              )}
            >
              {selected && (
                <Check size={14} strokeWidth={3} aria-hidden className={isLight(preset) ? "text-slate-900" : "text-white"} />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 border-t border-line pt-3">
        <input
          type="color"
          aria-label={t("Elegir un color personalizado")}
          value={value ?? "#000000"}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className={cn(
            "size-8 shrink-0 cursor-pointer appearance-none rounded-lg border border-line-strong bg-transparent p-0.5 outline-none",
            "focus-visible:ring-2 focus-visible:ring-brand-500/50",
            "[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0",
            "[&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-0",
          )}
        />
        <input
          type="text"
          aria-label={t("Código de color hexadecimal")}
          placeholder="#000000"
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          value={hex}
          onChange={(e) => {
            setHex(e.target.value);
            const normalized = normalizeHex(e.target.value);
            if (normalized) onChange(normalized);
          }}
          onBlur={() => setHex(value ?? "")}
          className="h-8 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-2.5 font-mono text-sm uppercase text-fg outline-none placeholder:text-subtle hover:border-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        />
      </div>
    </div>
  );
}

export function ColorPicker({
  value,
  onChange,
  presets = DEFAULT_COLOR_PRESETS,
  label,
  allowNone = false,
  className,
}: ColorPickerProps) {
  const labelId = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <span id={labelId} className={LABEL_CLASS}>
          {label}
        </span>
      )}
      <Popover
        align="start"
        trigger={
          <button
            type="button"
            aria-labelledby={label ? labelId : undefined}
            aria-label={label ? undefined : t("Elegir color")}
            aria-description={value ?? t("Sin color")}
            className={cn(
              "inline-grid size-9 place-items-center rounded-lg border border-line-strong bg-surface outline-none transition-colors",
              "hover:border-subtle focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40",
            )}
          >
            <Swatch color={value} className="size-6 rounded-md" />
          </button>
        }
      >
        <ColorPanel value={value} onChange={onChange} presets={presets} allowNone={allowNone} />
      </Popover>
    </div>
  );
}
