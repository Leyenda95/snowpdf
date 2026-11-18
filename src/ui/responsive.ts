import { useSyncExternalStore } from "react";

/*
 * Phone layout switch: narrow screens, plus touch screens held in landscape (a phone on its
 * side is wider than 768 px but too short for the desktop layout). Desktop windows never match
 * (the Tauri window has a 960 px minimum width and a fine pointer), so everything gated on it
 * only changes phones and narrow browsers. It mirrors the `md` / `max-md` variants redefined in
 * src/styles.css: use `md:` classes for the desktop variant and unprefixed ones for the phone.
 */
export const MOBILE_QUERY = "(max-width: 767.98px), (pointer: coarse) and (max-height: 479.98px)";

/** Whether a media query matches; re-renders when that changes. False where there is no window. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function isMobileLayout(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;
}

/** True while the viewport is phone-sized; re-renders when it crosses the breakpoint. */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}
