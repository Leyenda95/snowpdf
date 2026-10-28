import { cropPages } from "@/pdf/tools";
import { NumberField, Switch } from "@/ui";
import type { OptionsProps, ToolFile, ToolModule } from "../types";
import { baseOf, pluralize, processFiles } from "../utils";
import { Note, OptionStack, PagesField, pagesError } from "./common";
import { t } from "@/i18n";

interface CropToolOptions {
  top: number;
  right: number;
  bottom: number;
  left: number;
  same: boolean;
  pages: string;
}

const MM_TO_PT = 72 / 25.4;
const MIN_SIZE_PT = 36;

function CropOptions({ files, options, onChange, disabled }: OptionsProps<CropToolOptions>) {
  const set = (patch: Partial<CropToolOptions>) => onChange({ ...options, ...patch });
  const setSide = (side: "top" | "right" | "bottom" | "left", value: number) =>
    options.same ? set({ top: value, right: value, bottom: value, left: value }) : set({ [side]: value });
  const field = (side: "top" | "right" | "bottom" | "left", label: string) => (
    <NumberField label={label} suffix="mm" min={0} max={500} step={1} value={options[side]} disabled={disabled} onChange={(v) => setSide(side, v)} />
  );
  return (
    <OptionStack>
      <Note>{t("Indica cuánto quieres recortar de cada borde. El recuadro punteado de la vista previa muestra lo que se conserva.")}</Note>
      <Switch
        label={t("Mismo margen en todos los lados")}
        checked={options.same}
        disabled={disabled}
        onChange={(same) => set(same ? { same, right: options.top, bottom: options.top, left: options.top } : { same })}
      />
      {options.same ? (
        field("top", t("Margen a recortar"))
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {field("top", t("Arriba"))}
          {field("right", t("Derecha"))}
          {field("bottom", t("Abajo"))}
          {field("left", t("Izquierda"))}
        </div>
      )}
      <PagesField value={options.pages} files={files} disabled={disabled} onChange={(pages) => set({ pages })} />
    </OptionStack>
  );
}

function Overlay({ file, options }: { file: ToolFile; options: CropToolOptions }) {
  if (!file.pageSize) return null;
  const { width, height } = file.pageSize;
  const pct = (mm: number, total: number) => `${Math.min(100, (mm * MM_TO_PT * 100) / total)}%`;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute border border-dashed border-brand-500 shadow-[0_0_0_999px_rgb(15_23_42/0.45)]"
        style={{
          top: pct(options.top, height),
          bottom: pct(options.bottom, height),
          left: pct(options.left, width),
          right: pct(options.right, width),
        }}
      />
    </div>
  );
}

export const cropTool: ToolModule<CropToolOptions> = {
  actionLabel: "Recortar PDF",
  cardSize: "lg",
  defaultOptions: () => ({ top: 10, right: 10, bottom: 10, left: 10, same: true, pages: "" }),
  Options: CropOptions,
  validate(files, options) {
    const error = pagesError(options.pages, files);
    if (error) return error;
    for (const file of files) {
      if (!file.pageSize) continue;
      const w = file.pageSize.width - (options.left + options.right) * MM_TO_PT;
      const h = file.pageSize.height - (options.top + options.bottom) * MM_TO_PT;
      if (w < MIN_SIZE_PT || h < MIN_SIZE_PT) return t("Los márgenes son demasiado grandes para el tamaño de la página.");
    }
    return null;
  },
  cardExtras: (file, options) => ({ overlay: <Overlay file={file} options={options} /> }),
  async run(files, options, ctx) {
    const margins = {
      top: options.top * MM_TO_PT,
      right: options.right * MM_TO_PT,
      bottom: options.bottom * MM_TO_PT,
      left: options.left * MM_TO_PT,
    };
    const { results, warnings } = await processFiles(files, ctx, t("Recortando"), (file) => cropPages(file.bytes, { margins, pages: options.pages }));
    return {
      summary: pluralize(results.length, t("archivo recortado"), t("archivos recortados")),
      outputs: results.map(({ file, value }) => ({ name: `${baseOf(file.name)}${t("_recortado")}.pdf`, bytes: value, kind: "pdf" as const })),
      zipName: t("pdf_recortados.zip"),
      warnings,
    };
  },
};
