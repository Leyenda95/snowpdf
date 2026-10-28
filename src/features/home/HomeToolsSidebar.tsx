import { useMemo, useRef, useState } from "react";
import { Search, SearchX, X } from "lucide-react";
import { onListKeyDown } from "@/features/editor/tools/ToolsPanel";
import { IconButton, TextField, cn } from "@/ui";
import { HOME_TOOLS, matchesHomeQuery, type HomeToolEntry } from "./homeTools";
import { t } from "@/i18n";

/** Left column of the home page, styled like the editor's "Herramientas" pane. */
export function HomeToolsSidebar() {
  const [query, setQuery] = useState("");
  const results = useMemo(() => HOME_TOOLS.filter((entry) => matchesHomeQuery(entry, query)), [query]);
  const groups = useMemo(() => [...new Set(results.map((entry) => entry.group))], [results]);
  const listRef = useRef<HTMLDivElement>(null);
  // Ignore clicks while a tool is still opening (file picker, loading the PDF).
  const busy = useRef(false);

  const open = async (entry: HomeToolEntry) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await entry.run();
    } finally {
      busy.current = false;
    }
  };

  return (
    <aside aria-label={t("Herramientas")} className="hidden w-[272px] shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="flex h-11 shrink-0 items-center px-4">
        <h2 className="text-sm font-semibold text-fg">{t("Herramientas")}</h2>
      </div>
      <div className="shrink-0 px-3 pb-2">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (results[0]) void open(results[0]);
          }}
        >
          <TextField
            icon={Search}
            aria-label={t("Buscar herramientas")}
            placeholder={t("Buscar herramientas")}
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                listRef.current?.querySelector<HTMLButtonElement>("[data-tool-item]")?.focus();
              } else if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
            trailing={query ? <IconButton icon={X} size="sm" label={t("Borrar búsqueda")} onClick={() => setQuery("")} /> : undefined}
          />
        </form>
      </div>
      <div ref={listRef} onKeyDown={onListKeyDown} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {results.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-[13px] text-muted">
            <SearchX size={22} aria-hidden className="text-subtle" />
            {t("Ninguna herramienta coincide con «{query}».", { query: query.trim() })}
          </div>
        ) : (
          groups.map((group) => (
            <section key={group} aria-label={t(group)} className="pt-2 first:pt-0">
              <h3 className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">{t(group)}</h3>
              <ul className="flex flex-col">
                {results
                  .filter((entry) => entry.group === group)
                  .map((entry) => {
                    const Icon = entry.icon;
                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          data-tool-item
                          onClick={() => void open(entry)}
                          className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-fg outline-none transition-colors hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-brand-500/50"
                        >
                          <Icon size={16} aria-hidden className={cn("shrink-0", entry.iconClass)} />
                          <span className="min-w-0 flex-1 truncate">{t(entry.label)}</span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
