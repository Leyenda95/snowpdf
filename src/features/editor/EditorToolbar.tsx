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
  FileCog,
  LayoutPanelLeft,
  Minus,
  MousePointer2,
  PenLine,
  PencilLine,
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
import { useState } from "react";
import { useDocStore } from "@/model/docStore";
import type { SymbolName } from "@/model/types";
import { BottomSheet, Button, IconButton, Menu, ToolTile, cn, useIsMobile } from "@/ui";
import { useEditorStore, type EditorTool } from "./editorStore";
import { pickImageToPlace } from "./actions";
import { zoomViewerTo } from "./viewer/Viewer";
import { t, type Msg } from "@/i18n";

interface ToolButton {
  tool: EditorTool;
  icon: LucideIcon;
  label: Msg;
  /** Short label for phone tiles. */
  short?: Msg;
  shortcut?: string;
  symbol?: SymbolName;
}

const GROUPS: ToolButton[][] = [
  [
    { tool: "select", icon: MousePointer2, label: "Seleccionar y rellenar formularios", shortcut: "V" },
    { tool: "hand", icon: Hand, label: "Mano (desplazar)", shortcut: "H" },
  ],
  [
    { tool: "text", icon: Type, label: "Añadir texto", short: "Texto", shortcut: "T" },
    { tool: "editText", icon: TextCursorInput, label: "Editar texto existente", short: "Editar texto", shortcut: "E" },
    { tool: "image", icon: ImagePlus, label: "Añadir imagen", short: "Imagen", shortcut: "I" },
    { tool: "signature", icon: Signature, label: "Firmar", short: "Firmar", shortcut: "S" },
  ],
  [
    { tool: "rect", icon: Square, label: "Rectángulo", short: "Rectángulo", shortcut: "R" },
    { tool: "ellipse", icon: Circle, label: "Elipse", short: "Elipse", shortcut: "O" },
    { tool: "line", icon: Minus, label: "Línea", short: "Línea", shortcut: "L" },
    { tool: "arrow", icon: ArrowUpRight, label: "Flecha", short: "Flecha", shortcut: "A" },
    { tool: "ink", icon: PenLine, label: "Dibujar a mano", short: "Dibujar", shortcut: "D" },
  ],
  [
    { tool: "highlight", icon: Highlighter, label: "Resaltar", short: "Resaltar", shortcut: "M" },
    { tool: "whiteout", icon: Eraser, label: "Corrector (tapar)", short: "Corrector", shortcut: "W" },
    { tool: "erase", icon: WandSparkles, label: "Borrador mágico (borra y deja ver el fondo)", short: "Borrador mágico", shortcut: "B" },
    { tool: "redact", icon: EyeOff, label: "Redactar (eliminar de verdad)", short: "Redactar", shortcut: "X" },
  ],
  [
    { tool: "symbol", symbol: "check", icon: Check, label: "Marca ✓", short: "Marca ✓", shortcut: "K" },
    { tool: "symbol", symbol: "cross", icon: X, label: "Aspa ✗", short: "Aspa ✗" },
    { tool: "symbol", symbol: "dot", icon: CircleDot, label: "Punto", short: "Punto" },
    { tool: "symbol", symbol: "circle", icon: Circle, label: "Círculo", short: "Círculo" },
    { tool: "date", icon: CalendarDays, label: "Fecha de hoy", short: "Fecha" },
  ],
];

