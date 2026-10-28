import { FileText, Plus, X } from "lucide-react";
import { useAppStore } from "@/model/appStore";
import { useDocStore } from "@/model/docStore";
import { closeTab, switchTab, tabTitle, useTabsStore, type Tab } from "@/model/tabs";
import { openDocuments } from "@/model/workspace";
import { platform } from "@/platform";
import { IconButton, cn, toast } from "@/ui";
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
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && switchTab(tab.id)}
      onAuxClick={(e) => e.button === 1 && void closeTab(tab.id)}
      className={cn(
        "group flex h-8 min-w-0 max-w-56 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg pl-2.5 pr-1 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/50",
        active ? "bg-surface-3 font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      <FileText size={15} className={cn("shrink-0", active ? "text-brand-600 dark:text-brand-300" : "")} aria-hidden />
      <span className="truncate">{title}</span>
      <span className="relative grid size-6 shrink-0 place-items-center">
        {dirty && <span className="size-2 rounded-full bg-amber-500 group-hover:hidden" aria-label={t("Cambios sin guardar")} />}
        <button
          type="button"
          aria-label={t("Cerrar {title}", { title })}
          onClick={(e) => {
            e.stopPropagation();
            void closeTab(tab.id);
          }}
          className={cn(
            "absolute inset-0 grid place-items-center rounded-md text-muted hover:bg-line hover:text-fg",
            dirty ? "hidden group-hover:grid" : active ? "grid" : "hidden group-hover:grid",
          )}
        >
          <X size={14} />
        </button>
      </span>
    </div>
  );
}

/** Open documents as tabs; lives in the app header. */
export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const onHome = useAppStore((s) => s.view.name !== "editor" && s.view.name !== "organize");
  if (tabs.length === 0) return null;

  const open = async () => {
    try {
      const files = await platform.openFiles({ kinds: ["pdf"], multiple: true, title: t("Abrir PDF") });
      for (const f of files) await openDocuments([f]);
    } catch (err) {
      toast.error(t("No se pudo abrir"), { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div role="tablist" aria-label={t("Documentos abiertos")} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
      {tabs.map((t) => (
        <TabButton key={t.id} tab={t} active={t.id === activeId && !onHome} />
      ))}
      <IconButton size="sm" icon={Plus} label={t("Abrir otro PDF")} shortcut="Ctrl+O" onClick={() => void open()} className="shrink-0" />
    </div>
  );
}
