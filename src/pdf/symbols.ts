import type { Msg } from "@/i18n";
import type { SymbolName } from "@/model/types";

/** Fill & Sign symbols as SVG paths in a 24×24 box (y down). Used on screen and in the PDF. */
export const SYMBOL_PATHS: Record<SymbolName, { d: string; mode: "stroke" | "fill"; strokeWidth: number }> = {
  check: { d: "M4.5 12.5 L9.5 17.5 L19.5 6.5", mode: "stroke", strokeWidth: 2.6 },
  cross: { d: "M6 6 L18 18 M18 6 L6 18", mode: "stroke", strokeWidth: 2.6 },
  dot: { d: "M6 12 A6 6 0 1 0 18 12 A6 6 0 1 0 6 12 Z", mode: "fill", strokeWidth: 0 },
  circle: { d: "M3.5 12 A8.5 8.5 0 1 0 20.5 12 A8.5 8.5 0 1 0 3.5 12 Z", mode: "stroke", strokeWidth: 2 },
};

/** Spanish source text: translate with `t()` where shown. */
export const SYMBOL_LABELS: Record<SymbolName, Msg> = {
  check: "Marca de verificación",
  cross: "Aspa",
  dot: "Punto",
  circle: "Círculo",
};

/** Arrow head size for a given stroke width and segment length (points). */
export function arrowHead(strokeWidth: number, length: number): { length: number; width: number } {
  const l = Math.min(Math.max(8, strokeWidth * 4), length / 1.5);
  return { length: l, width: l * 0.9 };
}
