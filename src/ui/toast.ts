import { create } from "zustand";

export type ToastKind = "success" | "error" | "info" | "warning" | "loading";

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  description?: string;
  /** Milliseconds until it closes by itself; null keeps it until dismissed or updated. */
  duration: number | null;
  /** Bumped by every update so the auto-dismiss timer restarts. */
  revision: number;
}

export interface ToastOptions {
  description?: string;
  /** Milliseconds. 0 or Infinity keep the toast until it is dismissed. */
  duration?: number;
}

export interface ToastPatch {
  kind?: ToastKind;
  message?: string;
  description?: string;
  duration?: number;
}

interface ToastState {
  toasts: ToastItem[];
}

export const useToastStore = create<ToastState>(() => ({ toasts: [] }));

const DEFAULT_DURATION: Record<ToastKind, number | null> = {
  success: 4000,
  info: 4000,
  warning: 4000,
  error: 7000,
  loading: null,
};

const MAX_VISIBLE = 5;

function resolveDuration(kind: ToastKind, duration: number | undefined): number | null {
  if (duration === undefined) return DEFAULT_DURATION[kind];
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

let counter = 0;

function push(kind: ToastKind, message: string, opts?: ToastOptions): string {
  const id = `toast-${++counter}`;
  const item: ToastItem = {
    id,
    kind,
    message,
    description: opts?.description,
    duration: resolveDuration(kind, opts?.duration),
    revision: 0,
  };
  useToastStore.setState((state) => {
    const toasts = [...state.toasts, item];
    // Over the limit: drop the oldest finished toast first, never a running "loading" one if avoidable.
    while (toasts.length > MAX_VISIBLE) {
      const index = toasts.findIndex((t) => t.kind !== "loading");
      toasts.splice(index === -1 ? 0 : index, 1);
    }
    return { toasts };
  });
  return id;
}

export const toast = {
  success: (message: string, opts?: ToastOptions): string => push("success", message, opts),
  error: (message: string, opts?: ToastOptions): string => push("error", message, opts),
  info: (message: string, opts?: ToastOptions): string => push("info", message, opts),
  warning: (message: string, opts?: ToastOptions): string => push("warning", message, opts),
  /** Persistent until dismissed or updated (e.g. to success/error when the work finishes). */
  loading: (message: string, opts?: ToastOptions): string => push("loading", message, opts),

  update(id: string, patch: ToastPatch): void {
    useToastStore.setState((state) => ({
      toasts: state.toasts.map((t) => {
        if (t.id !== id) return t;
        const kind = patch.kind ?? t.kind;
        return {
          ...t,
          kind,
          message: patch.message ?? t.message,
          description: "description" in patch ? patch.description : t.description,
          // A new kind brings its own default lifetime unless one is given explicitly.
          duration:
            patch.duration !== undefined
              ? resolveDuration(kind, patch.duration)
              : patch.kind !== undefined
                ? DEFAULT_DURATION[kind]
                : t.duration,
          revision: t.revision + 1,
        };
      }),
    }));
  },

  dismiss(id: string): void {
    useToastStore.setState((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
};
