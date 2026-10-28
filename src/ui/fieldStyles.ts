/** Class strings shared by the form controls (kept as full literals so Tailwind can see them). */

export const LABEL_CLASS = "text-xs font-medium text-muted";

const CONTROL_BASE =
  "w-full rounded-lg border bg-surface text-sm text-fg outline-none transition-colors placeholder:text-subtle disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60";

const CONTROL_NORMAL = "border-line-strong hover:border-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";

const CONTROL_ERROR = "border-red-500 hover:border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-500/30";

/** Border/background/focus styling for text-like controls. */
export function controlClass(invalid?: boolean): string {
  return `${CONTROL_BASE} ${invalid ? CONTROL_ERROR : CONTROL_NORMAL}`;
}
