import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Copy, Trash, type LucideIcon } from "lucide-react";
import { deleteObjects, duplicateObjects, reorderObjects } from "@/model/docActions";
import { cn } from "@/ui/cn";
import { useDismiss } from "@/ui/layers";
import { useEditorStore } from "../editorStore";
import { keyLabel, t, type Msg } from "@/i18n";

type Order = Parameters<typeof reorderObjects>[1];

interface Entry {
  id: string;
  label: Msg;
  icon: LucideIcon;
  shortcut?: string;
  danger?: boolean;
  run(ids: string[]): void;
}

const ORDER: Entry[] = [
  { id: "front", label: "Traer al frente", icon: ArrowUpToLine, shortcut: "Ctrl+Mayús+]", run: (ids) => reorderObjects(ids, "front") },
  { id: "forward", label: "Traer adelante", icon: ArrowUp, shortcut: "Ctrl+]", run: (ids) => reorderObjects(ids, "forward") },
  { id: "backward", label: "Enviar atrás", icon: ArrowDown, shortcut: "Ctrl+[", run: (ids) => reorderObjects(ids, "backward") },
  { id: "back", label: "Enviar al fondo", icon: ArrowDownToLine, shortcut: "Ctrl+Mayús+[", run: (ids) => reorderObjects(ids, "back") },
];

const ACTIONS: Entry[] = [
  { id: "duplicate", label: "Duplicar", icon: Copy, shortcut: "Ctrl+D", run: (ids) => useEditorStore.getState().select(duplicateObjects(ids)) },
  {
    id: "delete",
    label: "Eliminar",
    icon: Trash,
    shortcut: "Supr",
    danger: true,
    run: (ids) => {
      deleteObjects(ids);
      useEditorStore.getState().select([]);
    },
  },
];

/** Context menu of editor objects, opened at the cursor. Acts on `ids`. */
export function ObjectContextMenu({ x, y, ids, onClose }: { x: number; y: number; ids: string[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const inside = useDismiss(true, onClose);

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
  }, [x, y]);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const focusItem = (dir: 1 | -1) => {
    const list = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    list[(i + dir + list.length) % list.length].focus({ preventScroll: true });
  };

  const item = (entry: Entry) => {
    const Icon = entry.icon;
    return (
      <button
        key={entry.id}
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={() => {
          onClose();
          entry.run(ids);
        }}
        onMouseMove={(e) => {
          if (document.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
        }}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none transition-colors",
          entry.danger ? "text-red-600 focus:bg-red-50 dark:text-red-400 dark:focus:bg-red-500/10" : "text-fg focus:bg-surface-3",
        )}
      >
        <span className={cn("grid size-4 shrink-0 place-items-center", !entry.danger && "text-muted")}>
          <Icon size={16} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate">{t(entry.label)}</span>
        {entry.shortcut && <span className="ml-4 shrink-0 text-xs text-subtle">{keyLabel(entry.shortcut)}</span>}
      </button>
    );
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      {...inside}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") (e.preventDefault(), focusItem(1));
        else if (e.key === "ArrowUp") (e.preventDefault(), focusItem(-1));
        else if (e.key === "Tab") onClose();
      }}
      className="fixed z-[60] min-w-56 rounded-xl border border-line bg-surface p-1 text-fg shadow-pop outline-none"
      style={pos}
    >
      {ORDER.map(item)}
      <div role="separator" className="-mx-1 my-1 h-px bg-line" />
      {ACTIONS.map(item)}
    </div>,
    document.body,
  );
}

// ---- Acrobat-style shortcuts. EditorPage owns the other keys, so these live here, once for all pages.

let shortcutUsers = 0;

function onShortcut(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  const open = e.code === "BracketRight" || e.key === "]" || e.key === "}";
  const close = e.code === "BracketLeft" || e.key === "[" || e.key === "{";
  if (!open && !close) return;
  const ids = useEditorStore.getState().selection;
  if (!ids.length) return;
  const where: Order = open ? (e.shiftKey ? "front" : "forward") : e.shiftKey ? "back" : "backward";
  e.preventDefault();
  reorderObjects(ids, where);
}

export function useOrderShortcuts(): void {
  useEffect(() => {
    if (shortcutUsers++ === 0) window.addEventListener("keydown", onShortcut);
    return () => {
      if (--shortcutUsers === 0) window.removeEventListener("keydown", onShortcut);
    };
  }, []);
}
