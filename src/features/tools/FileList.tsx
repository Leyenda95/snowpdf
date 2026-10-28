import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import { Spinner, cn } from "@/ui";
import { FileCard, type CardSize } from "./FileCard";
import type { CardExtras, ToolFile } from "./types";
import { t } from "@/i18n";

interface FileListProps {
  files: ToolFile[];
  size: CardSize;
  sortable: boolean;
  /** The tool takes several files: shows the "Añadir más" tile and card numbers. */
  multiple: boolean;
  adding: boolean;
  disabled: boolean;
  extrasFor?: (file: ToolFile) => CardExtras | undefined;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onReorder: (files: ToolFile[]) => void;
}

interface ItemProps {
  file: ToolFile;
  index?: number;
  size: CardSize;
  extras?: CardExtras;
  disabled: boolean;
  onRemove: () => void;
}

function SortableCard({ file, index, size, extras, disabled, onRemove }: ItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: file.id, disabled });
  return (
    <FileCard
      file={file}
      index={index}
      size={size}
      extras={extras}
      draggable
      dragging={isDragging}
      disabled={disabled}
      onRemove={onRemove}
      rootRef={setNodeRef}
      rootStyle={{ transform: CSS.Transform.toString(transform), transition }}
      rootProps={{ ...attributes, ...listeners }}
    />
  );
}

export function FileList({ files, size, sortable, multiple, adding, disabled, extrasFor, onAdd, onRemove, onReorder }: FileListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = files.findIndex((f) => f.id === active.id);
    const to = files.findIndex((f) => f.id === over.id);
    if (from >= 0 && to >= 0) onReorder(arrayMove(files, from, to));
  };

  const numbered = multiple && files.length > 1;
  const cards = files.map((file, i) =>
    sortable ? (
      <SortableCard
        key={file.id}
        file={file}
        index={i + 1}
        size={size}
        extras={extrasFor?.(file)}
        disabled={disabled}
        onRemove={() => onRemove(file.id)}
      />
    ) : (
      <FileCard
        key={file.id}
        file={file}
        index={numbered ? i + 1 : undefined}
        size={size}
        extras={extrasFor?.(file)}
        disabled={disabled}
        onRemove={() => onRemove(file.id)}
      />
    ),
  );

  return (
    <div className="flex flex-wrap content-start gap-4">
      {sortable ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={files.map((f) => f.id)} strategy={rectSortingStrategy}>
            {cards}
          </SortableContext>
        </DndContext>
      ) : (
        cards
      )}
      {multiple && (
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled || adding}
          className={cn(
            "flex w-44 flex-col items-center justify-center gap-2 self-stretch rounded-xl border-2 border-dashed border-line-strong bg-surface-2/60 p-4 text-sm font-medium text-muted outline-none transition-colors",
            "hover:border-brand-400 hover:bg-brand-50/60 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:hover:bg-brand-500/5 dark:hover:text-brand-200",
            "min-h-56 disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          <span className="grid size-10 place-items-center rounded-full bg-surface-3">
            {adding ? <Spinner size={18} /> : <Plus size={20} aria-hidden />}
          </span>
          {adding ? t("Leyendo archivos…") : t("Añadir más")}
        </button>
      )}
    </div>
  );
}
