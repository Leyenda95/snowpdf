import { useEffect, useMemo, useRef, useState } from "react";
import { EyeOff, Highlighter, Search, X } from "lucide-react";
import { useDocStore } from "@/model/docStore";
import { addObjects } from "@/model/docActions";
import { newId } from "@/model/registry";
import { displayRotation, type EditorObject, type PageRef } from "@/model/types";
import { getThumbnail } from "@/render/thumbnails";
import { REDACT_PATTERNS, getTextRuns, searchRuns, searchRunsPattern, type TextMatch } from "@/render/textContent";
import { Button, IconButton, Spinner, TextField, toast } from "@/ui";
import { useEditorStore } from "./editorStore";
import { baseSize } from "./viewer/geometry";
import { t } from "@/i18n";

// ------------------------------------------------------------------ thumbnails

export function PageThumb({ page, width, className }: { page: PageRef; width: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const size = baseSize(page);
  const height = (width * size.height) / size.width;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !page.sourceId) return;
    let alive = true;
    getThumbnail(page.sourceId, page.sourceIndex)
      .then((u) => alive && setUrl(u))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [visible, page.sourceId, page.sourceIndex]);

  // The bitmap already includes the page's own /Rotate; only the user's extra rotation is CSS.
  const extra = page.rotation;
  const swapped = extra % 180 !== 0;
  return (
    <div ref={ref} className={`relative overflow-hidden bg-white ${className ?? ""}`} style={{ width, height }}>
      {url && (
        <img
          src={url}
          alt=""
          draggable={false}
          className="absolute left-1/2 top-1/2 max-w-none select-none"
          style={{
            width: swapped ? height : width,
            height: swapped ? width : height,
            transform: `translate(-50%, -50%) rotate(${extra}deg)`,
          }}
        />
      )}
    </div>
  );
}

export function ThumbnailList() {
  const pages = useDocStore((s) => s.doc.pages);
  const current = useEditorStore((s) => s.currentPage);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelector(`[data-thumb="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <div ref={listRef} className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto px-3 py-3">
      {pages.map((p, i) => (
        <button
          key={p.id}
          data-thumb={i}
          type="button"
          onClick={() => useEditorStore.getState().goToPage(i)}
          className="group flex flex-col items-center gap-1.5 rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
        >
          <PageThumb
            page={p}
            width={displayRotation(p) % 180 === 0 ? 132 : 150}
            className={`rounded-sm shadow-sm ring-2 transition ${i === current ? "ring-brand-500" : "ring-transparent group-hover:ring-line-strong"}`}
          />
          <span className={`text-xs ${i === current ? "font-semibold text-brand-600 dark:text-brand-300" : "text-muted"}`}>{i + 1}</span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ search

interface PageResults {
  pageIndex: number;
  page: PageRef;
  matches: TextMatch[];
}

async function runSearch(pages: PageRef[], q: string | RegExp): Promise<PageResults[]> {
  const out: PageResults[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (!p.sourceId) continue;
    const runs = await getTextRuns(p.sourceId, p.sourceIndex);
    const matches = typeof q === "string" ? searchRuns(runs, q) : searchRunsPattern(runs, q);
    if (matches.length) out.push({ pageIndex: i, page: p, matches });
  }
  return out;
}

function SearchPanel() {
  const pages = useDocStore((s) => s.doc.pages);
  const [query, setQuery] = useState("");
  const [pattern, setPattern] = useState<string | null>(null);
  const [results, setResults] = useState<PageResults[] | null>(null);
  const [busy, setBusy] = useState(false);
  const total = useMemo(() => results?.reduce((n, r) => n + r.matches.length, 0) ?? 0, [results]);

  const search = async (q: string | RegExp) => {
    setBusy(true);
    try {
      setResults(await runSearch(pages, q));
    } catch (err) {
      toast.error(t("Error al buscar"), { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const show = (r: PageResults, m: TextMatch) => {
    const ed = useEditorStore.getState();
    ed.goToPage(r.pageIndex);
    ed.setFlash({ pageId: r.page.id, frames: m.frames, at: Date.now() });
  };

  const markAll = (kind: "redact" | "highlight") => {
    if (!results) return;
    const styles = useEditorStore.getState().styles;
    const objs: EditorObject[] = [];
    for (const r of results)
      for (const m of r.matches)
        for (const f of m.frames) {
          const frame = { ...f, w: f.w + 2, h: f.h + 1 };
          objs.push(
            kind === "redact"
              ? { id: newId("obj"), pageId: r.page.id, kind: "redact", frame, opacity: 1, color: styles.redact.color }
              : { id: newId("obj"), pageId: r.page.id, kind: "highlight", frame, opacity: styles.highlight.opacity, color: styles.highlight.color },
          );
        }
    addObjects(objs);
    toast.success(kind === "redact" ? t("{n} zonas marcadas para redactar", { n: objs.length }) : t("{n} coincidencias resaltadas", { n: objs.length }), {
      description: kind === "redact" ? t("Se eliminarán de verdad al guardar.") : undefined,
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPattern(null);
          if (query.trim()) void search(query);
        }}
      >
        <TextField icon={Search} placeholder={t("Buscar en el documento…")} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      </form>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">{t("Buscar datos sensibles")}</p>
        <div className="flex flex-wrap gap-1.5">
          {REDACT_PATTERNS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setPattern(p.label);
                void search(p.regex);
              }}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${pattern === p.label ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200" : "border-line text-muted hover:border-line-strong hover:text-fg"}`}
            >
              {t(p.label)}
            </button>
          ))}
        </div>
      </div>
      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> {t("Buscando…")}
        </div>
      )}
      {results && !busy && (
        <>
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{total === 0
                ? t("Sin resultados")
                : t(total === 1 ? "{n} resultado" : "{n} resultados", { n: total }) +
                  " " +
                  t(results.length === 1 ? "en {n} página" : "en {n} páginas", { n: results.length })}</span>
          </div>
          {total > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="danger" icon={EyeOff} onClick={() => markAll("redact")}>
                {t("Redactar todo")}
              </Button>
              <Button size="sm" icon={Highlighter} onClick={() => markAll("highlight")}>
                {t("Resaltar todo")}
              </Button>
            </div>
          )}
          <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1">
            {results.map((r) => (
              <div key={r.page.id}>
                <p className="mb-1 text-xs font-semibold text-muted">{t("Página")} {r.pageIndex + 1}</p>
                <div className="space-y-1">
                  {r.matches.map((m, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => show(r, m)}
                      className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs text-fg hover:bg-surface-3"
                    >
                      {m.snippet}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function Sidebar() {
  const panel = useEditorStore((s) => s.sidebar);
  if (!panel) return null;
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line pr-1.5 pl-3">
        <h2 className="text-sm font-medium text-fg">{t("Buscar")}</h2>
        <IconButton size="sm" icon={X} label={t("Cerrar búsqueda")} onClick={() => useEditorStore.getState().setSidebar(null)} />
      </div>
      <SearchPanel />
    </aside>
  );
}
