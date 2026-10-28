import type { FontFamily } from "@/model/types";
import { CSS_FONT_STACKS } from "@/pdf/fonts";
import { parsePageSelection } from "@/pdf/ranges";
import { addPageNumbers, type NumberPosition } from "@/pdf/tools";
import { ColorPicker, NumberField, Select, TextField } from "@/ui";
import type { OptionsProps, ToolFile, ToolModule } from "../types";
import { baseOf, pluralize, processFiles } from "../utils";
import { OptionStack, PagesField, PositionGrid, pagesError } from "./common";
import { t, type Msg } from "@/i18n";

type Preset = "n" | "pagina" | "pagina_de" | "slash" | "custom";

/** Spanish source; translated when stamped. */
const PRESET_TEMPLATES: Record<Exclude<Preset, "custom">, Msg> = {
  n: "{n}",
  pagina: "Página {n}",
  pagina_de: "Página {n} de {total}",
  slash: "{n} / {total}",
};

interface PageNumbersToolOptions {
  position: NumberPosition;
  preset: Preset;
  custom: string;
  startAt: number;
  pages: string;
  font: FontFamily;
  size: number;
  color: string;
  margin: number;
}

const POSITION_ROWS: NumberPosition[][] = [
  ["top-left", "top-center", "top-right"],
  ["bottom-left", "bottom-center", "bottom-right"],
];

const POSITION_LABELS: Record<NumberPosition, Msg> = {
  "top-left": "Arriba a la izquierda",
  "top-center": "Arriba al centro",
  "top-right": "Arriba a la derecha",
  "bottom-left": "Abajo a la izquierda",
  "bottom-center": "Abajo al centro",
  "bottom-right": "Abajo a la derecha",
};

function templateOf(o: PageNumbersToolOptions): string {
  return o.preset === "custom" ? o.custom : t(PRESET_TEMPLATES[o.preset]);
}

function PageNumbersOptions({ files, options, onChange, disabled }: OptionsProps<PageNumbersToolOptions>) {
  const set = (patch: Partial<PageNumbersToolOptions>) => onChange({ ...options, ...patch });
  return (
    <OptionStack>
      <PositionGrid<NumberPosition>
        label={t("Posición")}
        rows={POSITION_ROWS}
        labels={POSITION_LABELS}
        value={options.position}
        disabled={disabled}
        onChange={(position) => set({ position })}
      />
      <Select<Preset>
        label={t("Formato")}
        value={options.preset}
        disabled={disabled}
        onChange={(preset) => set({ preset })}
        options={[
          { value: "n", label: "1" },
          { value: "pagina", label: t("Página 1") },
          { value: "pagina_de", label: t("Página 1 de N") },
          { value: "slash", label: "1 / N" },
          { value: "custom", label: t("Personalizado…") },
        ]}
      />
      {options.preset === "custom" && (
        <TextField
          label={t("Texto personalizado")}
          value={options.custom}
          disabled={disabled}
          placeholder={t("Informe · {n} de {total}")}
          hint={t("Usa {n} para el número y {total} para el total.")}
          spellCheck={false}
          onChange={(e) => set({ custom: e.target.value })}
        />
      )}
      <NumberField label={t("Empezar a numerar en")} min={0} max={99999} value={options.startAt} disabled={disabled} onChange={(startAt) => set({ startAt })} />
      <PagesField
        value={options.pages}
        files={files}
        disabled={disabled}
        label={t("Páginas que se numeran")}
        onChange={(pages) => set({ pages })}
      />
      <div className="flex gap-2">
        <Select<FontFamily>
          label={t("Fuente")}
          className="min-w-0 flex-1"
          value={options.font}
          disabled={disabled}
          onChange={(font) => set({ font })}
          options={[
            { value: "helvetica", label: "Helvetica" },
            { value: "times", label: "Times" },
            { value: "courier", label: "Courier" },
          ]}
        />
        <NumberField label={t("Tamaño")} className="w-24" suffix="pt" min={6} max={72} value={options.size} disabled={disabled} onChange={(size) => set({ size })} />
      </div>
      <ColorPicker label={t("Color")} value={options.color} onChange={(color) => color && set({ color })} />
      <NumberField label={t("Margen al borde")} suffix="pt" min={0} max={200} value={options.margin} disabled={disabled} onChange={(margin) => set({ margin })} />
    </OptionStack>
  );
}

function Overlay({ file, options }: { file: ToolFile; options: PageNumbersToolOptions }) {
  const page = file.pageSize;
  if (!page || file.pageCount === null) return null;
  let numbered: number[];
  try {
    numbered = parsePageSelection(options.pages, file.pageCount);
  } catch {
    return null;
  }
  const k = numbered.indexOf(0);
  if (k < 0) return null;
  const text = (templateOf(options).trim() === "" ? "{n}" : templateOf(options))
    .replace(/\{n\}/gi, String(options.startAt + k))
    .replace(/\{total\}/gi, String(numbered.length))
    .replace(/\s*[\r\n]+\s*/g, " ");
  const [vertical, horizontal] = options.position.split("-");
  const cq = (v: number) => `${(v / page.width) * 100}cqw`;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <span
        className="absolute whitespace-pre leading-none"
        style={{
          [vertical]: cq(options.margin),
          ...(horizontal === "left" ? { left: cq(options.margin) } : horizontal === "right" ? { right: cq(options.margin) } : { left: "50%", transform: "translateX(-50%)" }),
          fontFamily: CSS_FONT_STACKS[options.font],
          fontSize: cq(options.size),
          color: options.color,
        }}
      >
        {text}
      </span>
    </div>
  );
}

export const pageNumbersTool: ToolModule<PageNumbersToolOptions> = {
  actionLabel: "Numerar páginas",
  cardSize: "lg",
  defaultOptions: () => ({
    position: "bottom-center",
    preset: "pagina_de",
    custom: "{n}",
    startAt: 1,
    pages: "",
    font: "helvetica",
    size: 11,
    color: "#000000",
    margin: 28,
  }),
  Options: PageNumbersOptions,
  validate: (files, options) => pagesError(options.pages, files),
  cardExtras: (file, options) => ({ overlay: <Overlay file={file} options={options} /> }),
  async run(files, options, ctx) {
    const { results, warnings } = await processFiles(files, ctx, t("Numerando"), (file) =>
      addPageNumbers(file.bytes, {
        position: options.position,
        template: templateOf(options),
        startAt: options.startAt,
        pages: options.pages,
        font: options.font,
        size: options.size,
        color: options.color,
        margin: options.margin,
      }),
    );
    return {
      summary: t("Páginas numeradas en {files}", { files: pluralize(results.length, t("archivo"), t("archivos")) }),
      outputs: results.map(({ file, value }) => ({ name: `${baseOf(file.name)}${t("_numerado")}.pdf`, bytes: value, kind: "pdf" as const })),
      zipName: t("pdf_numerados.zip"),
      warnings,
    };
  },
};
