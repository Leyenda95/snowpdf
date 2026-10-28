import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, PanelLeftClose, Search, SearchX, X } from "lucide-react";
import { useDocStore } from "@/model/docStore";
import { TOOL_MODULES } from "@/features/tools/options";
import { Button, IconButton, TextField, cn } from "@/ui";
import { useEditorStore } from "../editorStore";
import { DOC_TOOLS, GROUP_ICON_CLASSES, GROUP_LABELS, matchesQuery, type DocToolEntry, type DocToolGroup, type ModuleEntry } from "./catalog";
import { previewFile, runDocTool } from "./runDocTool";
import { t } from "@/i18n";

/** Acrobat-like "Herramientas" pane docked on the left of the editor. */

const GROUP_ORDER: DocToolGroup[] = ["paginas", "proteger", "optimizar", "convertir", "marcas"];

function closePanel(): void {
  useEditorStore.getState().setToolsPanel(false);
}

/** Up/Down/Home/End move the focus between the items of a list. */
export function onListKeyDown(e: KeyboardEvent<HTMLElement>): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-tool-item]"));
  if (items.length === 0) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
  items[next].focus();
}

function ToolItem({ entry, onOpen }: { entry: DocToolEntry; onOpen: (entry: DocToolEntry) => void }) {
  const Icon = entry.icon;
  return (
    <button
      type="button"
      data-tool-item
      onClick={() => onOpen(entry)}
      className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-fg outline-none transition-colors hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      <Icon size={16} aria-hidden className={cn("shrink-0", GROUP_ICON_CLASSES[entry.group])} />
      <span className="min-w-0 flex-1 truncate">{t(entry.label)}</span>
    </button>
  );
}

function ToolList({ query, setQuery, onOpen }: { query: string; setQuery: (q: string) => void; onOpen: (entry: DocToolEntry) => void }) {
  const results = useMemo(() => DOC_TOOLS.filter((t) => matchesQuery(t, query)), [query]);
  const listRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div className="shrink-0 px-3 pb-2">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (results[0]) onOpen(results[0]);
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
          GROUP_ORDER.map((group) => {
            const items = results.filter((t) => t.group === group);
            if (items.length === 0) return null;
            return (
              <section key={group} aria-labelledby={`tools-group-${group}`} className="pt-2 first:pt-0">
                <h3 id={`tools-group-${group}`} className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
                  {t(GROUP_LABELS[group])}
                </h3>
                <ul className="flex flex-col">
                  {items.map((t) => (
                    <li key={t.id}>
                      <ToolItem entry={t} onOpen={onOpen} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </>
  );
}

/** Options of one batch tool, applied to the open document. */
function ToolOptionsView({ entry, onBack }: { entry: ModuleEntry; onBack: () => void }) {
  const mod = TOOL_MODULES[entry.toolId];
  const [options, setOptions] = useState<unknown>(() => mod.defaultOptions());
  const [running, setRunning] = useState(false);
  // Page count/size follow the live document (pages can be added or removed meanwhile).
  const pages = useDocStore((s) => s.doc.pages);
  const file = useMemo(() => previewFile(), [pages]);
  const files = useMemo(() => (file ? [file] : []), [file]);
  const onChange = useCallback((next: unknown) => setOptions(next), []);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingRef.current?.focus(), []);

  const problem = !file ? t("El documento no tiene páginas.") : (mod.validate?.(files, options) ?? null);

  const run = async () => {
    if (problem) return;
    if (entry.applyInModel) {
      if (entry.applyInModel(options)) onBack();
      return;
    }
    setRunning(true);
    try {
      const done = await runDocTool(mod, options, entry.mode);
      if (done && entry.mode === "replace") onBack();
    } finally {
      setRunning(false);
    }
  };

  const Icon = entry.icon;
  const Options = mod.Options;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => {
        const t = e.target as HTMLElement;
        if (e.key === "Escape" && !t.closest("input,textarea,select,[role=listbox]")) {
          e.preventDefault();
          onBack();
        }
      }}
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2 pb-2">
        <IconButton icon={ArrowLeft} size="sm" label={t("Volver a herramientas")} onClick={onBack} />
        <Icon size={16} aria-hidden className={cn("shrink-0", GROUP_ICON_CLASSES[entry.group])} />
        <h3 ref={headingRef} tabIndex={-1} className="min-w-0 flex-1 truncate text-sm font-semibold text-fg outline-none">
          {t(entry.label)}
        </h3>
      </div>
      <div inert={running} className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4", running && "opacity-60")}>
        <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-xs leading-snug text-muted">{t(entry.description)}</p>
        <Options files={files} options={options} onChange={onChange} disabled={running} />
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t border-line p-3">
        {problem && !running && <p className="text-xs leading-snug text-muted">{problem}</p>}
        <Button variant="primary" fullWidth icon={Icon} loading={running} disabled={Boolean(problem)} onClick={() => void run()}>
          {t(entry.actionLabel ?? mod.actionLabel)}
        </Button>
      </div>
    </div>
  );
}

export function ToolsPanel() {
  const open = useEditorStore((s) => s.toolsPanel);
  const [active, setActive] = useState<ModuleEntry | null>(null);
  const [query, setQuery] = useState("");
  const asideRef = useRef<HTMLElement>(null);

  const onOpen = useCallback((entry: DocToolEntry) => {
    if (entry.kind === "module") setActive(entry);
    else void entry.run();
  }, []);

  // A tool picked on the home page: show its options (or run it) once the document is open.
  const toolRequest = useEditorStore((s) => s.toolRequest);
  useEffect(() => {
    if (!toolRequest) return;
    useEditorStore.getState().requestDocTool(null);
    const entry = DOC_TOOLS.find((t) => t.id === toolRequest);
    if (entry) onOpen(entry);
  }, [toolRequest, onOpen]);

  const back = useCallback(() => {
    setActive(null);
    // Return the focus to the list so keyboard users keep their place.
    requestAnimationFrame(() => asideRef.current?.querySelector<HTMLInputElement>("input")?.focus());
  }, []);

  // Opening the pane from the toolbar puts the focus in its search box (not when restored at start-up).
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) asideRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    wasOpen.current = open;
  }, [open]);

  if (!open) return null;

  return (
    <aside ref={asideRef} aria-label={t("Herramientas")} className="flex w-[288px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-11 shrink-0 items-center justify-between pl-4 pr-2">
        <h2 className="text-sm font-semibold text-fg">{t("Herramientas")}</h2>
        <IconButton icon={PanelLeftClose} size="sm" label={t("Cerrar herramientas")} onClick={closePanel} />
      </div>
      {active ? <ToolOptionsView key={active.id} entry={active} onBack={back} /> : <ToolList query={query} setQuery={setQuery} onOpen={onOpen} />}
    </aside>
  );
}
