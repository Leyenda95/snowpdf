import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Copy,
  Italic,
  RotateCcw,
  RotateCw,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash,
} from "lucide-react";
import { useDocStore } from "@/model/docStore";
import { deleteObjects, deletePages, duplicateObjects, reorderObjects, rotatePages, updateObject } from "@/model/docActions";
import { getFont } from "@/model/registry";
import { displayRotation, pageBox, type EditorObject, type FontFamily, type SymbolName, type TextObject } from "@/model/types";
import { SYMBOL_LABELS } from "@/pdf/symbols";
import { WEIGHT_LABELS, closestFace, listSystemFamilies, loadSystemFace, type SystemFamily } from "@/render/systemFonts";
import { Button, ColorPicker, IconButton, NumberField, SegmentedControl, Select, Slider, Switch, toast } from "@/ui";
import { rememberTextFont, useEditorStore, type EditorTool } from "./editorStore";
import { objectLabel } from "./overlay/ObjectView";
import { refitText } from "./objects";
import { missingGlyphs } from "@/pdf/textLayout";
import { useExportPrefs } from "./exportPrefs";
import { ThumbnailList } from "./Sidebar";
import { t, type Msg } from "@/i18n";

const FONT_OPTIONS: { value: FontFamily; label: Msg }[] = [
  { value: "helvetica", label: "Sans (Helvetica)" },
  { value: "times", label: "Serif (Times)" },
  { value: "courier", label: "Monoespaciada (Courier)" },
];

const FONT_NAMES: Record<FontFamily, string> = { helvetica: "Helvetica", times: "Times", courier: "Courier" };

/** Select value standing for the document's own font. */
const SOURCE_FONT = "source";

const HIGHLIGHT_PRESETS = ["#facc15", "#4ade80", "#22d3ee", "#f472b6", "#fb923c", "#a78bfa"];
const pct = (v: number) => `${Math.round(v * 100)} %`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line px-4 py-4 last:border-b-0">
      <h3 className="text-[11px] font-semibold tracking-wide text-subtle uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** Apply a property change to an object (and remember it as the tool default). */
function patchObject(obj: EditorObject, patch: Partial<EditorObject>, field: string): void {
  if (obj.kind === "text") {
    const next = refitText(obj, patch as Partial<TextObject>);
    updateObject(obj.id, { ...patch, frame: next.frame } as Partial<TextObject>, `prop:${obj.id}:${field}`);
  } else {
    updateObject(obj.id, patch, `prop:${obj.id}:${field}`);
  }
}

// ------------------------------------------------------------------ style editors (object or tool defaults)

const SYSTEM_PREFIX = "sys:";

/** Installed font families (desktop); empty until listed or in the browser. */
function useSystemFamilies(): SystemFamily[] {
  const [families, setFamilies] = useState<SystemFamily[]>([]);
  useEffect(() => {
    let alive = true;
    void listSystemFamilies().then((f) => alive && setFamilies(f));
    return () => {
      alive = false;
    };
  }, []);
  return families;
}

const weightLabel = (w: number) => (WEIGHT_LABELS[w] ? t(WEIGHT_LABELS[w]) : String(w));

/**
 * Font, weight, slant, size, alignment and colour of a text object. Weights other than normal
 * and bold come from fonts installed on this computer (the PDF standard fonts only have two);
 * a document font offers the weights of the same family when it is installed.
 */
