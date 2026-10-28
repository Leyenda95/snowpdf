import { callMupdf } from "@/pdf/mupdf/client";
import { parsePageSelection } from "@/pdf/ranges";
import { SegmentedControl, Slider } from "@/ui";
import type { OptionsProps, ToolModule } from "../types";
import { baseOf, pluralize } from "../utils";
import { OptionStack, PagesField, pagesError } from "./common";
import { t } from "@/i18n";

type Format = "jpg" | "png";
type Dpi = "72" | "150" | "300";

interface PdfToImagesToolOptions {
  format: Format;
  dpi: Dpi;
  quality: number;
  pages: string;
}

function PdfToImagesOptions({ files, options, onChange, disabled }: OptionsProps<PdfToImagesToolOptions>) {
  const set = (patch: Partial<PdfToImagesToolOptions>) => onChange({ ...options, ...patch });
  return (
    <OptionStack>
      <SegmentedControl<Format>
        label={t("Formato")}
        fullWidth
        size="sm"
        value={options.format}
        onChange={(format) => set({ format })}
        options={[
          { value: "jpg", label: "JPG" },
          { value: "png", label: "PNG" },
        ]}
      />
      <SegmentedControl<Dpi>
        label={t("Resolución")}
        fullWidth
        size="sm"
        value={options.dpi}
        onChange={(dpi) => set({ dpi })}
        options={[
          { value: "72", label: t("Baja · 72"), title: t("Baja: 72 ppp (pantalla)") },
          { value: "150", label: t("Normal · 150"), title: t("Normal: 150 ppp") },
          { value: "300", label: t("Alta · 300"), title: t("Alta: 300 ppp (impresión)") },
        ]}
      />
      {options.format === "jpg" && (
        <Slider
          label={t("Calidad JPEG")}
          min={30}
          max={100}
          step={5}
          value={options.quality}
          disabled={disabled}
          format={(v) => `${v} %`}
          onChange={(quality) => set({ quality })}
        />
      )}
      <PagesField value={options.pages} files={files} disabled={disabled} onChange={(pages) => set({ pages })} />
    </OptionStack>
  );
}

export const pdfToImagesTool: ToolModule<PdfToImagesToolOptions> = {
  actionLabel: "Convertir a imágenes",
  defaultOptions: () => ({ format: "jpg", dpi: "150", quality: 85, pages: "" }),
  Options: PdfToImagesOptions,
  validate: (files, options) => pagesError(options.pages, files),
  async run(files, options, ctx) {
    const file = files[0];
    const base = baseOf(file.name);
    const pages = file.pageCount ? parsePageSelection(options.pages, file.pageCount) : [];
    ctx.onProgress(0, t("Convirtiendo páginas…"));
    const rendered = await callMupdf(
      "renderPages",
      { bytes: file.bytes, options: { pages, dpi: Number(options.dpi), format: options.format, quality: options.quality } },
      { onProgress: (f) => ctx.onProgress(f, t("Convirtiendo páginas…")) },
    );
    ctx.onProgress(1);
    return {
      summary: rendered.length === 1 ? t("Se ha creado 1 imagen") : t("Se han creado {files}", { files: pluralize(rendered.length, t("imagen"), t("imágenes")) }),
      outputs: rendered.map((page) => ({
        name: `${base}${t("_pagina_{n}", { n: page.pageIndex + 1 })}.${options.format}`,
        bytes: page.bytes,
        kind: options.format,
        note: `${page.width} × ${page.height} px`,
      })),
      zipName: `${base}${t("_imagenes")}.zip`,
      warnings: [],
    };
  },
};
