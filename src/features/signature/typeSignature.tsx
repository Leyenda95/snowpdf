import { useEffect, useMemo, useState } from "react";
import { TextField, cn } from "@/ui";
import { InkPicker } from "./InkPicker";
import type { SignatureKind, SignatureSource } from "./types";
import { t } from "@/i18n";

/** Handwriting fonts that ship with Windows / Office / macOS, with generic fallbacks (fully offline). */
export const SIGNATURE_FONTS = [
  `"Segoe Script", "Snell Roundhand", cursive`,
  `"Lucida Handwriting", "Apple Chancery", cursive`,
  `"Ink Free", "Bradley Hand", cursive`,
  `"Segoe Print", "Chalkboard SE", cursive`,
  `"Gabriola", "Zapfino", cursive`,
  `"Brush Script MT", "Brush Script Std", cursive`,
] as const;

const RENDER_FONT_SIZE = 110;

function renderText(text: string, family: string, color: string): HTMLCanvasElement {
  const font = `${RENDER_FONT_SIZE}px ${family}`;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = font;
  const textWidth = Math.ceil(probe.measureText(text).width);
  const pad = Math.round(RENDER_FONT_SIZE * 0.5);
  const canvas = document.createElement("canvas");
  canvas.width = textWidth + pad * 2;
  canvas.height = Math.round(RENDER_FONT_SIZE * 2.2);
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, pad, Math.round(RENDER_FONT_SIZE * 1.4));
  return canvas;
}

export interface TypeSignatureProps {
  kind: SignatureKind;
  color: string;
  onColorChange: (color: string) => void;
  onSourceChange: (source: SignatureSource | null) => void;
}

export function TypeSignature({ kind, color, onColorChange, onSourceChange }: TypeSignatureProps) {
  const [text, setText] = useState("");
  const [fontIndex, setFontIndex] = useState(0);
  const placeholder = kind === "firma" ? t("Tu nombre") : t("Iniciales");
  const trimmed = text.trim();
  const previewText = trimmed || placeholder;
  const family = SIGNATURE_FONTS[fontIndex];

  const source = useMemo<SignatureSource | null>(
    () => (trimmed ? () => renderText(trimmed, family, color) : null),
    [trimmed, family, color],
  );
  useEffect(() => onSourceChange(source), [source, onSourceChange]);

  return (
    <div className="flex flex-col gap-4">
      <TextField
        label={kind === "firma" ? t("Nombre") : t("Iniciales")}
        value={text}
        placeholder={placeholder}
        maxLength={60}
        onChange={(e) => setText(e.target.value)}
      />
      <div role="radiogroup" aria-label={t("Estilo de letra")} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {SIGNATURE_FONTS.map((fontFamily, i) => {
          const selected = i === fontIndex;
          return (
            <button
              key={fontFamily}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setFontIndex(i)}
              className={cn(
                "flex h-20 items-center justify-center overflow-hidden rounded-xl border bg-white px-3 outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-brand-500/60",
                selected ? "border-brand-500 ring-2 ring-brand-500/30" : "border-line-strong hover:border-brand-400",
              )}
            >
              <span
                className={cn("max-w-full truncate text-[28px] leading-[1.6]", !trimmed && "opacity-40")}
                style={{ fontFamily, color }}
              >
                {previewText}
              </span>
            </button>
          );
        })}
      </div>
      <InkPicker value={color} onChange={onColorChange} />
    </div>
  );
}
