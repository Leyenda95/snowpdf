import { Check } from "lucide-react";
import { callMupdf } from "@/pdf/mupdf/client";
import type { CompressLevel } from "@/pdf/mupdf/ops";
import { cn } from "@/ui";
import type { OptionsProps, ToolModule } from "../types";
import { baseOf, processFiles, reductionText } from "../utils";
import { GroupLabel, OptionStack } from "./common";
import { t, type Msg } from "@/i18n";

interface CompressToolOptions {
  level: CompressLevel;
}

const LEVELS: { value: CompressLevel; title: Msg; text: Msg }[] = [
  { value: "high", title: "Extrema", text: "Máxima reducción. Las imágenes pierden bastante calidad." },
  { value: "medium", title: "Recomendada", text: "Buen equilibrio entre tamaño y calidad." },
  { value: "low", title: "Baja", text: "Poca reducción, casi sin pérdida de calidad." },
];

function CompressOptions({ options, onChange, disabled }: OptionsProps<CompressToolOptions>) {
  return (
    <OptionStack>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("Nivel de compresión")}>
        <GroupLabel>{t("Nivel de compresión")}</GroupLabel>
        {LEVELS.map((level) => {
          const selected = level.value === options.level;
          return (
            <button
              key={level.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange({ level: level.value })}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:cursor-not-allowed",
                selected
                  ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                  : "border-line-strong bg-surface hover:border-brand-400 hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
                  selected ? "border-brand-600 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-500" : "border-line-strong bg-surface",
                )}
              >
                {selected && <Check size={12} strokeWidth={3.5} aria-hidden />}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold text-fg">{t(level.title)}</span>
                <span className="text-[13px] leading-snug text-muted">{t(level.text)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </OptionStack>
  );
}

export const compressTool: ToolModule<CompressToolOptions> = {
  actionLabel: "Comprimir PDF",
  defaultOptions: () => ({ level: "medium" }),
  Options: CompressOptions,
  async run(files, options, ctx) {
    const { results, warnings } = await processFiles(files, ctx, t("Comprimiendo"), (file, report) =>
      callMupdf("compress", { bytes: file.bytes, level: options.level }, { onProgress: report }),
    );
    let before = 0;
    let after = 0;
    const outputs = results.map(({ file, value }) => {
      const smaller = value.bytes.length < file.bytes.length;
      const bytes = smaller ? value.bytes : file.bytes;
      before += file.bytes.length;
      after += bytes.length;
      return {
        name: `${baseOf(file.name)}${t("_comprimido")}.pdf`,
        bytes,
        kind: "pdf" as const,
        note: smaller ? reductionText(file.bytes.length, bytes.length) : t("Este archivo ya estaba bien optimizado: se mantiene igual."),
      };
    });
    return {
      summary: reductionText(before, after),
      outputs,
      zipName: t("pdf_comprimidos.zip"),
      warnings,
    };
  },
};
