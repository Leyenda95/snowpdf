import { parsePageRanges, parsePageSelection } from "@/pdf/ranges";
import { splitDocument, type SplitMode } from "@/pdf/tools";
import { NumberField, SegmentedControl, Switch, TextField } from "@/ui";
import type { OptionsProps, ToolFile, ToolModule } from "../types";
import { baseOf, messageOf, nextFrame, pluralize } from "../utils";
import { Note, OptionStack } from "./common";
import { t } from "@/i18n";

type Mode = "ranges" | "every" | "each" | "select";

interface SplitToolOptions {
  mode: Mode;
  ranges: string;
  mergeIntoOne: boolean;
  every: number;
  pages: string;
}

/** Number of files the current settings would create, or an error to show under the field. */
function plan(file: ToolFile | undefined, o: SplitToolOptions): { count: number; error: string | null } {
  const total = file?.pageCount ?? null;
  if (total === null) return { count: 0, error: null };
  try {
    switch (o.mode) {
      case "ranges": {
        if (o.ranges.trim() === "") return { count: 0, error: null };
        const groups = parsePageRanges(o.ranges, total).filter((g) => g.length > 0);
        return { count: o.mergeIntoOne ? Math.min(1, groups.length) : groups.length, error: null };
      }
      case "every":
        return { count: Math.ceil(total / Math.max(1, Math.floor(o.every || 1))), error: null };
      case "each":
        return { count: total, error: null };
      case "select":
        if (o.pages.trim() === "") return { count: 0, error: null };
        return { count: parsePageSelection(o.pages, total).length > 0 ? 1 : 0, error: null };
    }
  } catch (err) {
    return { count: 0, error: messageOf(err) };
  }
}

function SplitOptions({ files, options, onChange, disabled }: OptionsProps<SplitToolOptions>) {
  const file = files[0];
  const { count, error } = plan(file, options);
  const set = (patch: Partial<SplitToolOptions>) => onChange({ ...options, ...patch });
  const total = file?.pageCount ?? null;

  let preview: string | null = null;
  if (!error && count > 0) {
    preview =
      options.mode === "select"
        ? t("Se extraerán {pages} en 1 archivo", { pages: pluralize(parsePageSelection(options.pages, total ?? 0).length, t("página"), t("páginas")) })
        : count === 1
          ? t("Se creará 1 archivo")
          : t("Se crearán {n} archivos", { n: count });
  }

  return (
    <OptionStack>
      <SegmentedControl<Mode>
        label={t("Cómo dividir")}
        fullWidth
        size="sm"
        value={options.mode}
        onChange={(mode) => set({ mode })}
        options={[
          { value: "ranges", label: t("Rangos") },
          { value: "every", label: t("Cada N") },
          { value: "each", label: t("Todas") },
          { value: "select", label: t("Extraer") },
        ]}
      />

      {options.mode === "ranges" && (
        <>
          <TextField
            label={t("Rangos de páginas")}
            value={options.ranges}
            placeholder="1-3, 5, 8-"
            hint={t("Cada rango será un archivo. «8-» llega hasta la última página.")}
            error={error ?? undefined}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => set({ ranges: e.target.value })}
          />
          <Switch
            label={t("Unir todos los rangos en un solo PDF")}
            checked={options.mergeIntoOne}
            disabled={disabled}
            onChange={(mergeIntoOne) => set({ mergeIntoOne })}
          />
        </>
      )}

      {options.mode === "every" && (
        <NumberField
          label={t("Páginas por archivo")}
          min={1}
          max={Math.max(1, total ?? 9999)}
          value={options.every}
          disabled={disabled}
          onChange={(every) => set({ every })}
        />
      )}

      {options.mode === "each" && <Note>{t("Cada página del documento se guardará en un archivo independiente.")}</Note>}

      {options.mode === "select" && (
        <TextField
          label={t("Páginas que quieres extraer")}
          value={options.pages}
          placeholder="1-3, 5"
          hint={t("Se guardarán juntas en un único PDF.")}
          error={error ?? undefined}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => set({ pages: e.target.value })}
        />
      )}

      {total !== null && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-muted">
          {preview ?? t("El documento tiene {pages}.", { pages: pluralize(total, t("página"), t("páginas")) })}
        </p>
      )}
    </OptionStack>
  );
}

function toMode(o: SplitToolOptions): SplitMode {
  switch (o.mode) {
    case "ranges":
      return { kind: "ranges", ranges: o.ranges, mergeIntoOne: o.mergeIntoOne };
    case "every":
      return { kind: "every", size: o.every };
    case "each":
      return { kind: "each" };
    case "select":
      return { kind: "select", pages: o.pages };
  }
}

export const splitTool: ToolModule<SplitToolOptions> = {
  actionLabel: "Dividir PDF",
  defaultOptions: () => ({ mode: "ranges", ranges: "", mergeIntoOne: false, every: 1, pages: "" }),
  Options: SplitOptions,
  validate(files, options) {
    const { count, error } = plan(files[0], options);
    if (error) return error;
    if (options.mode === "ranges" && options.ranges.trim() === "") return t("Indica los rangos de páginas.");
    if (options.mode === "select" && options.pages.trim() === "") return t("Indica las páginas que quieres extraer.");
    return count === 0 && files[0]?.pageCount ? t("No hay nada que crear con estos ajustes.") : null;
  },
  async run(files, options, ctx) {
    const file = files[0];
    ctx.onProgress(undefined, t("Dividiendo el documento…"));
    await nextFrame();
    const base = baseOf(file.name);
    const parts = await splitDocument(file.bytes, base, toMode(options));
    return {
      summary: parts.length === 1 ? t("Se ha creado 1 archivo") : t("Se han creado {files}", { files: pluralize(parts.length, t("archivo"), t("archivos")) }),
      outputs: parts.map((p) => ({ name: p.name, bytes: p.bytes, kind: "pdf" as const })),
      zipName: `${base}${t("_dividido")}.zip`,
      warnings: [],
    };
  },
};
