import { Search, SearchX, X } from "lucide-react";
import { IconButton, ToolTile, cn } from "@/ui";
import { useHomeTools } from "./useHomeTools";
import { t } from "@/i18n";

/** Phone version of the tools column: searchable, grouped list inside the home page's scroll. */
export function HomeToolsInline({ className }: { className?: string }) {
  const { query, setQuery, results, groups, open } = useHomeTools();
  return (
    <section aria-label={t("Herramientas")} className={cn("mt-8", className)}>
      <h2 className="mb-3 text-base font-semibold text-fg">{t("Herramientas")}</h2>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (results[0]) void open(results[0]);
        }}
      >
        <div className="relative">
          <Search size={18} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-subtle" />
          <input
            type="search"
            aria-label={t("Buscar herramientas")}
            placeholder={t("Buscar herramientas")}
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 w-full appearance-none rounded-lg border border-line-strong bg-surface pl-11 pr-11 text-sm text-fg outline-none transition-shadow placeholder:text-subtle focus:ring-2 focus:ring-brand-500/40 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <div className="absolute inset-y-0 right-1 flex items-center">
              <IconButton icon={X} size="sm" label={t("Borrar búsqueda")} onClick={() => setQuery("")} />
            </div>
          )}
        </div>
      </form>
      {results.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted">
          <SearchX size={22} aria-hidden className="text-subtle" />
          {t("Ninguna herramienta coincide con «{query}».", { query: query.trim() })}
        </div>
      ) : (
        groups.map((group) => (
          <div key={group} className="mt-5">
            <h3 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-widest text-muted">{t(group)}</h3>
            <ul className="grid grid-cols-3 gap-2.5">
              {results
                .filter((entry) => entry.group === group)
                .map((entry) => (
                  <li key={entry.id} className="flex">
                    <ToolTile icon={entry.icon} iconClass={entry.iconClass} label={t(entry.label)} onClick={() => void open(entry)} />
                  </li>
                ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
