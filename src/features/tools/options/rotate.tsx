import { RotateCcw, RotateCw } from "lucide-react";
import { parsePageSelection } from "@/pdf/ranges";
import { rotatePages } from "@/pdf/tools";
import { SegmentedControl } from "@/ui";
import type { OptionsProps, ToolFile, ToolModule } from "../types";
import { baseOf, pluralize, processFiles } from "../utils";
import { OptionStack, PagesField, pagesError } from "./common";
import { t } from "@/i18n";

type Angle = "90" | "180" | "270";

interface RotateToolOptions {
  angle: Angle;
  pages: string;
}

function RotateOptions({ files, options, onChange, disabled }: OptionsProps<RotateToolOptions>) {
  return (
    <OptionStack>
      <SegmentedControl<Angle>
        label={t("Giro (en sentido horario)")}
        fullWidth
        size="sm"
        value={options.angle}
        onChange={(angle) => onChange({ ...options, angle })}
        options={[
          { value: "90", label: t("90° dcha."), icon: RotateCw, title: t("90° a la derecha") },
          { value: "180", label: "180°", title: "180°" },
          { value: "270", label: t("90° izq."), icon: RotateCcw, title: t("90° a la izquierda") },
        ]}
      />
      <PagesField
        value={options.pages}
        files={files}
        disabled={disabled}
        onChange={(pages) => onChange({ ...options, pages })}
      />
    </OptionStack>
  );
}

/** True when the first page is among the pages that will turn (the thumbnail shows page 1). */
function turnsFirstPage(file: ToolFile, pages: string): boolean {
  if (file.pageCount === null) return false;
  try {
    return parsePageSelection(pages, file.pageCount).includes(0);
  } catch {
    return false;
  }
}

export const rotateTool: ToolModule<RotateToolOptions> = {
  actionLabel: "Rotar PDF",
  defaultOptions: () => ({ angle: "90", pages: "" }),
  Options: RotateOptions,
  validate: (files, options) => pagesError(options.pages, files),
  cardExtras: (file, options) => ({ rotation: turnsFirstPage(file, options.pages) ? Number(options.angle) : 0 }),
  async run(files, options, ctx) {
    const { results, warnings } = await processFiles(files, ctx, t("Girando"), async (file) =>
      rotatePages(file.bytes, { angle: Number(options.angle) as 90 | 180 | 270, pages: options.pages }),
    );
    return {
      summary: pluralize(results.length, t("archivo girado"), t("archivos girados")),
      outputs: results.map(({ file, value }) => ({ name: `${baseOf(file.name)}${t("_rotado")}.pdf`, bytes: value, kind: "pdf" as const })),
      zipName: t("pdf_rotados.zip"),
      warnings,
    };
  },
};
