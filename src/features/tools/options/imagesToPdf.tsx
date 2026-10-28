import { imagesToPdf, type ImagePageSize } from "@/pdf/tools";
import { SegmentedControl, Select, Switch } from "@/ui";
import type { OptionsProps, ToolFile, ToolModule } from "../types";
import { baseOf, nextFrame, pluralize, processFiles } from "../utils";
import { IMAGE_SIZE_OPTIONS } from "./merge";
import { Note, OptionStack } from "./common";
import { t } from "@/i18n";

type Orientation = "auto" | "portrait" | "landscape";
type Margin = "0" | "18" | "36";

interface ImagesToPdfToolOptions {
  pageSize: ImagePageSize;
  orientation: Orientation;
  margin: Margin;
  onePerImage: boolean;
}

function ImagesToPdfOptions({ options, onChange, disabled }: OptionsProps<ImagesToPdfToolOptions>) {
  const set = (patch: Partial<ImagesToPdfToolOptions>) => onChange({ ...options, ...patch });
  const fit = options.pageSize === "fit";
  return (
    <OptionStack>
      <Note>{t("Arrastra las imágenes para cambiar el orden de las páginas.")}</Note>
      <Select
        label={t("Tamaño de página")}
        value={options.pageSize}
        options={IMAGE_SIZE_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
        disabled={disabled}
        onChange={(pageSize) => set({ pageSize })}
      />
      <SegmentedControl<Orientation>
        label={t("Orientación")}
        fullWidth
        size="sm"
        value={options.orientation}
        onChange={(orientation) => set({ orientation })}
        options={[
          { value: "auto", label: t("Automática") },
          { value: "portrait", label: t("Vertical") },
          { value: "landscape", label: t("Horizontal") },
        ]}
        className={fit || disabled ? "pointer-events-none opacity-50" : undefined}
      />
      <SegmentedControl<Margin>
        label={t("Margen")}
        fullWidth
        size="sm"
        value={options.margin}
        onChange={(margin) => set({ margin })}
        options={[
          { value: "0", label: t("Sin margen") },
          { value: "18", label: t("Pequeño") },
          { value: "36", label: t("Grande") },
        ]}
        className={disabled ? "pointer-events-none opacity-50" : undefined}
      />
      <Switch
        label={t("Un PDF por imagen")}
        description={t("Si lo desactivas, todas las imágenes van en un único PDF.")}
        checked={options.onePerImage}
        disabled={disabled}
        onChange={(onePerImage) => set({ onePerImage })}
      />
    </OptionStack>
  );
}

function toInput(file: ToolFile) {
  return { bytes: file.bytes, mime: file.mime ?? "image/jpeg", name: file.name };
}

export const imagesToPdfTool: ToolModule<ImagesToPdfToolOptions> = {
  actionLabel: "Crear PDF",
  sortable: true,
  defaultOptions: () => ({ pageSize: "A4", orientation: "auto", margin: "18", onePerImage: false }),
  Options: ImagesToPdfOptions,
  async run(files, options, ctx) {
    const layout = { pageSize: options.pageSize, orientation: options.orientation, margin: Number(options.margin) };
    if (options.onePerImage && files.length > 1) {
      const { results, warnings } = await processFiles(files, ctx, t("Convirtiendo"), (file) => imagesToPdf([toInput(file)], layout));
      return {
        summary: t("Se han creado {files}", { files: pluralize(results.length, "PDF", "PDF") }),
        outputs: results.map(({ file, value }) => ({ name: `${baseOf(file.name)}.pdf`, bytes: value, kind: "pdf" as const })),
        zipName: t("imagenes_a_pdf.zip"),
        warnings,
      };
    }
    ctx.onProgress(undefined, t("Creando el PDF…"));
    await nextFrame();
    const bytes = await imagesToPdf(files.map(toInput), layout);
    const base = baseOf(files[0].name);
    return {
      summary: t("PDF de {pages} creado", { pages: pluralize(files.length, t("página"), t("páginas")) }),
      outputs: [{ name: files.length === 1 ? `${base}.pdf` : `${base}${t("_imagenes")}.pdf`, bytes, kind: "pdf" }],
      zipName: `${base}.zip`,
      warnings: [],
    };
  },
};
