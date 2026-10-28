import { useEffect, useRef } from "react";
import { useLatest } from "./hooks";

/*
 * Escape handling for stacked overlays (modal > menu > popover ...): only the layer opened
 * last reacts, so one key press never closes two things at once.
 */
interface Layer {
  onEscape(): void;
}

const layers: Layer[] = [];

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
  const top = layers[layers.length - 1];
  if (!top) return;
  e.preventDefault();
  // One key press closes one layer: keep window-level Escape handlers (deselect...) from also reacting.
  e.stopPropagation();
  top.onEscape();
}

export function useEscapeLayer(active: boolean, onEscape: () => void): void {
  const handler = useLatest(onEscape);
  useEffect(() => {
    if (!active) return;
    const layer: Layer = { onEscape: () => handler.current() };
    layers.push(layer);
    if (layers.length === 1) document.addEventListener("keydown", onKeyDown);
    return () => {
      const index = layers.indexOf(layer);
      if (index >= 0) layers.splice(index, 1);
      if (layers.length === 0) document.removeEventListener("keydown", onKeyDown);
    };
  }, [active, handler]);
}

/**
 * Dismisses a floating layer on Escape and on pointer-downs outside of it.
 *
 * "Inside" is decided through React's event tree (not the DOM tree): spread the returned
 * props on the trigger and on the floating panel. Because React events bubble through
 * portals, a popover opened from inside another popover counts as inside of its parent.
 */
export function useDismiss(open: boolean, onDismiss: (reason: "escape" | "outside") => void) {
  const inside = useRef(false);
  const dismiss = useLatest(onDismiss);

  useEffect(() => {
    if (!open) return;
    const reset = () => {
      inside.current = false;
    };
    const check = () => {
      if (inside.current) inside.current = false;
      else dismiss.current("outside");
    };
    // Capture runs before React's handlers (which flag "inside"); bubble runs after them.
    document.addEventListener("pointerdown", reset, true);
    document.addEventListener("pointerdown", check);
    return () => {
      document.removeEventListener("pointerdown", reset, true);
      document.removeEventListener("pointerdown", check);
    };
  }, [open, dismiss]);

  useEscapeLayer(open, () => dismiss.current("escape"));

  return {
    onPointerDown: () => {
      inside.current = true;
    },
  };
}
