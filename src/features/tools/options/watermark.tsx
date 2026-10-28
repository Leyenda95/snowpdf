import { useState } from "react";
import { Bold, ImagePlus, Italic, Type } from "lucide-react";
import type { FontFamily } from "@/model/types";
import { CSS_FONT_STACKS } from "@/pdf/fonts";
import { addWatermark } from "@/pdf/tools";
import { platform } from "@/platform";
import { normalizeImage } from "@/render/imageDecode";
import {
  Button,
  ColorPicker,
  IconButton,
  NumberField,
  SegmentedControl,
  Select,
  Slider,
  Switch,
  Tabs,
  TextArea,
  toast,
} from "@/ui";
import type { OptionsProps, ToolFile, ToolModule } from "../types";
import { baseOf, messageOf, pluralize, processFiles } from "../utils";
import { GroupLabel, OptionStack, PagesField, PositionGrid, pagesError } from "./common";
import { edgeCenter, measureTextWidth, rotatedExtent, tileCenters } from "./markGeometry";
import { t, type Msg } from "@/i18n";

type Tab = "text" | "image";
type Position =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

interface PickedImage {
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
  name: string;
  url: string;
  width: number;
  height: number;
}

interface WatermarkToolOptions {
  tab: Tab;
  text: string;
  font: FontFamily;
  bold: boolean;
  italic: boolean;
  size: number;
  color: string;
  image: PickedImage | null;
  /** Image width as a percentage of the page width. */
  imageWidth: number;
  position: Position;
  tile: boolean;
  /** Degrees counter-clockwise. */
  angle: number;
  /** Percentage 5..100. */
  opacity: number;
  layer: "over" | "under";
  pages: string;
}

const POSITION_ROWS: Position[][] = [
  ["top-left", "top-center", "top-right"],
  ["middle-left", "center", "middle-right"],
  ["bottom-left", "bottom-center", "bottom-right"],
];

const POSITION_LABELS: Record<Position, Msg> = {
  "top-left": "Arriba a la izquierda",
  "top-center": "Arriba al centro",
  "top-right": "Arriba a la derecha",
  "middle-left": "Centro a la izquierda",
  center: "Centro",
  "middle-right": "Centro a la derecha",
  "bottom-left": "Abajo a la izquierda",
  "bottom-center": "Abajo al centro",
  "bottom-right": "Abajo a la derecha",
};

const MARGIN = 36;