function TextStyleEditor({ obj, onChange }: { obj: TextObject; onChange: (p: Partial<TextObject>, field: string) => void }) {
  const families = useSystemFamilies();
  const current = obj.useSourceFont && obj.sourceFont ? getFont(obj.sourceFont) : null;
  const docFont = obj.documentFont ? getFont(obj.documentFont) : null;
  const findFamily = (name: string) => families.find((f) => f.family.toLowerCase().replace(/\s+/g, "") === name.toLowerCase().replace(/\s+/g, ""));
  // Installed family the current font belongs to (for its weights), if any.
  const family = current ? findFamily(current.family) : undefined;
  const weight = current ? current.weight : obj.bold ? 700 : 400;
  const italic = current ? current.italic : obj.italic;

  const useFace = async (fam: SystemFamily, w: number, it: boolean) => {
    try {
      const asset = await loadSystemFace(fam.family, closestFace(fam, w, it));
      onChange({ sourceFont: asset.id, useSourceFont: true, bold: asset.bold, italic: asset.italic }, "font");
    } catch (err) {
      toast.error(t("No se pudo cargar la fuente"), { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const familyValue = current ? (current.origin === "document" ? SOURCE_FONT : SYSTEM_PREFIX + (family?.family ?? current.family)) : obj.font;
  const familyOptions: { value: string; label: string; disabled?: boolean }[] = [
    ...(docFont ? [{ value: SOURCE_FONT, label: t("{font} (del documento)", { font: docFont.family }) }] : []),
    ...FONT_OPTIONS.map((o) => ({ ...o, label: t(o.label) })),
    ...(families.length ? [{ value: "-", label: t("── Instaladas en el equipo ──"), disabled: true }] : []),
    ...families.map((f) => ({ value: SYSTEM_PREFIX + f.family, label: f.family })),
  ];
  const onFamily = (v: string) => {
    if (v === SOURCE_FONT && docFont) onChange({ sourceFont: docFont.id, useSourceFont: true, bold: docFont.bold, italic: docFont.italic }, "font");
    else if (v.startsWith(SYSTEM_PREFIX)) {
      const fam = families.find((f) => SYSTEM_PREFIX + f.family === v);
      if (fam) void useFace(fam, weight, italic);
    } else onChange({ font: v as FontFamily, useSourceFont: false }, "font");
  };

  // Weights on offer: the installed family's, the document font's own, or normal/bold.
  const weights = [...new Set([...(family ? family.faces.map((f) => f.weight) : current ? [] : [400, 700]), ...(current ? [current.weight] : [])])].sort((a, b) => a - b);
  const onWeight = (v: string) => {
    const w = Number(v);
    if (family) void useFace(family, w, italic);
    else onChange({ bold: w >= 600, useSourceFont: false }, "weight");
  };
  const canItalic = family ? family.faces.some((f) => f.italic !== italic) : true;
  const onItalic = () => {
    if (family) void useFace(family, weight, !italic);
    // A document font without an installed family has one slant: switch to the standard font.
    else onChange({ italic: !italic, useSourceFont: false }, "italic");
  };

  return (
    <>
      <Select<string> label={t("Fuente")} value={familyValue} options={familyOptions} onChange={onFamily} />
      <div className="flex items-end gap-2">
        <Select<string>
          label={t("Grosor")}
          className="flex-1"
          value={String(weight)}
          options={weights.map((w) => ({ value: String(w), label: weightLabel(w) }))}
          onChange={onWeight}
        />
        <IconButton icon={Italic} label={t("Cursiva")} active={italic} disabled={!canItalic} onClick={onItalic} />
      </div>
      <NumberField label={t("Tamaño")} value={obj.size} min={4} max={400} step={1} suffix="pt" onChange={(size) => onChange({ size }, "size")} className="w-24" />
      <SegmentedControl
        label={t("Alineación")}
        value={obj.align}
        onChange={(align) => onChange({ align }, "align")}
        options={[
          { value: "left", icon: TextAlignStart, title: t("Izquierda") },
          { value: "center", icon: TextAlignCenter, title: t("Centro") },
          { value: "right", icon: TextAlignEnd, title: t("Derecha") },
        ]}
      />
      <ColorPicker label={t("Color")} value={obj.color} onChange={(color) => color && onChange({ color }, "color")} />
    </>
  );
}

/** Letters the document font does not include are drawn with the fallback: say so. */
function MissingGlyphs({ obj }: { obj: TextObject }) {
  const missing = missingGlyphs(obj);
  if (!missing.length) return null;
  const font = obj.sourceFont ? getFont(obj.sourceFont) : null;
  const list = missing.slice(0, 8).map((ch) => `«${ch}»`).join(", ") + (missing.length > 8 ? "…" : "");
  return (
    <p className="text-xs text-muted">
      {t(missing.length === 1 ? "{font} no incluye: {list}. Esa letra usa {fallback}." : "{font} no incluye: {list}. Esas letras usan {fallback}.", {
        font: font?.origin === "system" ? font.family : t("La fuente original"),
        list,
        fallback: FONT_NAMES[obj.font],
      })}
    </p>
  );
}

function ObjectProps({ obj }: { obj: EditorObject }) {
  const setStyle = useEditorStore((s) => s.setStyle);
  const page = useDocStore((s) => s.doc.pages.find((p) => p.id === obj.pageId));
  const R = page ? displayRotation(page) : 0;
  const shownAngle = Math.round((((obj.frame.rot - R) % 360) + 540) % 360 - 180);

  let body: ReactNode = null;
  switch (obj.kind) {
    case "text":
      body = (
        <>
          <TextStyleEditor
            obj={obj}
            onChange={(p, f) => {
              patchObject(obj, p, f);
              // New texts inherit size, font (of any kind) and colour, never bold, italic or alignment.
              if (p.size !== undefined) setStyle("text", { size: p.size });
              if (p.color !== undefined) setStyle("text", { color: p.color });
              if (p.font !== undefined) void rememberTextFont({ standard: p.font });
              const chosen = p.sourceFont ? getFont(p.sourceFont) : null;
              if (chosen) void rememberTextFont(chosen.origin === "system" ? { system: chosen.family } : { document: chosen });
            }}
          />
          <MissingGlyphs obj={obj} />
          {obj.replaces ? (
            <ColorPicker label={t("Color del fondo tapado")} value={obj.background} onChange={(background) => patchObject(obj, { background: background ?? "#ffffff" }, "bg")} />
          ) : (
            <ColorPicker label={t("Fondo")} allowNone value={obj.background} onChange={(background) => patchObject(obj, { background }, "bg")} />
          )}
        </>
      );
      break;
    case "rect":
    case "ellipse":
      body = (
        <>
          <ColorPicker label={t("Borde")} allowNone value={obj.stroke} onChange={(stroke) => (patchObject(obj, { stroke }, "stroke"), setStyle("shape", { stroke }))} />
          <ColorPicker label={t("Relleno")} allowNone value={obj.fill} onChange={(fill) => (patchObject(obj, { fill }, "fill"), setStyle("shape", { fill }))} />
          <Slider label={t("Grosor")} min={0.5} max={16} step={0.5} value={obj.strokeWidth} format={(v) => `${v} pt`} onChange={(strokeWidth) => (patchObject(obj, { strokeWidth }, "sw"), setStyle("shape", { strokeWidth }))} />
        </>
      );
      break;
    case "line":
    case "arrow":
      body = (
        <>
          <ColorPicker label={t("Color")} value={obj.stroke} onChange={(stroke) => stroke && (patchObject(obj, { stroke }, "stroke"), setStyle("line", { stroke }))} />
          <Slider label={t("Grosor")} min={0.5} max={16} step={0.5} value={obj.strokeWidth} format={(v) => `${v} pt`} onChange={(strokeWidth) => (patchObject(obj, { strokeWidth }, "sw"), setStyle("line", { strokeWidth }))} />
          <Switch label={t("Discontinua")} checked={obj.dashed} onChange={(dashed) => (patchObject(obj, { dashed }, "dash"), setStyle("line", { dashed }))} />
        </>
      );
      break;
    case "ink":
      body = (
        <>
          <ColorPicker label={t("Color")} value={obj.color} onChange={(color) => color && (patchObject(obj, { color }, "color"), setStyle("ink", { color }))} />
          <Slider label={t("Grosor")} min={0.5} max={16} step={0.5} value={obj.strokeWidth} format={(v) => `${v} pt`} onChange={(strokeWidth) => (patchObject(obj, { strokeWidth }, "sw"), setStyle("ink", { strokeWidth }))} />
        </>
      );
      break;
    case "highlight":
      body = <ColorPicker label={t("Color")} presets={HIGHLIGHT_PRESETS} value={obj.color} onChange={(color) => color && (patchObject(obj, { color }, "color"), setStyle("highlight", { color }))} />;
      break;
    case "whiteout":
      body = (
        <>
          <ColorPicker label={t("Color")} value={obj.color} onChange={(color) => color && patchObject(obj, { color }, "color")} />
          <p className="text-xs text-muted">{t("Tapa visualmente el contenido. Para eliminarlo de verdad usa «Redactar».")}</p>
        </>
      );
      break;
    case "redact":
      body = (
        <>
          <ColorPicker label={t("Color final")} value={obj.color} onChange={(color) => color && (patchObject(obj, { color }, "color"), setStyle("redact", { color }))} />
          <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
            {t("Al guardar, el texto, las imágenes y los trazos bajo esta zona se eliminarán definitivamente.")}
          </p>
        </>
      );
      break;
    case "erase":
      body = (
        <p className="text-xs text-muted">
          {obj.method === null
            ? t("Analizando la zona…")
            : obj.method === "pixels"
              ? t("El texto era parte de una imagen: el fondo se ha reconstruido.")
              : obj.method === "none"
                ? t("No hay nada que borrar en esta zona.")
                : t("Se ha quitado el texto; se ve el fondo original.")}
        </p>
      );
      break;
    case "symbol":
      body = (
        <>
          <Select<SymbolName>
            label={t("Símbolo")}
            value={obj.symbol}
            options={(Object.keys(SYMBOL_LABELS) as SymbolName[]).map((s) => ({ value: s, label: t(SYMBOL_LABELS[s]) }))}
            onChange={(symbol) => patchObject(obj, { symbol }, "symbol")}
          />
          <ColorPicker label={t("Color")} value={obj.color} onChange={(color) => color && (patchObject(obj, { color }, "color"), setStyle("symbol", { color }))} />
        </>
      );
      break;
    case "image":
      body = null;
      break;
  }

  return (
    <>
      <Section title={objectLabel(obj)}>
        {body}
        {obj.kind !== "redact" && obj.kind !== "whiteout" && obj.kind !== "erase" && (
          <Slider label={t("Opacidad")} min={0.05} max={1} step={0.05} value={obj.opacity} format={pct} onChange={(opacity) => patchObject(obj, { opacity }, "opacity")} />
        )}
      </Section>
      <Section title={t("Posición")}>
        {obj.kind !== "erase" && (
          <div className="flex items-end gap-2">
            <NumberField
              label={t("Giro")}
              value={shownAngle}
              min={-180}
              max={180}
              step={1}
              suffix="°"
              className="w-24"
              onChange={(deg) => patchObject(obj, { frame: { ...obj.frame, rot: R + deg } }, "rot")}
            />
            <IconButton icon={RotateCcw} label={t("Girar 90° a la izquierda")} onClick={() => patchObject(obj, { frame: { ...obj.frame, rot: obj.frame.rot + 90 } }, "rot90")} />
            <IconButton icon={RotateCw} label={t("Girar 90° a la derecha")} onClick={() => patchObject(obj, { frame: { ...obj.frame, rot: obj.frame.rot - 90 } }, "rot90")} />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <IconButton icon={ArrowUpToLine} label={t("Traer al frente")} onClick={() => reorderObjects([obj.id], "front")} />
          <IconButton icon={ArrowUp} label={t("Traer adelante")} shortcut="Ctrl+]" onClick={() => reorderObjects([obj.id], "forward")} />
          <IconButton icon={ArrowDown} label={t("Enviar atrás")} shortcut="Ctrl+[" onClick={() => reorderObjects([obj.id], "backward")} />
          <IconButton icon={ArrowDownToLine} label={t("Enviar al fondo")} onClick={() => reorderObjects([obj.id], "back")} />
          <IconButton icon={Copy} label={t("Duplicar")} shortcut="Ctrl+D" onClick={() => useEditorStore.getState().select(duplicateObjects([obj.id]))} />
          <IconButton icon={Trash} label={t("Eliminar")} shortcut="Supr" onClick={() => deleteObjects([obj.id])} />
        </div>
      </Section>
    </>
  );
}

function ToolDefaults({ tool }: { tool: EditorTool }) {
  const styles = useEditorStore((s) => s.styles);
  const setStyle = useEditorStore((s) => s.setStyle);
  switch (tool) {
    case "text":
    case "date":
      return (
        <Section title={tool === "date" ? t("Fecha") : t("Texto nuevo")}>
          {tool === "date" && (
            <Select
              label={t("Formato")}
              value={styles.date.format}
              options={[
                { value: "dd/mm/yyyy", label: "26/10/2026" },
                { value: "d de mmmm de yyyy", label: t("26 de octubre de 2026") },
                { value: "yyyy-mm-dd", label: "2026-10-26" },
              ]}
              onChange={(format) => setStyle("date", { format })}
            />
          )}
          <Select<string>
            label={t("Fuente")}
            value={styles.text.systemFamily ?? styles.text.font}
            options={[
              ...FONT_OPTIONS,
              ...(styles.text.systemFamily ? [{ value: styles.text.systemFamily, label: styles.text.systemFamily }] : []),
            ]}
            onChange={(v) => (FONT_OPTIONS.some((o) => o.value === v) ? void rememberTextFont({ standard: v as FontFamily }) : undefined)}
          />
          <NumberField label={t("Tamaño")} value={styles.text.size} min={4} max={400} step={1} suffix="pt" onChange={(size) => setStyle("text", { size })} className="w-24" />
          <ColorPicker label={t("Color")} value={styles.text.color} onChange={(color) => color && setStyle("text", { color })} />
          <p className="text-xs text-muted">{t("Los textos nuevos siguen la fuente (estándar, instalada o del documento), el tamaño y el color del último texto que cambiaste. La negrita y la cursiva no se heredan.")}</p>
        </Section>
      );
    case "rect":
    case "ellipse":
      return (
        <Section title={t("Forma nueva")}>
          <ColorPicker label={t("Borde")} allowNone value={styles.shape.stroke} onChange={(stroke) => setStyle("shape", { stroke })} />
          <ColorPicker label={t("Relleno")} allowNone value={styles.shape.fill} onChange={(fill) => setStyle("shape", { fill })} />
          <Slider label={t("Grosor")} min={0.5} max={16} step={0.5} value={styles.shape.strokeWidth} format={(v) => `${v} pt`} onChange={(strokeWidth) => setStyle("shape", { strokeWidth })} />
        </Section>
      );
    case "line":
    case "arrow":
      return (
        <Section title={tool === "arrow" ? t("Flecha nueva") : t("Línea nueva")}>
          <ColorPicker label={t("Color")} value={styles.line.stroke} onChange={(stroke) => stroke && setStyle("line", { stroke })} />
          <Slider label={t("Grosor")} min={0.5} max={16} step={0.5} value={styles.line.strokeWidth} format={(v) => `${v} pt`} onChange={(strokeWidth) => setStyle("line", { strokeWidth })} />
          <Switch label={t("Discontinua")} checked={styles.line.dashed} onChange={(dashed) => setStyle("line", { dashed })} />
        </Section>
      );
    case "ink":
      return (
        <Section title={t("Dibujo a mano")}>
          <ColorPicker label={t("Color")} value={styles.ink.color} onChange={(color) => color && setStyle("ink", { color })} />
          <Slider label={t("Grosor")} min={0.5} max={16} step={0.5} value={styles.ink.strokeWidth} format={(v) => `${v} pt`} onChange={(strokeWidth) => setStyle("ink", { strokeWidth })} />
          <Slider label={t("Opacidad")} min={0.05} max={1} step={0.05} value={styles.ink.opacity} format={pct} onChange={(opacity) => setStyle("ink", { opacity })} />
        </Section>
      );
    case "highlight":
      return (
        <Section title={t("Resaltador")}>
          <ColorPicker label={t("Color")} presets={HIGHLIGHT_PRESETS} value={styles.highlight.color} onChange={(color) => color && setStyle("highlight", { color })} />
          <p className="text-xs text-muted">{t("Selecciona texto para resaltarlo, o arrastra para resaltar una zona.")}</p>
        </Section>
      );
    case "redact":
      return (
        <Section title={t("Redactar")}>
          <ColorPicker label={t("Color final")} value={styles.redact.color} onChange={(color) => color && setStyle("redact", { color })} />
          <p className="text-xs text-muted">
            {t("Arrastra sobre lo que quieras eliminar. También puedes buscar datos sensibles (DNI, IBAN, teléfonos…) en el panel «Buscar» de la izquierda.")}
          </p>
        </Section>
      );
    case "whiteout":
      return (
        <Section title={t("Corrector")}>
          <ColorPicker label={t("Color")} value={styles.whiteout.color} onChange={(color) => color && setStyle("whiteout", { color })} />
          <p className="text-xs text-muted">{t("Tapa contenido con un recuadro. No lo elimina del archivo.")}</p>
        </Section>
      );
    case "erase":
      return (
        <Section title={t("Borrador mágico")}>
          <p className="text-xs text-muted">
            {t("Borra texto y deja ver el fondo original, aunque no sea blanco. Arrastra sobre lo que quieras borrar o haz clic en una línea de texto.")}
          </p>
          <p className="text-xs text-muted">{t("Si el texto es parte de una imagen (un escaneo, por ejemplo), el fondo se reconstruye.")}</p>
        </Section>
      );
    case "symbol":
      return (
        <Section title={t(SYMBOL_LABELS[styles.symbol.symbol])}>
          <ColorPicker label={t("Color")} value={styles.symbol.color} onChange={(color) => color && setStyle("symbol", { color })} />
          <NumberField label={t("Tamaño")} value={styles.symbol.size} min={6} max={96} suffix="pt" onChange={(size) => setStyle("symbol", { size })} className="w-28" />
        </Section>
      );
    case "editText":
      return (
        <Section title={t("Editar texto existente")}>
          <p className="text-xs text-muted">
            {t("Pasa el ratón por el texto del documento y haz clic en una línea para cambiarla. Se usa la fuente del documento siempre que se puede. Al guardar, el texto original se elimina y se escribe el nuevo.")}
          </p>
        </Section>
      );
    default:
      return null;
  }
}

function PageProps() {
  const index = useEditorStore((s) => s.currentPage);
  const page = useDocStore((s) => s.doc.pages[index]);
  const count = useDocStore((s) => s.doc.pages.length);
  const hasForm = useDocStore((s) => Object.values(s.sources).some((x) => x.hasForm));
  const flatten = useExportPrefs((p) => p.flattenForms);
  const setFlatten = (v: boolean) => useExportPrefs.getState().set({ flattenForms: v });
  if (!page) return null;
  const [x0, y0, x1, y1] = pageBox(page);
  const swap = displayRotation(page) % 180 !== 0;
  const mm = (pt: number) => Math.round((pt * 25.4) / 72);
  const w = swap ? y1 - y0 : x1 - x0;
  const h = swap ? x1 - x0 : y1 - y0;
  return (
    <>
      <Section title={t("Página {n} de {total}", { n: index + 1, total: count })}>
        <p className="text-xs text-muted">
          {mm(w)} × {mm(h)} mm
        </p>
        <div className="flex gap-2">
          <IconButton icon={RotateCcw} label={t("Girar página a la izquierda")} onClick={() => rotatePages([page.id], 270)} />
          <IconButton icon={RotateCw} label={t("Girar página a la derecha")} onClick={() => rotatePages([page.id], 90)} />
          <IconButton icon={Trash} label={t("Eliminar página")} disabled={count <= 1} onClick={() => deletePages([page.id])} />
        </div>
      </Section>
      {hasForm && (
        <Section title={t("Formulario")}>
          <p className="text-xs text-muted">{t("Este documento tiene campos rellenables: haz clic en ellos con la herramienta Seleccionar.")}</p>
          <Switch label={t("Aplanar al guardar")} description={t("Los campos quedan fijos y no se podrán editar.")} checked={flatten} onChange={setFlatten} />
        </Section>
      )}
    </>
  );
}

export function PropertiesPanel() {
  const show = useEditorStore((s) => s.showProps);
  const tool = useEditorStore((s) => s.tool);
  const selection = useEditorStore((s) => s.selection);
  const objects = useDocStore((s) => s.doc.objects);
  const thumbnails = useEditorStore((s) => s.thumbnails);
  if (!show) return null;
  const selected = objects.filter((o) => selection.includes(o.id));
  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-line bg-surface">
      {/* Properties scroll on their own; the page list below keeps at least ~40 % of the height. */}
      <div className={`min-h-0 overflow-y-auto ${thumbnails ? "max-h-[60%] shrink-0" : "flex-1"}`}>
        {selected.length === 1 ? (
          <ObjectProps obj={selected[0]} />
        ) : selected.length > 1 ? (
          <Section title={t("{n} objetos seleccionados", { n: selected.length })}>
            <div className="flex gap-2">
              <Button size="sm" icon={Copy} onClick={() => useEditorStore.getState().select(duplicateObjects(selection))}>
                {t("Duplicar")}
              </Button>
              <Button size="sm" variant="danger" icon={Trash} onClick={() => deleteObjects(selection)}>
                {t("Eliminar")}
              </Button>
            </div>
          </Section>
        ) : (
          <>
            <ToolDefaults tool={tool} />
            <PageProps />
          </>
        )}
      </div>
      {thumbnails && (
        <div className="flex min-h-48 flex-1 flex-col border-t border-line">
          <h3 className="px-4 pt-3 text-[11px] font-semibold tracking-wide text-subtle uppercase">{t("Páginas")}</h3>
          <ThumbnailList />
        </div>
      )}
    </aside>
  );
}
