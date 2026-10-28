import { callMupdf } from "@/pdf/mupdf/client";
import type { OptionsProps, ToolModule } from "../types";
import { baseOf, pluralize, processFiles } from "../utils";
import { Note, OptionStack } from "./common";
import { t } from "@/i18n";

/** Repair and flatten: no options beyond an explanation. */

function RepairOptions(_props: OptionsProps<null>) {
  return (
    <OptionStack>
      <Note>
        {t("Reconstruye la estructura interna de los archivos dañados o que no abren bien y guarda una copia limpia. Si el archivo está muy dañado, puede que no se recupere todo el contenido.")}
      </Note>
    </OptionStack>
  );
}

function FlattenOptions(_props: OptionsProps<null>) {
  return (
    <OptionStack>
      <Note>
        {t("Convierte los campos de formulario rellenados y las anotaciones en contenido fijo de la página. El resultado ya no se puede editar, pero se ve igual en cualquier lector.")}
      </Note>
    </OptionStack>
  );
}

export const repairTool: ToolModule<null> = {
  actionLabel: "Reparar PDF",
  defaultOptions: () => null,
  Options: RepairOptions,
  async run(files, _options, ctx) {
    const { results, warnings } = await processFiles(files, ctx, t("Reparando"), (file) => callMupdf("repair", { bytes: file.bytes }));
    const fixed = results.filter((r) => r.value.repaired).length;
    return {
      summary:
        fixed === 0
          ? t("{files}: no se encontraron daños", { files: pluralize(results.length, t("archivo revisado"), t("archivos revisados")) })
          : t("{files} de {total}", { files: pluralize(fixed, t("archivo reparado"), t("archivos reparados")), total: results.length }),
      outputs: results.map(({ file, value }) => ({
        name: `${baseOf(file.name)}${t("_reparado")}.pdf`,
        bytes: value.bytes,
        kind: "pdf" as const,
        note: value.repaired ? t("Se han corregido errores en su estructura.") : t("No tenía errores: se guarda una copia limpia."),
      })),
      zipName: t("pdf_reparados.zip"),
      warnings,
    };
  },
};

export const flattenTool: ToolModule<null> = {
  actionLabel: "Aplanar PDF",
  defaultOptions: () => null,
  Options: FlattenOptions,
  async run(files, _options, ctx) {
    const { results, warnings } = await processFiles(files, ctx, t("Aplanando"), (file) =>
      callMupdf("bake", { bytes: file.bytes, annotations: true, widgets: true }),
    );
    return {
      summary: pluralize(results.length, t("archivo aplanado"), t("archivos aplanados")),
      outputs: results.map(({ file, value }) => ({ name: `${baseOf(file.name)}${t("_aplanado")}.pdf`, bytes: value, kind: "pdf" as const })),
      zipName: t("pdf_aplanados.zip"),
      warnings,
    };
  },
};