function WatermarkOptions({ files, options, onChange, disabled }: OptionsProps<WatermarkToolOptions>) {
  const set = (patch: Partial<WatermarkToolOptions>) => onChange({ ...options, ...patch });
  const [picking, setPicking] = useState(false);

  const pickImage = async () => {
    setPicking(true);
    try {
      const [picked] = await platform.openFiles({ kinds: ["image"], multiple: false, title: t("Elegir imagen para la marca de agua") });
      if (!picked) return;
      const image = await normalizeImage(picked.bytes);
      if (options.image) URL.revokeObjectURL(options.image.url);
      const url = URL.createObjectURL(new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type: image.mime }));
      set({ image: { bytes: image.bytes, mime: image.mime, name: picked.name, url, width: image.width, height: image.height } });
    } catch (err) {
      toast.error(t("No se pudo leer la imagen"), { description: messageOf(err) });
    } finally {
      setPicking(false);
    }
  };

  const angleKey = String(options.angle);

  return (
    <OptionStack>
      <Tabs<Tab>
        value={options.tab}
        onChange={(tab) => set({ tab })}
        tabs={[
          { value: "text", label: t("Texto"), icon: Type },
          { value: "image", label: t("Imagen"), icon: ImagePlus },
        ]}
        className="-mt-1"
      />

      {options.tab === "text" ? (
        <>
          <TextArea
            label={t("Texto de la marca")}
            rows={2}
            value={options.text}
            disabled={disabled}
            onChange={(e) => set({ text: e.target.value })}
            placeholder="CONFIDENCIAL"
          />
          <div className="flex items-end gap-2">
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
            <IconButton icon={Bold} label={t("Negrita")} variant="subtle" active={options.bold} disabled={disabled} className="size-9" onClick={() => set({ bold: !options.bold })} />
            <IconButton icon={Italic} label={t("Cursiva")} variant="subtle" active={options.italic} disabled={disabled} className="size-9" onClick={() => set({ italic: !options.italic })} />
          </div>
          <Slider
            label={t("Tamaño")}
            min={8}
            max={200}
            value={options.size}
            disabled={disabled}
            format={(v) => `${v} pt`}
            onChange={(size) => set({ size })}
          />
          <ColorPicker label={t("Color")} value={options.color} onChange={(color) => color && set({ color })} />
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <GroupLabel>{t("Imagen")}</GroupLabel>
            {options.image && (
              <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 p-2">
                <img src={options.image.url} alt="" className="size-12 rounded object-contain bg-white" />
                <span className="min-w-0 truncate text-[13px] text-fg" title={options.image.name}>
                  {options.image.name}
                </span>
              </div>
            )}
            <Button icon={ImagePlus} loading={picking} disabled={disabled} onClick={pickImage}>
              {options.image ? t("Cambiar imagen") : t("Elegir imagen…")}
            </Button>
          </div>
          <Slider
            label={t("Tamaño (ancho de la imagen)")}
            min={5}
            max={100}
            step={5}
            value={options.imageWidth}
            disabled={disabled}
            format={(v) => t("{n} % de la página", { n: v })}
            onChange={(imageWidth) => set({ imageWidth })}
          />
        </>
      )}

      <div className="flex items-start gap-4">
        <PositionGrid<Position>
          label={t("Posición")}
          rows={POSITION_ROWS}
          labels={POSITION_LABELS}
          value={options.position}
          disabled={disabled}
          muted={options.tile}
          onChange={(position) => set({ position, tile: false })}
        />
        <Switch label={t("Mosaico")} description={t("Repetir por toda la página")} checked={options.tile} disabled={disabled} onChange={(tile) => set({ tile })} className="min-w-0 flex-1 pt-6" />
      </div>

      <div className="flex flex-col gap-2">
        <SegmentedControl<string>
          label={t("Rotación")}
          fullWidth
          size="sm"
          value={angleKey}
          onChange={(v) => set({ angle: Number(v) })}
          options={[
            { value: "0", label: "0°" },
            { value: "45", label: "45°" },
            { value: "90", label: "90°" },
          ]}
          className={disabled ? "pointer-events-none opacity-50" : undefined}
        />
        <NumberField label={t("Ángulo personalizado")} suffix="°" min={-180} max={180} value={options.angle} disabled={disabled} onChange={(angle) => set({ angle })} />
      </div>

      <Slider
        label={t("Opacidad")}
        min={5}
        max={100}
        step={5}
        value={options.opacity}
        disabled={disabled}
        format={(v) => `${v} %`}
        onChange={(opacity) => set({ opacity })}
      />

      <SegmentedControl<"over" | "under">
        label={t("Capa")}
        fullWidth
        size="sm"
        value={options.layer}
        onChange={(layer) => set({ layer })}
        options={[
          { value: "over", label: t("Encima del contenido") },
          { value: "under", label: t("Debajo del contenido") },
        ]}
        className={disabled ? "pointer-events-none opacity-50" : undefined}
      />

      <PagesField value={options.pages} files={files} disabled={disabled} onChange={(pages) => set({ pages })} />
    </OptionStack>
  );
}

