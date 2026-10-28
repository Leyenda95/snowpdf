import { mergeDocuments, type ImagePageSize } from "@/pdf/tools";
import { Select, Switch } from "@/ui";
import type { OptionsProps, ToolModule } from "../types";
import { baseOf, nextFrame, pluralize } from "../utils";
import { Note, OptionStack } from "./common";
import { t, type Msg } from "@/i18n";

export const IMAGE_SIZE_OPTIONS: { value: ImagePageSize; label: Msg }[] = [
  { value: "fit", label: "Ajustar a la imagen" },
  { value: "A4", label: "A4" },
  { value: "Letter", label: "Carta" },
];

interface MergeToolOptions {
  bookmarks: boolean;
  imageSize: ImagePageSize;
}

function MergeOptions({ files, options, onChange, disabled }: OptionsProps<MergeToolOptions>) {
  const hasImages = files.some((f) => f.kind === "image");
  return (
    <OptionStack>
      <Note>{t("Arrastra los archivos para cambiar el orden: el PDF final seguirá el mismo orden.")}</Note>
      <Switch
        label={t("Añadir marcadores con el nombre de cada archivo")}
        description={t("Facilita saltar de un documento a otro.")}
        checked={options.bookmarks}
        disabled={disabled}
        onChange={(bookmarks) => onChange({ ...options, bookmarks })}
      />
      {hasImages && (
        <Select
          label={t("Tamaño de página para las imágenes")}
          value={options.imageSize}
          options={IMAGE_SIZE_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
          disabled={disabled}
          onChange={(imageSize) => onChange({ ...options, imageSize })}
        />
      )}
    </OptionStack>
  );
}

export const mergeTool: ToolModule<MergeToolOptions> = {
  actionLabel: "Unir PDF",
  minFiles: 2,
  sortable: true,
  defaultOptions: () => ({ bookmarks: false, imageSize: "A4" }),
  Options: MergeOptions,
  validate: (files) => (files.length < 2 ? t("Añade al menos dos archivos para unirlos.") : null),
  async run(files, options, ctx) {
    ctx.onProgress(undefined, t("Uniendo archivos…"));
    await nextFrame();
    const bytes = await mergeDocuments(
      files.map((f) => ({ name: f.name, bytes: f.bytes, kind: f.kind, mime: f.mime })),
      { bookmarks: options.bookmarks, imagePageSize: options.imageSize },
    );
    const pages = files.every((f) => f.pageCount !== null) ? files.reduce((sum, f) => sum + (f.pageCount ?? 0), 0) : null;
    const base = baseOf(files[0].name);
    return {
      summary: pages
        ? t("{files} en un PDF de {pages}", { files: pluralize(files.length, t("archivo unido"), t("archivos unidos")), pages: pluralize(pages, t("página"), t("páginas")) })
        : pluralize(files.length, t("archivo unido"), t("archivos unidos")),
      outputs: [{ name: `${base}${t("_unido")}.pdf`, bytes, kind: "pdf" }],
      zipName: `${base}${t("_unido")}.zip`,
      warnings: [],
    };
  },
};
