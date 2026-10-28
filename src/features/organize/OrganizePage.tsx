import { useMemo, useState, type MouseEvent } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowLeft, CopyPlus, FileOutput, FilePlus, FileText, RotateCcw, RotateCw, Save, Trash } from "lucide-react";
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
import { Button, IconButton, Menu, Slider, confirmDialog, useWindowFileDrop } from "@/ui";
import { t } from "@/i18n";

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
      style={{ transform: CSS.Transform.toString(transform), transition, width: width + 24 }}
      className={`group relative flex flex-col items-center gap-2 rounded-xl p-3 outline-none transition-colors ${
        selected ? "bg-brand-50 ring-2 ring-brand-500 dark:bg-brand-500/10" : "hover:bg-surface-3"
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
      <div className="absolute right-2 top-2 flex gap-0.5 rounded-lg bg-surface/95 p-0.5 opacity-0 shadow-pop transition group-hover:opacity-100">
        <IconButton size="sm" icon={RotateCcw} label={t("Girar a la izquierda")} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), rotatePages([page.id], 270))} />
        <IconButton size="sm" icon={RotateCw} label={t("Girar a la derecha")} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), rotatePages([page.id], 90))} />
        <IconButton size="sm" icon={Trash} label={t("Eliminar")} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), deletePages([page.id]))} />
      </div>
    </div>
  );
}

export function OrganizePage() {
  const pages = useDocStore((s) => s.doc.pages);
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [size, setSize] = useState(150);
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = useMemo(() => pages.map((p) => p.id), [pages]);
  const live = selected.filter((id) => ids.includes(id));
  const insertAt = live.length ? Math.max(...live.map((id) => ids.indexOf(id))) + 1 : pages.length;

  useWindowFileDrop(async (files) => {
    await handleDroppedFiles(files, { currentPage: Math.max(0, insertAt - 1), pageCount: pages.length });
  }, ["pdf", "png", "jpg", "jpeg", "webp", "gif", "bmp"]);

  const click = (e: MouseEvent, index: number) => {
    const id = pages[index].id;
    if (e.shiftKey && anchor !== null) {
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

  const draggingPage = pages.find((p) => p.id === dragging);

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        right={
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => backToEditor()}>
              {t("Editor")}
            </Button>
            <Button size="sm" variant="primary" icon={Save} onClick={() => void saveWorkspace(quickSaveOptions())}>
              {t("Guardar")}
            </Button>
          </div>
        }
      />
      <div className="flex h-12 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line bg-surface px-3">
        <span className="mr-2 w-36 shrink-0 text-xs text-muted">
          {live.length
            ? t(live.length === 1 ? "{n} seleccionada" : "{n} seleccionadas", { n: live.length })
            : t(pages.length === 1 ? "{n} página" : "{n} páginas", { n: pages.length })}
        </span>
        <IconButton icon={RotateCcw} label={t("Girar a la izquierda")} disabled={!live.length} onClick={() => rotatePages(live, 270)} />
        <IconButton icon={RotateCw} label={t("Girar a la derecha")} disabled={!live.length} onClick={() => rotatePages(live, 90)} />
        <IconButton icon={CopyPlus} label={t("Duplicar")} disabled={!live.length} onClick={() => setSelected(duplicatePages(live))} />
        <IconButton icon={Trash} label={t("Eliminar")} disabled={!live.length} onClick={() => void remove()} />
        <div className="mx-1 h-6 w-px bg-line" />
        <Menu
          trigger={
            <Button size="sm" variant="ghost" icon={FilePlus}>
              {t("Insertar")}
            </Button>
          }
          items={[
            { id: "blank", label: t("Página en blanco"), icon: FileText, onSelect: () => {
              const ref = pages[Math.max(0, insertAt - 1)];
              const [x0, y0, x1, y1] = ref ? ref.crop ?? ref.view : [0, 0, 595.28, 841.89];
              insertPages(insertAt, [blankPage(Math.abs(x1 - x0), Math.abs(y1 - y0))]);
            } },
            { id: "file", label: t("Páginas de otro archivo…"), icon: FilePlus, onSelect: () => void insertFromFile() },
          ]}
        />
        <Button size="sm" variant="ghost" icon={FileOutput} disabled={!live.length} onClick={() => void extractPages(live)}>
          {t("Extraer selección")}
        </Button>
        <div className="ml-auto flex w-48 shrink-0 items-center gap-2">
          <Slider min={90} max={260} step={10} value={size} onChange={setSize} className="flex-1" />
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto bg-canvas p-6"
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelected([]);
        }}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <div className="flex flex-wrap content-start gap-2" onClick={(e) => e.target === e.currentTarget && setSelected([])}>
              {pages.map((p, i) => (
                <PageCard key={p.id} page={p} index={i} width={size} selected={live.includes(p.id)} onClick={(e) => click(e, i)} onOpen={() => backToEditor(i)} />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {draggingPage && (
              <div className="relative">
                <PageThumb page={draggingPage} width={size * 0.86} className="rounded-sm shadow-pop" />
                {live.length > 1 && (
                  <span className="absolute -right-2 -top-2 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">{live.length}</span>
                )}
              </div>
            )}
          </DragOverlay>
        </DndContext>
        <p className="mt-6 text-center text-xs text-subtle">
          {t("Arrastra para reordenar · Ctrl/Mayús + clic para seleccionar varias · Doble clic para abrir en el editor · Suelta archivos aquí para añadir sus páginas")}
        </p>
      </div>
    </div>
  );
}
