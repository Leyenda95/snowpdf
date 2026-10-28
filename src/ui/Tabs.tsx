import { useRef, type KeyboardEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "./cn";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Small counter or label after the title. Strings and numbers get a pill style. */
  badge?: ReactNode;
}

export interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  tabs: TabItem<T>[];
  className?: string;
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: TabsProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((t) => t.value === value);
    let next = -1;
    if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].value);
    buttons.current[next]?.focus();
  };

  return (
    <div role="tablist" onKeyDown={handleKeyDown} className={cn("flex gap-1 border-b border-line", className)}>
      {tabs.map((tab, index) => {
        const selected = tab.value === value;
        const Icon = tab.icon;
        const pill = typeof tab.badge === "string" || typeof tab.badge === "number";
        return (
          <button
            key={tab.value}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={cn(
              "relative -mb-px inline-flex h-10 select-none items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium outline-none transition-colors",
              "focus-visible:rounded-t-lg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50",
              selected
                ? "border-brand-600 text-fg dark:border-brand-400"
                : "border-transparent text-muted hover:border-line-strong hover:text-fg",
            )}
          >
            {Icon && <Icon size={16} aria-hidden />}
            {tab.label}
            {tab.badge !== undefined &&
              tab.badge !== null &&
              (pill ? (
                <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[11px] font-medium leading-none tabular-nums text-muted">
                  {tab.badge}
                </span>
              ) : (
                tab.badge
              ))}
          </button>
        );
      })}
    </div>
  );
}
