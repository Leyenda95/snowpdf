import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line-strong border-b-2 bg-surface-2 px-1.5 font-sans text-[11px] font-medium leading-none text-muted">
      {children}
    </kbd>
  );
}
