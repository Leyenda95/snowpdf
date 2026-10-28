import { useCallback, useLayoutEffect, useRef, type Ref, type RefCallback, type RefObject } from "react";

/** Keeps the latest value in a ref so long-lived listeners never see stale props. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Combines several refs (object or callback) into one callback ref. */
export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as { current: T | null }).current = node;
    }
  };
}

/** Like {@link mergeRefs} but with a stable identity while the refs do not change. */
export function useMergedRef<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(mergeRefs(...refs), refs);
}

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/** Visible, keyboard-reachable elements inside a container, in DOM order. */
export function getTabbable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => el.tabIndex >= 0 && !el.hasAttribute("disabled") && el.getClientRects().length > 0,
  );
}

/** Joins ARIA id lists, skipping empty ones. */
export function joinIds(...ids: (string | undefined | false)[]): string | undefined {
  const joined = ids.filter(Boolean).join(" ");
  return joined || undefined;
}
