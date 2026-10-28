import {
  Children,
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { floatingStyle, useFloating, type Side } from "./floating";
import { joinIds, useMergedRef } from "./hooks";

export interface TooltipProps {
  content: ReactNode;
  side?: Side;
  /** A single element that can hold a ref and DOM event handlers (button, IconButton...). */
  children: ReactElement;
  disabled?: boolean;
}

/** Props the tooltip reads from, and merges into, its trigger element. */
interface TriggerProps {
  ref?: Ref<HTMLElement>;
  "aria-describedby"?: string;
  onPointerEnter?: PointerEventHandler<HTMLElement>;
  onPointerLeave?: PointerEventHandler<HTMLElement>;
  onPointerDown?: PointerEventHandler<HTMLElement>;
  onFocus?: FocusEventHandler<HTMLElement>;
  onBlur?: FocusEventHandler<HTMLElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
}

const SHOW_DELAY_MS = 400;
/** Moving between neighbouring triggers feels better without waiting again. */
const WARM_WINDOW_MS = 300;
let lastHiddenAt = 0;

function isKeyboardFocus(el: HTMLElement): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

export function Tooltip({ content, side = "top", children, disabled = false }: TooltipProps) {
  const child = Children.only(children) as ReactElement<TriggerProps>;
  const childProps = child.props;

  const [open, setOpen] = useState(false);
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const setRef = useMergedRef<HTMLElement>(anchorRef, childProps.ref);

  const hasContent = content !== null && content !== undefined && content !== false && content !== "";
  const visible = open && !disabled && hasContent;

  const { floatingRef, pos } = useFloating<HTMLDivElement>({ open: visible, anchorRef, side, align: "center", gap: 8 });

  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen((was) => {
      if (was) lastHiddenAt = Date.now();
      return false;
    });
  };

  const show = (immediate = false) => {
    window.clearTimeout(timer.current);
    const warm = Date.now() - lastHiddenAt < WARM_WINDOW_MS;
    timer.current = window.setTimeout(() => setOpen(true), immediate || warm ? 0 : SHOW_DELAY_MS);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Tooltips never survive scrolling or a changed trigger.
  useEffect(() => {
    if (!visible) return;
    const close = () => hide();
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [visible]);

  const trigger = cloneElement(child, {
    ref: setRef,
    "aria-describedby": joinIds(childProps["aria-describedby"], visible && id),
    onPointerEnter: (e) => {
      childProps.onPointerEnter?.(e);
      anchorRef.current ??= e.currentTarget;
      if (e.pointerType !== "touch") show();
    },
    onPointerLeave: (e) => {
      childProps.onPointerLeave?.(e);
      hide();
    },
    onPointerDown: (e) => {
      childProps.onPointerDown?.(e);
      hide();
    },
    onFocus: (e) => {
      childProps.onFocus?.(e);
      anchorRef.current ??= e.currentTarget;
      if (isKeyboardFocus(e.currentTarget)) show(true);
    },
    onBlur: (e) => {
      childProps.onBlur?.(e);
      hide();
    },
    onKeyDown: (e) => {
      childProps.onKeyDown?.(e);
      if (e.key === "Escape") hide();
    },
  });

  return (
    <>
      {trigger}
      {visible &&
        createPortal(
          <div
            ref={floatingRef}
            id={id}
            role="tooltip"
            className={cn(
              "pointer-events-none fixed left-0 top-0 z-[70] max-w-xs rounded-md px-2 py-1 text-xs font-medium leading-snug shadow-pop",
              "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900",
              "transition-opacity duration-100 motion-reduce:transition-none",
              pos ? "opacity-100" : "opacity-0",
            )}
            style={floatingStyle(pos)}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
