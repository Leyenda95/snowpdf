import { useState } from "react";
import { ChevronDown, FileText, Home, Plus, X } from "lucide-react";
import { useAppStore } from "@/model/appStore";
import { useDocStore } from "@/model/docStore";
import { closeTab, switchTab, tabTitle, useTabsStore, type Tab } from "@/model/tabs";
import { openDocuments } from "@/model/workspace";
import { platform } from "@/platform";
import { BottomSheet, IconButton, cn, toast, useIsMobile } from "@/ui";
import { t } from "@/i18n";

function TabButton({ tab, active }: { tab: Tab; active: boolean }) {
  // Re-render the active tab when its title/dirty flag change.
  useDocStore((s) => (active ? `${s.title}|${s.dirty}` : ""));
  const { title, dirty } = tabTitle(tab);
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      title={title}
      onClick={() => switchTab(tab.id)}
      onKeyDown={(e) => {
        // Not for keys pressed on the close button inside.
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        switchTab(tab.id);
      }}
      onAuxClick={(e) => e.button === 1 && void closeTab(tab.id)}
      className={cn(
        "group flex h-8 min-w-0 max-w-40 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg pl-2.5 pr-1 text-sm outline-none md:max-w-56 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/50",
        active ? "bg-surface-3 font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      <FileText size={15} className={cn("shrink-0", active ? "text-brand-600 dark:text-brand-300" : "")} aria-hidden />
      <span className="truncate">{title}</span>
      <span className="relative grid size-6 shrink-0 place-items-center">
        {dirty && <span className={cn("size-2 rounded-full bg-brand-500 group-hover:hidden", active && "pointer-coarse:hidden")} aria-label={t("Cambios sin guardar")} />}
        <button
          type="button"
          aria-label={t("Cerrar {title}", { title })}
          onClick={(e) => {
            e.stopPropagation();
            void closeTab(tab.id);
          }}
          className={cn(
            "absolute inset-0 grid place-items-center rounded-md text-muted hover:bg-line hover:text-fg",
            dirty ? "hidden group-hover:grid group-focus-within:grid" : active ? "grid" : "hidden group-hover:grid group-focus-within:grid pointer-coarse:grid",
            dirty && active && "pointer-coarse:grid",
          )}
        >
          <X size={14} />
        </button>
      </span>
    </div>
  );
}

async function openMore(): Promise<void> {
  try {
    const files = await platform.openFiles({ kinds: ["pdf"], multiple: true, title: t("Abrir PDF") });
    for (const f of files) await openDocuments([f]);
  } catch (err) {
    toast.error(t("No se pudo abrir"), { description: err instanceof Error ? err.message : String(err) });
  }
}

/** One row of the phone document list. */
function SwitcherRow({ tab, active, onPick }: { tab: Tab; active: boolean; onPick: () => void }) {
  useDocStore((s) => (active ? `${s.title}|${s.dirty}` : ""));
  const { title, dirty } = tabTitle(tab);
  return (
    <li className={cn("flex min-h-14 items-center rounded-xl pr-1", active ? "bg-surface-3 font-semibold text-fg" : "text-fg")}>
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={onPick}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
      >
        <FileText size={20} aria-hidden className={cn("shrink-0", active ? "" : "text-muted")} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate text-sm", active && "font-medium")}>{title}</span>
          {dirty && <span className="truncate text-xs text-subtle">{t("Cambios sin guardar")}</span>}
        </span>
      </button>
      <IconButton
        icon={X}
        label={t("Cerrar {title}", { title })}
        className="size-10 shrink-0"
        onClick={() => void closeTab(tab.id)}
      />
    </li>
  );
}

/** Phone replacement for the tab strip: one button that opens the list of documents. */
function DocSwitcher({ tabs, activeId, onHome }: { tabs: Tab[]; activeId: string | null; onHome: boolean }) {
  const [open, setOpen] = useState(false);
  const activeTab = onHome ? undefined : tabs.find((tab) => tab.id === activeId);
  useDocStore((s) => (activeTab ? `${s.title}|${s.dirty}` : ""));
  const info = activeTab ? tabTitle(activeTab) : null;

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex h-10 min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-surface-2 pl-3 pr-2 text-sm text-fg outline-none transition-colors hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-brand-500/50"
      >
        <span className="min-w-0 flex-1 truncate text-left font-medium">{info ? info.title : t("Documentos abiertos")}</span>
        {info?.dirty && <span className="size-2 shrink-0 rounded-full bg-brand-500" aria-label={t("Cambios sin guardar")} />}
        {tabs.length > 1 && (
          <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-surface-3 px-1.5 text-xs font-medium text-muted">{tabs.length}</span>
        )}
        <ChevronDown size={16} aria-hidden className="shrink-0 text-subtle" />
      </button>
      <BottomSheet open={open && tabs.length > 0} onClose={() => setOpen(false)} title={t("Documentos abiertos")}>
        <ul className="flex flex-col gap-0.5">
          <li className="mb-1 border-b border-line pb-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                useAppStore.getState().navigate({ name: "home" });
              }}
              className="flex min-h-14 w-full items-center gap-3 rounded-xl pl-3 text-left text-sm text-fg outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/50"
            >
              <Home size={20} aria-hidden className="shrink-0 text-muted" />
              {t("Inicio")}
            </button>
          </li>
          {tabs.map((tab) => (
            <SwitcherRow
              key={tab.id}
              tab={tab}
              active={tab.id === activeId && !onHome}
              onPick={() => {
                setOpen(false);
                switchTab(tab.id);
              }}
            />
          ))}
          <li>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void openMore();
              }}
              className="flex min-h-14 w-full items-center gap-3 rounded-xl pl-3 text-left text-sm text-fg outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/50"
            >
              <Plus size={20} aria-hidden className="shrink-0 text-muted" />
              {t("Abrir otro PDF")}
            </button>
          </li>
        </ul>
      </BottomSheet>
    </>
  );
}

/** Open documents as tabs; lives in the app header. */
export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const onHome = useAppStore((s) => s.view.name !== "editor" && s.view.name !== "organize");
  const mobile = useIsMobile();
  if (tabs.length === 0) return null;
  if (mobile) return <DocSwitcher tabs={tabs} activeId={activeId} onHome={onHome} />;

  const open = openMore;

  return (
    <div role="tablist" aria-label={t("Documentos abiertos")} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
      {tabs.map((t) => (
        <TabButton key={t.id} tab={t} active={t.id === activeId && !onHome} />
      ))}
      <IconButton size="sm" icon={Plus} label={t("Abrir otro PDF")} shortcut="Ctrl+O" onClick={() => void open()} className="shrink-0" />
    </div>
  );
}
