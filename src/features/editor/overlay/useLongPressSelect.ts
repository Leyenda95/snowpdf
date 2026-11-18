import { useEffect, useRef, type RefObject } from "react";
import type { PageRef } from "@/model/types";
import { caretAt, hitChar, wordRange, type CharRange, type TextIndex } from "@/render/charSelection";
import { getTextIndex } from "@/render/pageTextIndex";
import type { PageGeometry } from "../viewer/geometry";
import { TAP_EXCLUDED } from "../viewer/Viewer";
import { useTouchSelection } from "../touchSelection";

const LONG_PRESS_MS = 450;
const SLOP_PX = 8;
/** Press tolerance around a glyph (CSS px). */
const HIT_PX = 8;

/** True from a long press that selected text until the next touch starts (so tools ignore its release). */
let handled = false;
export function longPressSelectHandled(): boolean {
  return handled;
}

interface Press {
  id: number;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** The word picked by the long press; set once the selection exists. */
  word: CharRange | null;
  index: Promise<TextIndex>;
  /** Cancelled before it fired (moved, lifted, second finger). */
  dead: boolean;
}

/**
 * Phone long press on text: selects the word under the finger (exact MuPDF glyph boxes) and, while
 * the finger stays down, extends the selection to the caret under it, like Android's long-press-drag.
 */
export function useLongPressSelect(page: PageRef, geom: PageGeometry, rootRef: RefObject<HTMLElement | null>, enabled: boolean): void {
  const geomRef = useRef(geom);
  geomRef.current = geom;

  useEffect(() => {
    const pageEl = rootRef.current?.closest<HTMLElement>(".snow-page");
    if (!enabled || !page.sourceId || !pageEl) return;
    const sourceId: string = page.sourceId;
    const sourceIndex = page.sourceIndex;
    let press: Press | null = null;

    /** Overlay-local CSS px of a client point. */
    const toUser = (cx: number, cy: number) => {
      const r = rootRef.current!.getBoundingClientRect();
      return geomRef.current.visible.toUser(cx - r.left, cy - r.top);
    };
    const kill = () => {
      if (press?.timer) clearTimeout(press.timer);
      if (press) press.dead = true;
      press = null;
    };

    const fire = async (p: Press) => {
      p.timer = null;
      let t: TextIndex;
      try {
        t = await p.index;
      } catch {
        return;
      }
      if (p.dead || press !== p) return;
      const u = toUser(p.x, p.y);
      const hit = hitChar(t, u.x, u.y, HIT_PX / geomRef.current.scale);
      if (hit < 0) return;
      p.word = wordRange(t, hit);
      handled = true;
      window.getSelection()?.removeAllRanges();
      useTouchSelection.getState().set({ pageId: page.id, sourceId, sourceIndex, range: p.word });
    };

    function onTouchMove(e: TouchEvent) {
      const p = press;
      if (!p?.word || e.touches.length !== 1) return;
      if (e.cancelable) e.preventDefault();
      const touch = e.touches[0];
      void p.index.then((t) => {
        if (p.dead || press !== p || !p.word) return;
        const u = toUser(touch.clientX, touch.clientY);
        const c = caretAt(t, u.x, u.y);
        const range = c < p.word.start ? { start: c, end: p.word.end } : { start: p.word.start, end: Math.max(c, p.word.end) };
        useTouchSelection.getState().set({ pageId: page.id, sourceId, sourceIndex, range });
      });
    }

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      handled = false;
      kill();
      if (!e.isPrimary || (e.target instanceof Element && e.target.closest(TAP_EXCLUDED))) return;
      const index = getTextIndex(sourceId, sourceIndex);
      index.catch(() => undefined);
      const p: Press = { id: e.pointerId, x: e.clientX, y: e.clientY, timer: null, word: null, index, dead: false };
      p.timer = setTimeout(() => void fire(p), LONG_PRESS_MS);
      press = p;
    };
    const onMove = (e: PointerEvent) => {
      const p = press;
      if (!p || p.word || p.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP_PX) kill();
    };
    const onEnd = (e: PointerEvent) => {
      if (press?.id === e.pointerId) kill();
    };
    // A second finger (pinch) cancels a pending press; the viewer hides it from pointer events.
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 1) kill();
    };
    // Android would otherwise open its own text menu on a long press.
    const onContext = (e: Event) => e.preventDefault();

    pageEl.addEventListener("pointerdown", onDown);
    pageEl.addEventListener("contextmenu", onContext);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    // Registered up front, not when the long press fires: Chrome decides whether a gesture's
    // touchmoves can be cancelled when it starts, so a listener added mid-gesture would arrive too
    // late and the page would scroll while the finger extends the selection. It only acts after a
    // long press (the viewer has non-passive touch listeners already, so this costs no scrolling).
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      kill();
      pageEl.removeEventListener("pointerdown", onDown);
      pageEl.removeEventListener("contextmenu", onContext);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("touchstart", onTouchStart, true);
    };
  }, [enabled, page.id, page.sourceId, page.sourceIndex, rootRef]);
}
