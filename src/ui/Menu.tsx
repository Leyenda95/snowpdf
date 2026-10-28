import {
  Children,
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { Check, type LucideIcon } from "lucide-react";
import { cn } from "./cn";
import { floatingStyle, ORIGIN_CLASS, useFloating } from "./floating";
import { useMergedRef } from "./hooks";
import { useDismiss } from "./layers";
import { keyLabel } from "@/i18n";

export interface MenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  /** When defined the item behaves like a checkbox/radio entry and shows a check mark. */
  checked?: boolean;
  onSelect?: () => void;
}

export type MenuEntry = MenuItem | { type: "separator" } | { type: "label"; label: string };

export interface MenuProps {
  /** A single element that can hold a ref and a click handler (Button, IconButton...). */
  trigger: ReactElement;
  items: MenuEntry[];
  align?: "start" | "end";
  side?: "bottom" | "top" | "right";
}

/** Props the menu reads from, and merges into, its trigger element. */
interface TriggerProps {
  ref?: Ref<HTMLElement>;
  "aria-haspopup"?: "menu";
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  onPointerDown?: PointerEventHandler<HTMLElement>;
}

const ITEM_SELECTOR = '[role^="menuitem"]:not(:disabled)';

function isItem(entry: MenuEntry): entry is MenuItem {
  return "id" in entry;
}

export function Menu({ trigger, items, align = "start", side = "bottom" }: MenuProps) {
  const child = Children.only(trigger) as ReactElement<TriggerProps>;
  const childProps = child.props;

  const [open, setOpen] = useState(false);
  const menuId = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const openedWithKeyboard = useRef(false);
  const setAnchor = useMergedRef<HTMLElement>(anchorRef, childProps.ref);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) anchorRef.current?.focus({ preventScroll: true });
  };

  const inside = useDismiss(open, (reason) => close(reason === "escape"));
  const { floatingRef, pos } = useFloating<HTMLDivElement>({ open, anchorRef, side, align, gap: 6 });
  const setMenu = useMergedRef<HTMLDivElement>(menuRef, floatingRef);

  const hasIcons = items.some((entry) => isItem(entry) && entry.icon);

  const focusItem = (which: "first" | "last" | "next" | "prev") => {
    const menu = menuRef.current;
    if (!menu) return;
    const list = Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
    if (list.length === 0) return;
    const current = list.indexOf(document.activeElement as HTMLElement);
    const index =
      which === "first"
        ? 0
        : which === "last"
          ? list.length - 1
          : which === "next"
            ? (current + 1) % list.length
            : (current <= 0 ? list.length : current) - 1;
    list[index].focus({ preventScroll: true });
  };

  // Move focus into the menu once it is mounted.
  useEffect(() => {
    if (!open) return;
    if (openedWithKeyboard.current) focusItem("first");
    else menuRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const select = (item: MenuItem) => {
    if (item.disabled) return;
    close(true);
    item.onSelect?.();
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusItem("next");
        break;
      case "ArrowUp":
        e.preventDefault();
        focusItem("prev");
        break;
      case "Home":
        e.preventDefault();
        focusItem("first");
        break;
      case "End":
        e.preventDefault();
        focusItem("last");
        break;
      case "Tab":
        // Leave the menu and let the browser continue from the trigger.
        close(true);
        break;
    }
  };

  const clonedTrigger = cloneElement(child, {
    ref: setAnchor,
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": open ? menuId : undefined,
    onPointerDown: (e) => {
      childProps.onPointerDown?.(e);
      inside.onPointerDown();
    },
    onClick: (e) => {
      childProps.onClick?.(e);
      if (e.defaultPrevented) return;
      anchorRef.current ??= e.currentTarget;
      // detail === 0 means the click came from the keyboard (Enter / Space).
      openedWithKeyboard.current = e.detail === 0;
      setOpen((was) => !was);
    },
    onKeyDown: (e) => {
      childProps.onKeyDown?.(e);
      if (e.defaultPrevented) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openedWithKeyboard.current = true;
        setOpen(true);
      }
    },
  });

  return (
    <>
      {clonedTrigger}
      {open &&
        createPortal(
          <div
            ref={setMenu}
            id={menuId}
            role="menu"
            tabIndex={-1}
            onKeyDown={onMenuKeyDown}
            onMouseLeave={() => menuRef.current?.focus({ preventScroll: true })}
            {...inside}
            className={cn(
              "fixed left-0 top-0 z-[60] max-h-[calc(100vh-1rem)] min-w-48 overflow-y-auto rounded-xl border border-line bg-surface p-1 text-fg shadow-pop outline-none",
              "transition-[opacity,scale] duration-100 ease-out motion-reduce:transition-none",
              pos ? cn("scale-100 opacity-100", ORIGIN_CLASS[pos.side]) : "scale-95 opacity-0",
            )}
            style={floatingStyle(pos)}
          >
            {items.map((entry, index) => {
              if (!isItem(entry)) {
                return entry.type === "separator" ? (
                  <div key={`separator-${index}`} role="separator" className="-mx-1 my-1 h-px bg-line" />
                ) : (
                  <div key={`label-${index}`} role="presentation" className="px-2.5 pb-1 pt-2 text-xs font-medium text-subtle">
                    {entry.label}
                  </div>
                );
              }
              const Icon = entry.icon;
              const checkable = entry.checked !== undefined;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role={checkable ? "menuitemcheckbox" : "menuitem"}
                  aria-checked={checkable ? entry.checked : undefined}
                  disabled={entry.disabled}
                  tabIndex={-1}
                  onClick={() => select(entry)}
                  onMouseMove={(e) => {
                    if (document.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none transition-colors",
                    "disabled:cursor-not-allowed disabled:opacity-45",
                    entry.danger
                      ? "text-red-600 focus:bg-red-50 dark:text-red-400 dark:focus:bg-red-500/10"
                      : "text-fg focus:bg-surface-3",
                  )}
                >
                  {hasIcons && (
                    <span className={cn("grid size-4 shrink-0 place-items-center", !entry.danger && "text-muted")}>
                      {Icon && <Icon size={16} aria-hidden />}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  {entry.shortcut && <span className="ml-4 shrink-0 text-xs text-subtle">{keyLabel(entry.shortcut)}</span>}
                  {checkable && (
                    <span className="grid size-4 shrink-0 place-items-center text-brand-600 dark:text-brand-300">
                      {entry.checked && <Check size={16} aria-hidden />}
                    </span>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
