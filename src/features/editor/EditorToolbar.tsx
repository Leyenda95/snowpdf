import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  Circle,
  CircleDot,
  Eraser,
  EyeOff,
  Hand,
  Highlighter,
  ImagePlus,
  LayoutPanelLeft,
  Minus,
  MousePointer2,
  PenLine,
  Redo2,
  Signature,
  Square,
  TextCursorInput,
  Type,
  Undo2,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { useDocStore } from "@/model/docStore";
import type { SymbolName } from "@/model/types";
import { Button, IconButton, Menu } from "@/ui";
import { useEditorStore, type EditorTool } from "./editorStore";
import { pickImageToPlace } from "./actions";
import { zoomViewerTo } from "./viewer/Viewer";
import { t, type Msg } from "@/i18n";

interface ToolButton {
  tool: EditorTool;
  icon: LucideIcon;
  label: Msg;
  shortcut?: string;
  symbol?: SymbolName;
}

const GROUPS: ToolButton[][] = [
  [
    { tool: "select", icon: MousePointer2, label: "Seleccionar y rellenar formularios", shortcut: "V" },
    { tool: "hand", icon: Hand, label: "Mano (desplazar)", shortcut: "H" },
  ],
  [
    { tool: "text", icon: Type, label: "Añadir texto", shortcut: "T" },
    { tool: "editText", icon: TextCursorInput, label: "Editar texto existente", shortcut: "E" },
    { tool: "image", icon: ImagePlus, label: "Añadir imagen", shortcut: "I" },
    { tool: "signature", icon: Signature, label: "Firmar", shortcut: "S" },
  ],
  [
    { tool: "rect", icon: Square, label: "Rectángulo", shortcut: "R" },
    { tool: "ellipse", icon: Circle, label: "Elipse", shortcut: "O" },
    { tool: "line", icon: Minus, label: "Línea", shortcut: "L" },
    { tool: "arrow", icon: ArrowUpRight, label: "Flecha", shortcut: "A" },
    { tool: "ink", icon: PenLine, label: "Dibujar a mano", shortcut: "D" },
  ],
  [
    { tool: "highlight", icon: Highlighter, label: "Resaltar", shortcut: "M" },
    { tool: "whiteout", icon: Eraser, label: "Corrector (tapar)", shortcut: "W" },
    { tool: "erase", icon: WandSparkles, label: "Borrador mágico (borra y deja ver el fondo)", shortcut: "B" },
    { tool: "redact", icon: EyeOff, label: "Redactar (eliminar de verdad)", shortcut: "X" },
  ],
  [
    { tool: "symbol", symbol: "check", icon: Check, label: "Marca ✓", shortcut: "K" },
    { tool: "symbol", symbol: "cross", icon: X, label: "Aspa ✗" },
    { tool: "symbol", symbol: "dot", icon: CircleDot, label: "Punto" },
    { tool: "symbol", symbol: "circle", icon: Circle, label: "Círculo" },
    { tool: "date", icon: CalendarDays, label: "Fecha de hoy" },
  ],
];

export const TOOL_SHORTCUTS: Record<string, ToolButton> = Object.fromEntries(
  GROUPS.flat()
    .filter((b) => b.shortcut)
    .map((b) => [b.shortcut!.toLowerCase(), b]),
);

/** Activate a tool button (some open a picker/dialog first). */
export function activateTool(b: Pick<ToolButton, "tool" | "symbol">): void {
  const ed = useEditorStore.getState();
  ed.setPlacing(null);
  if (b.tool === "image") {
    void pickImageToPlace();
    return;
  }
  if (b.tool === "signature") {
    ed.setTool("select");
    ed.setSignatureDialog(true);
    return;
  }
  if (b.symbol) ed.setStyle("symbol", { symbol: b.symbol });
  ed.setTool(b.tool);
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function EditorToolbar() {
  const tool = useEditorStore((s) => s.tool);
  const symbol = useEditorStore((s) => s.styles.symbol.symbol);
  const zoom = useEditorStore((s) => s.zoom);
  const placing = useEditorStore((s) => s.placing);
  const toolsPanel = useEditorStore((s) => s.toolsPanel);
  const canUndo = useDocStore((s) => s.past.length > 0);
  const canRedo = useDocStore((s) => s.future.length > 0);

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-3">
      <div className="mr-1 flex items-center border-r border-line pr-1.5">
        <Button
          variant="ghost"
          size="sm"
          icon={LayoutPanelLeft}
          aria-pressed={toolsPanel}
          title={toolsPanel ? t("Ocultar herramientas") : t("Mostrar herramientas")}
          onClick={() => useEditorStore.getState().setToolsPanel(!toolsPanel)}
          className={
            toolsPanel
              ? "bg-brand-100 text-brand-700 hover:bg-brand-200 dark:bg-brand-500/20 dark:text-brand-200 dark:hover:bg-brand-500/30"
              : undefined
          }
        >
          {t("Herramientas")}
        </Button>
      </div>
      {GROUPS.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5 border-r border-line pr-1.5 mr-1 last:border-r-0">
          {group.map((b) => {
            const active =
              (b.tool === "image" || b.tool === "signature"
                ? placing !== null && placing.signature === (b.tool === "signature")
                : tool === b.tool && !placing && (b.tool !== "symbol" || b.symbol === symbol));
            return (
              <IconButton
                key={`${b.tool}-${b.symbol ?? ""}`}
                icon={b.icon}
                label={t(b.label)}
                shortcut={b.shortcut}
                active={active}
                onClick={() => activateTool(b)}
                className={b.tool === "redact" && active ? "!bg-rose-100 !text-rose-700 dark:!bg-rose-500/20 dark:!text-rose-200" : undefined}
              />
            );
          })}
        </div>
      ))}

      <div className="flex items-center gap-0.5 border-r border-line pr-1.5 mr-1">
        <IconButton icon={Undo2} label={t("Deshacer")} shortcut="Ctrl+Z" disabled={!canUndo} onClick={() => useDocStore.getState().undo()} />
        <IconButton icon={Redo2} label={t("Rehacer")} shortcut="Ctrl+Y" disabled={!canRedo} onClick={() => useDocStore.getState().redo()} />
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <IconButton icon={ZoomOut} label={t("Alejar")} shortcut="Ctrl+-" onClick={() => zoomViewerTo(zoom / 1.2)} />
        <Menu
          align="end"
          trigger={
            <Button variant="ghost" size="sm" iconRight={ChevronDown} className="w-[84px] justify-between tabular-nums">
              {Math.round(zoom * 100)} %
            </Button>
          }
          items={[
            { id: "fit-width", label: t("Ajustar al ancho"), onSelect: () => useEditorStore.getState().setZoom(zoom, "width") },
            { id: "fit-page", label: t("Página completa"), onSelect: () => useEditorStore.getState().setZoom(zoom, "page") },
            { type: "separator" },
            ...ZOOMS.map((z) => ({ id: `z${z}`, label: `${Math.round(z * 100)} %`, checked: Math.abs(zoom - z) < 0.005, onSelect: () => zoomViewerTo(z) })),
          ]}
        />
        <IconButton icon={ZoomIn} label={t("Acercar")} shortcut="Ctrl++" onClick={() => zoomViewerTo(zoom * 1.2)} />
      </div>
    </div>
  );
}
