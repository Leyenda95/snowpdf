import { cn } from "@/ui";
import { t, type Msg } from "@/i18n";

export const INK_COLORS = [
  { value: "#111827", label: "Negro" },
  { value: "#1d4ed8", label: "Azul" },
  { value: "#1e3a8a", label: "Azul oscuro" },
] as const satisfies readonly { value: string; label: Msg }[];

export const DEFAULT_INK = INK_COLORS[0].value;

export interface InkPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export function InkPicker({ value, onChange }: InkPickerProps) {
  return (
    <div role="radiogroup" aria-label={t("Color de tinta")} className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted">{t("Tinta")}</span>
      {INK_COLORS.map((ink) => {
        const selected = ink.value === value;
        return (
          <button
            key={ink.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={t(ink.label)}
            title={t(ink.label)}
            onClick={() => onChange(ink.value)}
            className={cn(
              "size-6 rounded-full border-2 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-brand-500/60",
              selected ? "border-brand-500 ring-2 ring-brand-500/30" : "border-line-strong hover:border-subtle",
            )}
            style={{ backgroundColor: ink.value }}
          />
        );
      })}
    </div>
  );
}
