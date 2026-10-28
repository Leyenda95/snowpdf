import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";

export interface FloatingPosition {
  top: number;
  left: number;
  /** Side actually used (may differ from the requested one when there is no room). */
  side: Side;
}

const VIEWPORT_MARGIN = 8;

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), Math.max(lo, hi));
}

/**
 * Places a `position: fixed` element next to an anchor rectangle: flips to the opposite
 * side when the preferred one does not fit, then keeps the element inside the viewport.
 */
export function computePosition(
  anchor: DOMRect,
  size: { width: number; height: number },
  side: Side,
  align: Align,
  gap: number,
): FloatingPosition {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  const room: Record<Side, number> = {
    top: anchor.top - VIEWPORT_MARGIN,
    bottom: vh - anchor.bottom - VIEWPORT_MARGIN,
    left: anchor.left - VIEWPORT_MARGIN,
    right: vw - anchor.right - VIEWPORT_MARGIN,
  };
  const needed = (side === "top" || side === "bottom" ? size.height : size.width) + gap;
  const used: Side = room[side] < needed && room[OPPOSITE[side]] > room[side] ? OPPOSITE[side] : side;

  let top: number;
  let left: number;
  if (used === "top" || used === "bottom") {
    top = used === "top" ? anchor.top - gap - size.height : anchor.bottom + gap;
    left =
      align === "start"
        ? anchor.left
        : align === "end"
          ? anchor.right - size.width
          : anchor.left + anchor.width / 2 - size.width / 2;
  } else {
    left = used === "left" ? anchor.left - gap - size.width : anchor.right + gap;
    top =
      align === "start"
        ? anchor.top
        : align === "end"
          ? anchor.bottom - size.height
          : anchor.top + anchor.height / 2 - size.height / 2;
  }

  return {
    top: Math.round(clamp(top, VIEWPORT_MARGIN, vh - size.height - VIEWPORT_MARGIN)),
    left: Math.round(clamp(left, VIEWPORT_MARGIN, vw - size.width - VIEWPORT_MARGIN)),
    side: used,
  };
}

/**
 * Inline style that places a `fixed left-0 top-0` element. The `translate` property is used
 * instead of left/top so the element keeps the whole viewport as its available width (text
 * does not re-wrap near the right edge) and so `scale-*` animations are not distorted by the
 * position. Pair it with `transition-[opacity,scale]` so the move itself is never animated.
 */
export function floatingStyle(pos: FloatingPosition | null): CSSProperties | undefined {
  return pos ? { translate: `${pos.left}px ${pos.top}px` } : undefined;
}

/** Transform origin that makes scale animations grow out of the anchor. */
export const ORIGIN_CLASS: Record<Side, string> = {
  top: "origin-bottom",
  bottom: "origin-top",
  left: "origin-right",
  right: "origin-left",
};

interface UseFloatingOptions {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  side: Side;
  align: Align;
  gap?: number;
}

/**
 * Positions a portal-rendered element next to an anchor. Render the element with
 * `position: fixed` and keep it invisible while `pos` is null: the first measurement
 * happens in a layout effect, so it never flashes at the wrong place.
 */
export function useFloating<F extends HTMLElement>({ open, anchorRef, side, align, gap = 6 }: UseFloatingOptions) {
  const floatingRef = useRef<F | null>(null);
  const [pos, setPos] = useState<FloatingPosition | null>(null);

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;
    const next = computePosition(
      anchor.getBoundingClientRect(),
      { width: floating.offsetWidth, height: floating.offsetHeight },
      side,
      align,
      gap,
    );
    setPos((prev) => (prev && prev.top === next.top && prev.left === next.left && prev.side === next.side ? prev : next));
  }, [anchorRef, side, align, gap]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (observer && floatingRef.current) observer.observe(floatingRef.current);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      observer?.disconnect();
    };
  }, [open, update]);

  return { floatingRef, pos, update };
}