const SHEET_SECTIONS: { title: Msg; group: ToolButton[] }[] = [
  { title: "Añadir", group: GROUPS[1] },
  { title: "Formas y dibujo", group: GROUPS[2] },
  { title: "Marcar y corregir", group: GROUPS[3] },
  { title: "Símbolos", group: GROUPS[4] },
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

function isActive(b: ToolButton, tool: EditorTool, placing: unknown, symbol: string): boolean {
  const pl = placing as { signature: boolean } | null;
  return b.tool === "image" || b.tool === "signature"
    ? pl !== null && pl.signature === (b.tool === "signature")
    : tool === b.tool && !pl && (b.tool !== "symbol" || b.symbol === symbol);
}

function NavSlot({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
  pressed,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={pressed ?? active}
      onClick={onClick}
      className={cn(
        "flex min-h-14 [@media(max-height:480px)]:min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0 text-[11px] font-medium outline-none disabled:opacity-40",
        active ? "font-semibold text-fg" : "text-muted",
      )}
    >
      <span className={cn("flex h-8 w-16 items-center justify-center rounded-full transition-colors", active && "bg-fg text-surface")}>
        <Icon size={22} />
      </span>
      <span className="w-full truncate text-center leading-tight">{label}</span>
    </button>
  );
}

function PhoneToolbar({ hidden }: { hidden?: boolean }) {
  const tool = useEditorStore((s) => s.tool);
  const symbol = useEditorStore((s) => s.styles.symbol.symbol);
  const placing = useEditorStore((s) => s.placing);
  const toolsPanel = useEditorStore((s) => s.toolsPanel);
  const canUndo = useDocStore((s) => s.past.length > 0);
  const canRedo = useDocStore((s) => s.future.length > 0);
  const [sheet, setSheet] = useState(false);

  const current = SHEET_SECTIONS.flatMap((x) => x.group).find((b) => isActive(b, tool, placing, symbol));
  const idle = tool === "select" || tool === "hand";

  return (
    <>
      {/* Floats over the viewer (which pads its content), so sliding it away never reflows the pages. */}
      <nav
        inert={hidden}
        className={cn(
          "absolute inset-x-0 bottom-0 z-20 flex items-stretch bg-surface pb-[env(safe-area-inset-bottom)] border-t border-rule",
          "transition-transform duration-200 motion-reduce:transition-none",
          hidden && "translate-y-full",
        )}
      >
        <NavSlot
          icon={FileCog}
          label={t("Documento")}
          active={toolsPanel}
          onClick={() => useEditorStore.getState().setToolsPanel(!toolsPanel)}
        />
        <NavSlot icon={Undo2} label={t("Deshacer")} disabled={!canUndo} pressed={false} onClick={() => useDocStore.getState().undo()} />
        <NavSlot icon={Redo2} label={t("Rehacer")} disabled={!canRedo} pressed={false} onClick={() => useDocStore.getState().redo()} />
        <NavSlot icon={MousePointer2} label={t("Seleccionar")} active={tool === "select" && !placing} onClick={() => activateTool({ tool: "select" })} />
        <NavSlot icon={Hand} label={t("Mano")} active={tool === "hand" && !placing} onClick={() => activateTool({ tool: "hand" })} />
        <NavSlot
          icon={current ? current.icon : PencilLine}
          label={current ? t(current.short ?? current.label) : t("Añadir")}
          active={!!current || (!idle && !current)}
          onClick={() => {
            useEditorStore.getState().closePhoneOverlays();
            setSheet(true);
          }}
        />
      </nav>
      <BottomSheet open={sheet} onClose={() => setSheet(false)} title={t("Herramientas de edición")}>
        {SHEET_SECTIONS.map((sec) => (
          <section key={sec.title} className="px-2 pt-3">
            <h3 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-widest text-muted">{t(sec.title)}</h3>
            <div className="grid grid-cols-3 gap-2.5">
              {sec.group.map((b) => (
                <ToolTile
                  key={`${b.tool}-${b.symbol ?? ""}`}
                  icon={b.icon}
                  label={t(b.short ?? b.label)}
                  active={isActive(b, tool, placing, symbol)}
                  tone={b.tool === "redact" ? "danger" : "default"}
                  iconClass={b.tool === "redact" ? "text-rose-600 dark:text-rose-300" : undefined}
                  onClick={() => {
                    setSheet(false);
                    activateTool(b);
                  }}
                />
              ))}
            </div>
          </section>
        ))}
      </BottomSheet>
    </>
  );
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function EditorToolbar({ hidden }: { hidden?: boolean } = {}) {
  const tool = useEditorStore((s) => s.tool);
  const symbol = useEditorStore((s) => s.styles.symbol.symbol);
  const zoom = useEditorStore((s) => s.zoom);
  const placing = useEditorStore((s) => s.placing);
  const toolsPanel = useEditorStore((s) => s.toolsPanel);
  const canUndo = useDocStore((s) => s.past.length > 0);
  const canRedo = useDocStore((s) => s.future.length > 0);
  const mobile = useIsMobile();
  if (mobile) return <PhoneToolbar hidden={hidden} />;

  return (
    <div className="flex h-14 shrink-0 items-center gap-1 overflow-x-auto overscroll-x-contain border-t border-line bg-surface px-2 max-md:no-scrollbar md:h-12 md:border-b md:border-t-0 md:px-3">
      <div className="mr-1 flex items-center border-r border-line pr-1.5 max-md:order-first max-md:shrink-0">
        <Button
          variant="ghost"
          size="sm"
          icon={LayoutPanelLeft}
          aria-pressed={toolsPanel}
          title={toolsPanel ? t("Ocultar herramientas") : t("Mostrar herramientas")}
          aria-label={t("Herramientas")}
          onClick={() => useEditorStore.getState().setToolsPanel(!toolsPanel)}
          className={cn(
            "max-md:size-10 max-md:px-0",
            toolsPanel &&
              "bg-fg text-surface hover:bg-fg/90",
          )}
        >
          <span className="max-md:hidden">{t("Herramientas")}</span>
        </Button>
      </div>
      {GROUPS.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5 border-r border-line pr-1.5 mr-1 last:border-r-0 max-md:shrink-0">
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
                className={cn("max-md:size-10", b.tool === "redact" && active && "!bg-rose-100 !text-rose-700 dark:!bg-rose-500/20 dark:!text-rose-200")}
              />
            );
          })}
        </div>
      ))}

      <div className="flex items-center gap-0.5 border-r border-line pr-1.5 mr-1 max-md:order-[-1] max-md:shrink-0">
        <IconButton icon={Undo2} label={t("Deshacer")} shortcut="Ctrl+Z" disabled={!canUndo} className="max-md:size-10" onClick={() => useDocStore.getState().undo()} />
        <IconButton icon={Redo2} label={t("Rehacer")} shortcut="Ctrl+Y" disabled={!canRedo} className="max-md:size-10" onClick={() => useDocStore.getState().redo()} />
      </div>

      <div className="ml-auto flex items-center gap-0.5 max-md:hidden">
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
