import {
  Children,
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { floatingStyle, ORIGIN_CLASS, useFloating, type Align, type Side } from "./floating";
import { useMergedRef } from "./hooks";
import { useDismiss } from "./layers";

export interface PopoverProps {
  /** A single element that can hold a ref and a click handler (Button, IconButton...). */
  trigger: ReactElement;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: Align;
  side?: Side;
  /** Controlled mode: pass `open` together with `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Extra classes for the panel (width, max height...). */
  className?: string;
  /** Default inner padding (p-3). Turn off for list-like content that goes edge to edge. */
  padded?: boolean;
}

/** Props the popover reads from, and merges into, its trigger element. */
interface TriggerProps {
  ref?: Ref<HTMLElement>;
  "aria-haspopup"?: "dialog";
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  onPointerDown?: PointerEventHandler<HTMLElement>;
}

export function Popover({
  trigger,
  children,
  align = "center",
  side = "bottom",
  open: openProp,
  onOpenChange,
  className,
  padded = true,
}: PopoverProps) {
  const child = Children.only(trigger) as ReactElement<TriggerProps>;
  const childProps = child.props;

  const [innerOpen, setInnerOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : innerOpen;

  const panelId = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const setAnchor = useMergedRef<HTMLElement>(anchorRef, childProps.ref);

  const setOpen = (next: boolean) => {
    if (!controlled) setInnerOpen(next);
    if (next !== open) onOpenChange?.(next);
  };

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) anchorRef.current?.focus({ preventScroll: true });
  };

  const inside = useDismiss(open, (reason) => close(reason === "escape"));
  const { floatingRef, pos } = useFloating<HTMLDivElement>({ open, anchorRef, side, align, gap: 8 });
  const setPanel = useMergedRef<HTMLDivElement>(panelRef, floatingRef);

  // Move focus into the panel when it opens so keyboard users can reach its controls.
  useEffect(() => {
    const panel = panelRef.current;
    if (open && panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
  }, [open]);

  const clonedTrigger = cloneElement(child, {
    ref: setAnchor,
    "aria-haspopup": "dialog",
    "aria-expanded": open,
    "aria-controls": open ? panelId : undefined,
    onPointerDown: (e) => {
      childProps.onPointerDown?.(e);
      inside.onPointerDown();
    },
    onClick: (e) => {
      childProps.onClick?.(e);
      if (e.defaultPrevented) return;
      anchorRef.current ??= e.currentTarget;
      setOpen(!open);
    },
  });

  return (
    <>
      {clonedTrigger}
      {open &&
        createPortal(
          <div
            ref={setPanel}
            id={panelId}
            role="dialog"
            tabIndex={-1}
            {...inside}
            className={cn(
              "fixed left-0 top-0 z-[60] max-h-[calc(100vh-1rem)] max-w-[calc(100vw-1rem)] overflow-auto rounded-xl border border-line bg-surface text-fg shadow-pop outline-none",
              padded && "p-3",
              "transition-[opacity,scale] duration-100 ease-out motion-reduce:transition-none",
              pos ? cn("scale-100 opacity-100", ORIGIN_CLASS[pos.side]) : "scale-95 opacity-0",
              className,
            )}
            style={floatingStyle(pos)}
          >
            {typeof children === "function" ? children(() => close(true)) : children}
          </div>,
          document.body,
        )}
    </>
  );
}
