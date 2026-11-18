import { useEffect, useMemo, useRef, useState, type MouseEvent, type SyntheticEvent } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowLeft, CopyPlus, EllipsisVertical, FileOutput, FilePlus, FileText, RotateCcw, RotateCw, Save, Settings, Trash } from "lucide-react";
import { openSettings } from "@/features/settings/SettingsPage";
import { useAppStore } from "@/model/appStore";
import { useDocStore } from "@/model/docStore";
import { blankPage, deletePages, duplicatePages, insertPages, movePages, rotatePages } from "@/model/docActions";
import type { PageRef } from "@/model/types";
import { platform } from "@/platform";
import { addFilesToWorkspace } from "@/model/workspace";
import { AppHeader } from "@/features/shell/AppHeader";
import { PageThumb } from "@/features/editor/Sidebar";
import { handleDroppedFiles } from "@/features/editor/askDropAction";
import { useEditorStore } from "@/features/editor/editorStore";
import { extractPages, quickSaveOptions, saveWorkspace } from "@/features/editor/save";
import { Button, IconButton, Menu, Slider, confirmDialog, isMobileLayout, useIsMobile, useWindowFileDrop } from "@/ui";
import { t } from "@/i18n";

/** Keeps presses on a card's buttons from starting a drag of the card. */
const NO_DRAG = {
  onPointerDown: (e: SyntheticEvent) => e.stopPropagation(),
  onMouseDown: (e: SyntheticEvent) => e.stopPropagation(),
  onTouchStart: (e: SyntheticEvent) => e.stopPropagation(),
};

function PageCard({
  page,
  index,
  width,
  selected,
  onClick,
  onOpen,
}: {
  page: PageRef;
  index: number;
  width: number;
  selected: boolean;
  onClick: (e: MouseEvent) => void;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, width: width + 24, touchAction: "manipulation" }}
      className={`group relative flex flex-col items-center gap-2 rounded-xl p-3 outline-none transition-colors ${
        selected ? "bg-surface-2 ring-2 ring-brand-500" : "hover:bg-surface-3"
      } ${isDragging ? "opacity-30" : ""}`}
      onClick={onClick}
      onDoubleClick={onOpen}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-center justify-center" style={{ width, height: width * 1.42 }}>
        <PageThumb page={page} width={page.rotation % 180 === 0 ? width * 0.86 : width} className="rounded-sm shadow-md" />
      </div>
      <span className="text-xs font-medium text-muted">{index + 1}</span>
      <div className={`absolute right-2 top-2 flex gap-0.5 rounded-lg bg-surface/95 p-0.5 opacity-0 shadow-pop transition group-hover:opacity-100 max-md:hidden ${
          // Touch: tap selects a page and only then shows its actions (hidden ones must not catch taps).
          selected ? "pointer-coarse:opacity-100" : "pointer-coarse:pointer-events-none"
        }`}>
        <IconButton size="sm" icon={RotateCcw} label={t("Girar a la izquierda")} {...NO_DRAG} onClick={(e) => (e.stopPropagation(), rotatePages([page.id], 270))} />
        <IconButton size="sm" icon={RotateCw} label={t("Girar a la derecha")} {...NO_DRAG} onClick={(e) => (e.stopPropagation(), rotatePages([page.id], 90))} />
        <IconButton size="sm" icon={Trash} label={t("Eliminar")} {...NO_DRAG} onClick={(e) => (e.stopPropagation(), deletePages([page.id]))} />
      </div>
    </div>
  );
}