/** CSS approximation of the mark over the first-page thumbnail (units: cqw = % of page width). */
function WatermarkOverlay({ page, options }: { page: { width: number; height: number }; options: WatermarkToolOptions }) {
  const { width: pw, height: ph } = page;
  const lines = options.text.replace(/\r\n?/g, "\n").split("\n");
  const stack = CSS_FONT_STACKS[options.font];

  let markW: number;
  let markH: number;
  if (options.tab === "text") {
    if (options.text.trim() === "") return null;
    const font = `${options.italic ? "italic " : ""}${options.bold ? "bold " : ""}${options.size}px ${stack}`;
    markW = Math.max(...lines.map((l) => measureTextWidth(l, font)));
    markH = (lines.length - 1) * options.size * 1.2 + options.size * 0.72;
  } else {
    const img = options.image;
    if (!img) return null;
    markW = (pw * options.imageWidth) / 100;
    markH = (markW * img.height) / img.width;
    if (markH > ph) {
      markW *= ph / markH;
      markH = ph;
    }
  }

  const ext = rotatedExtent(markW, markH, options.angle);
  const centers = options.tile
    ? tileCenters(pw, ph, markW, markH, options.angle)
    : [edgeCenter(options.position, pw, ph, ext, MARGIN)];
  const cq = (v: number) => `${(v / pw) * 100}cqw`;

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ opacity: options.opacity / 100, mixBlendMode: options.layer === "under" ? "multiply" : undefined }}
    >
      {centers.map((c, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: cq(c.x),
            top: cq(ph - c.y),
            width: cq(markW),
            height: cq(markH),
            transform: `translate(-50%, -50%) rotate(${-options.angle}deg)`,
          }}
        >
          {options.tab === "text" ? (
            <div
              className="flex h-full w-full flex-col items-center justify-center whitespace-pre text-center"
              style={{
                color: options.color,
                fontFamily: stack,
                fontWeight: options.bold ? 700 : 400,
                fontStyle: options.italic ? "italic" : "normal",
                fontSize: cq(options.size),
                lineHeight: 1.2,
              }}
            >
              {lines.map((l, k) => (
                <span key={k}>{l || " "}</span>
              ))}
            </div>
          ) : (
            <img src={options.image!.url} alt="" className="h-full w-full object-fill" />
          )}
        </div>
      ))}
    </div>
  );
}

export const watermarkTool: ToolModule<WatermarkToolOptions> = {
  actionLabel: "Añadir marca de agua",
  cardSize: "lg",
  defaultOptions: () => ({
    tab: "text",
    text: "CONFIDENCIAL",
    font: "helvetica",
    bold: true,
    italic: false,
    size: 64,
    color: "#9ca3af",
    image: null,
    imageWidth: 50,
    position: "center",
    tile: false,
    angle: 45,
    opacity: 50,
    layer: "over",
    pages: "",
  }),
  Options: WatermarkOptions,
  validate(files, options) {
    if (options.tab === "text" && options.text.trim() === "") return t("Escribe el texto de la marca de agua.");
    if (options.tab === "image" && !options.image) return t("Elige la imagen de la marca de agua.");
    return pagesError(options.pages, files);
  },
  cardExtras: (file: ToolFile, options) =>
    file.pageSize ? { overlay: <WatermarkOverlay page={file.pageSize} options={options} /> } : {},
  async run(files, options, ctx) {
    const mark =
      options.tab === "text"
        ? { kind: "text" as const, text: options.text, font: options.font, bold: options.bold, italic: options.italic, size: options.size, color: options.color }
        : { kind: "image" as const, bytes: options.image!.bytes, mime: options.image!.mime, widthRatio: options.imageWidth / 100 };
    const { results, warnings } = await processFiles(files, ctx, t("Marcando"), (file) =>
      addWatermark(file.bytes, {
        mark,
        position: options.tile ? "tile" : options.position,
        opacity: options.opacity / 100,
        angle: options.angle,
        pages: options.pages,
        layer: options.layer,
        margin: MARGIN,
      }),
    );
    return {
      summary: t("Marca de agua añadida a {files}", { files: pluralize(results.length, t("archivo"), t("archivos")) }),
      outputs: results.map(({ file, value }) => ({ name: `${baseOf(file.name)}${t("_marca_agua")}.pdf`, bytes: value, kind: "pdf" as const })),
      zipName: t("pdf_con_marca_de_agua.zip"),
      warnings,
    };
  },
};