export function OrganizePage() {
  const pages = useDocStore((s) => s.doc.pages);
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [size, setSize] = useState(() => (isMobileLayout() ? 120 : 150));
  const [dragging, setDragging] = useState<string | null>(null);
  const mobile = useIsMobile();
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridW, setGridW] = useState(0);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const update = () => setGridW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Phone: 2 columns (3 on wide phones/tablets) filling the width; container p-3, gap-2, card p-3.
  const cols = gridW >= 600 ? 3 : 2;
  const cardSize = mobile && gridW > 0 ? Math.max(60, Math.floor((gridW - 24 - 8 * (cols - 1)) / cols) - 24) : size;
  // Mouse drags after 6 px; a finger needs a long press, so one-finger scrolling keeps working.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = useMemo(() => pages.map((p) => p.id), [pages]);
  const live = selected.filter((id) => ids.includes(id));
  const insertAt = live.length ? Math.max(...live.map((id) => ids.indexOf(id))) + 1 : pages.length;

  useWindowFileDrop(async (files) => {
    await handleDroppedFiles(files, { currentPage: Math.max(0, insertAt - 1), pageCount: pages.length });
  }, ["pdf", "png", "jpg", "jpeg", "webp", "gif", "bmp"]);

  const click = (e: MouseEvent, index: number) => {
    const id = pages[index].id;
    // No Ctrl/Shift on a touch screen: a tap toggles the page.
    const touch = (e.nativeEvent as PointerEvent).pointerType === "touch";
    if (touch) {
      setSelected(live.includes(id) ? live.filter((x) => x !== id) : [...live, id]);
      setAnchor(index);
    } else if (e.shiftKey && anchor !== null) {
      const [a, b] = [Math.min(anchor, index), Math.max(anchor, index)];
      setSelected(pages.slice(a, b + 1).map((p) => p.id));
    } else if (e.ctrlKey || e.metaKey) {
      setSelected(live.includes(id) ? live.filter((x) => x !== id) : [...live, id]);
      setAnchor(index);
    } else {
      setSelected([id]);
      setAnchor(index);
    }
  };

  const onDragStart = (e: DragStartEvent) => {
    setDragging(String(e.active.id));
    if (!live.includes(String(e.active.id))) setSelected([String(e.active.id)]);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const moving = live.includes(String(active.id)) ? live : [String(active.id)];
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    // Dropping after the target when moving forward.
    movePages(moving, to > from ? to + 1 : to);
  };

  const remove = async () => {
    if (!live.length) return;
    if (live.length >= pages.length) {
      await confirmDialog({ title: t("No puedes eliminar todas las páginas"), message: t("El documento tiene que conservar al menos una."), confirmLabel: t("Entendido") });
      return;
    }
    deletePages(live);
    setSelected([]);
  };

  const insertFromFile = async () => {
    const files = await platform.openFiles({ kinds: ["pdf", "image"], multiple: true, title: t("Insertar páginas de…") });
    if (files.length) await addFilesToWorkspace(files, insertAt);
  };

  const backToEditor = (index?: number) => {
    if (index !== undefined) useEditorStore.getState().goToPage(index);
    useAppStore.getState().navigate({ name: "editor" });
  };

  const insertItems = [
    { id: "blank", label: t("Página en blanco"), icon: FileText, onSelect: () => {
      const ref = pages[Math.max(0, insertAt - 1)];
      const [x0, y0, x1, y1] = ref ? ref.crop ?? ref.view : [0, 0, 595.28, 841.89];
      insertPages(insertAt, [blankPage(Math.abs(x1 - x0), Math.abs(y1 - y0))]);
    } },
    { id: "file", label: t("Páginas de otro archivo…"), icon: FilePlus, onSelect: () => void insertFromFile() },
  ];

  const draggingPage = pages.find((p) => p.id === dragging);

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        phoneHideSettings
        phoneLeading={<IconButton icon={ArrowLeft} label={t("Editor")} onClick={() => backToEditor()} />}
        right={
          mobile ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={t("Guardar")}
                onClick={() => void saveWorkspace(quickSaveOptions())}
                className="grid size-10 place-items-center rounded-full bg-primary text-on-primary outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-brand-500/50 active:bg-primary-hover"
              >
                <Save size={20} />
              </button>
              <Menu
                align="end"
                trigger={<IconButton icon={EllipsisVertical} label={t("Más opciones")} />}
                items={[{ id: "settings", label: t("Preferencias"), icon: Settings, onSelect: openSettings }]}
              />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 max-md:gap-1">
              <Button size="sm" variant="ghost" icon={ArrowLeft} aria-label={t("Editor")} onClick={() => backToEditor()} className="max-md:size-9 max-md:px-0">
                <span className="max-md:hidden">{t("Editor")}</span>
              </Button>
              <Button size="sm" variant="primary" icon={Save} aria-label={t("Guardar")} onClick={() => void saveWorkspace(quickSaveOptions())} className="max-md:size-9 max-md:px-0">
                <span className="max-md:hidden">{t("Guardar")}</span>
              </Button>
            </div>
          )
        }
      />
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-3 md:overflow-x-auto max-md:px-2">
        <span className="mr-2 w-36 shrink-0 whitespace-nowrap text-xs text-muted max-md:mr-auto max-md:w-auto max-md:min-w-0 max-md:truncate">
          {live.length
            ? t(live.length === 1 ? "{n} seleccionada" : "{n} seleccionadas", { n: live.length })
            : t(pages.length === 1 ? "{n} página" : "{n} páginas", { n: pages.length })}
        </span>
        <IconButton icon={RotateCcw} label={t("Girar a la izquierda")} disabled={!live.length} onClick={() => rotatePages(live, 270)} />
        <IconButton icon={RotateCw} label={t("Girar a la derecha")} disabled={!live.length} onClick={() => rotatePages(live, 90)} />
        <IconButton icon={CopyPlus} label={t("Duplicar")} disabled={!live.length} onClick={() => setSelected(duplicatePages(live))} />
        <IconButton icon={Trash} label={t("Eliminar")} disabled={!live.length} onClick={() => void remove()} />
        {mobile ? (
          <Menu
            align="end"
            trigger={<IconButton icon={EllipsisVertical} label={t("Más")} />}
            items={[
              ...insertItems,
              { type: "separator" },
              { id: "extract", label: t("Extraer selección"), icon: FileOutput, disabled: !live.length, onSelect: () => void extractPages(live) },
            ]}
          />
        ) : (
          <>
            <div className="mx-1 h-6 w-px bg-line" />
            <Menu
              trigger={
                <Button size="sm" variant="ghost" icon={FilePlus} aria-label={t("Insertar")}>
                  <span>{t("Insertar")}</span>
                </Button>
              }
              items={insertItems}
            />
            <Button size="sm" variant="ghost" icon={FileOutput} aria-label={t("Extraer selección")} disabled={!live.length} onClick={() => void extractPages(live)}>
              <span>{t("Extraer selección")}</span>
            </Button>
            <div className="ml-auto flex w-48 shrink-0 items-center gap-2">
              <Slider min={90} max={260} step={10} value={size} onChange={setSize} className="flex-1" />
            </div>
          </>
        )}
      </div>
      <div
        ref={gridRef}
        className="min-h-0 flex-1 overflow-y-auto bg-canvas p-3 md:p-6"
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelected([]);
        }}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <div className="flex flex-wrap content-start gap-2" style={mobile ? { display: "grid", gridTemplateColumns: `repeat(${cols}, ${cardSize + 24}px)`, justifyContent: "center" } : undefined} onClick={(e) => e.target === e.currentTarget && setSelected([])}>
              {pages.map((p, i) => (
                <PageCard key={p.id} page={p} index={i} width={cardSize} selected={live.includes(p.id)} onClick={(e) => click(e, i)} onOpen={() => backToEditor(i)} />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {draggingPage && (
              <div className="relative">
                <PageThumb page={draggingPage} width={cardSize * 0.86} className="rounded-sm shadow-pop" />
                {live.length > 1 && (
                  <span className="absolute -right-2 -top-2 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-on-primary">{live.length}</span>
                )}
              </div>
            )}
          </DragOverlay>
        </DndContext>
        <p className="mt-6 text-center text-xs text-subtle max-md:hidden">
          {t("Arrastra para reordenar · Ctrl/Mayús + clic para seleccionar varias · Doble clic para abrir en el editor · Suelta archivos aquí para añadir sus páginas")}
        </p>
        <p className="mt-6 text-center text-xs text-subtle md:hidden">
          {t("Toca para seleccionar varias · Mantén pulsada una página para moverla · Doble toque para abrirla en el editor")}
        </p>
      </div>
    </div>
  );
}
