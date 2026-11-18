import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, FileUp, FolderOpen } from "lucide-react";
import { useAppStore } from "@/model/appStore";
import { EXTENSIONS, filesToPicked, kindOfName, platform, type PickedFile } from "@/platform";
import { AppHeader } from "@/features/shell/AppHeader";
import { BrandMark, Button, Dropzone, ProgressBar, Spinner, cn, toast, useIsMobile, useWindowFileDrop } from "@/ui";
import { FileList } from "./FileList";
import { loadToolFile, releaseFile } from "./inputs";
import { getTool, type BatchToolDef, type BatchToolId, type ToolColor } from "./registry";
import { ResultView } from "./ResultView";
import { TOOL_MODULES } from "./options";
import type { ToolFile, ToolResult } from "./types";
import { messageOf, pluralize } from "./utils";
import { t } from "@/i18n";

/** Static map: Tailwind only generates classes it can read literally from the source. */
const TILE_CLASSES: Record<ToolColor, string> = {
  orange: "bg-surface-3 text-fg",
  emerald: "bg-surface-3 text-fg",
  amber: "bg-surface-3 text-fg",
  violet: "bg-surface-3 text-fg",
  sky: "bg-surface-3 text-fg",
};

type Phase = "files" | "processing" | "done";

function goHome(): void {
  useAppStore.getState().navigate({ name: "home" });
}

function BackLink({ label = t("Herramientas") }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={goHome}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted outline-none transition-colors hover:bg-surface-3 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      <ArrowLeft size={14} aria-hidden /> {label}
    </button>
  );
}

/** Batch tool page: pick files, tweak options, process, save. */
export function ToolPage({ toolId }: { toolId: BatchToolId }) {
  const tool = getTool(toolId) as BatchToolDef;
  const mod = TOOL_MODULES[toolId];
  const mobile = useIsMobile();
  const extensions = tool.accepts.flatMap((kind) => EXTENSIONS[kind]);

  const [files, setFiles] = useState<ToolFile[]>([]);
  const [options, setOptions] = useState<unknown>(() => mod.defaultOptions());
  const [phase, setPhase] = useState<Phase>("files");
  const [adding, setAdding] = useState(false);
  const [progress, setProgress] = useState<{ value?: number; label: string }>({ label: "" });
  const [result, setResult] = useState<ToolResult | null>(null);

  // Latest files for cleanup and async callbacks.
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => filesRef.current.forEach(releaseFile), []);

  const addFiles = async (picked: PickedFile[]) => {
    if (phase !== "files" || adding) return;
    const usable = picked.filter((p) => {
      const kind = kindOfName(p.name);
      return kind !== null && tool.accepts.includes(kind);
    });
    if (usable.length === 0) {
      if (picked.length > 0) toast.error(t("Tipo de archivo no admitido"));
      return;
    }
    setAdding(true);
    try {
      const loaded: ToolFile[] = [];
      for (const p of tool.multiple ? usable : usable.slice(0, 1)) {
        try {
          const file = await loadToolFile(p);
          if (file) loaded.push(file);
          else toast.info(t("«{name}» no se ha añadido", { name: p.name }), { description: t("No se introdujo la contraseña.") });
        } catch (err) {
          toast.error(t("No se pudo abrir «{name}»", { name: p.name }), { description: messageOf(err) });
        }
      }
      if (loaded.length === 0) return;
      if (tool.multiple) setFiles((prev) => [...prev, ...loaded]);
      else {
        filesRef.current.forEach(releaseFile);
        setFiles(loaded);
      }
    } finally {
      setAdding(false);
    }
  };

  const browse = async () => {
    try {
      const picked = await platform.openFiles({ kinds: tool.accepts, multiple: tool.multiple, title: t(tool.title) });
      if (picked.length > 0) await addFiles(picked);
    } catch (err) {
      toast.error(t("No se pudieron abrir los archivos"), { description: messageOf(err) });
    }
  };

  useWindowFileDrop((dropped) => {
    void filesToPicked(dropped).then(addFiles);
  }, extensions);

  const removeFile = (id: string) => {
    const file = files.find((f) => f.id === id);
    if (file) releaseFile(file);
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const restart = () => {
    filesRef.current.forEach(releaseFile);
    setFiles([]);
    setOptions(mod.defaultOptions());
    setResult(null);
    setPhase("files");
  };

  const run = async () => {
    setPhase("processing");
    setProgress({ label: t("Preparando…") });
    try {
      const res = await mod.run(files, options, {
        onProgress: (value, label) => setProgress((p) => ({ value, label: label ?? p.label })),
      });
      setResult(res);
      setPhase("done");
    } catch (err) {
      toast.error(t("No se pudo completar la operación"), { description: messageOf(err) });
      setPhase("files");
    }
  };

  const onOptionsChange = useCallback((next: unknown) => setOptions(next), []);

  // ------------------------------------------------------------------ views

  if (phase === "done" && result) {
    return (
      <>
        <AppHeader />
        <ResultView result={result} onRestart={restart} onBack={goHome} />
      </>
    );
  }

  const Icon = tool.icon;

  if (files.length === 0) {
    return (
      <>
        <AppHeader />
        <main className="flex flex-1 flex-col overflow-y-auto max-md:bg-app">
          <div className="px-3 pt-3">
            <BackLink />
          </div>
          <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 pb-16 pt-4 text-center">
            <span className={cn("grid size-16 place-items-center rounded-2xl", TILE_CLASSES[tool.color])}>
              <Icon size={32} aria-hidden />
            </span>
            <h1 className="mt-5 text-3xl font-bold tracking-tight text-fg max-md:text-2xl">{t(tool.title)}</h1>
            <p className="mt-2 max-w-md text-pretty text-base text-muted">{t(tool.description)}</p>

            {mobile ? (
              <div className="mt-10 flex w-full flex-col items-center gap-3">
                <button
                  type="button"
                  disabled={adding}
                  onClick={() => void browse()}
                  className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-primary text-base font-semibold text-on-primary outline-none transition-colors active:bg-primary-hover focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-60"
                >
                  {adding ? <Spinner size={22} /> : <FolderOpen size={22} aria-hidden />}
                  {t("Elegir archivos")}
                </button>
              </div>
            ) : (
            <Dropzone accept={extensions} multiple={tool.multiple} onFiles={(f) => void filesToPicked(f).then(addFiles)} onBrowse={browse} className="mt-8 min-h-64 w-full gap-5">
              <span className="grid size-14 place-items-center rounded-2xl bg-surface-3 text-fg">
                {adding ? <Spinner size={26} /> : <FileUp size={28} aria-hidden />}
              </span>
              <Button
                variant="primary"
                size="lg"
                loading={adding}
                onClick={(e) => {
                  e.stopPropagation();
                  void browse();
                }}
              >
                {t("Elegir archivos")}
              </Button>
              <span className="text-sm text-muted">
                {tool.accepts.includes("image") && tool.accepts.includes("pdf")
                  ? t(tool.multiple ? "o arrastra aquí tus PDF e imágenes" : "o arrastra aquí tu PDF o imagen")
                  : tool.accepts.includes("image")
                    ? t(tool.multiple ? "o arrastra aquí tus imágenes" : "o arrastra aquí tu imagen")
                    : t(tool.multiple ? "o arrastra aquí tus PDF" : "o arrastra aquí tu PDF")}
              </span>
            </Dropzone>
            )}

            <p className="mt-6 inline-flex items-center gap-2 text-balance text-sm text-muted max-md:text-center max-md:text-xs">
              <BrandMark className="size-4 shrink-0 text-brand-500" />
              {t("Todo se procesa en tu equipo. Nada se sube a internet.")}
            </p>
          </div>
        </main>
      </>
    );
  }

  const busy = phase === "processing";
  const minFiles = mod.minFiles ?? 1;
  let problem: string | null = null;
  if (files.length < minFiles) problem = t(minFiles === 1 ? "Añade al menos {n} archivo." : "Añade al menos {n} archivos.", { n: minFiles });
  else if (toolId !== "repair" && files.some((f) => f.unreadable)) problem = t("Hay archivos que no se pueden leer. Quítalos o prueba antes con «Reparar PDF».");
  else problem = mod.validate?.(files, options) ?? null;

  const Options = mod.Options;
  const size = mod.cardSize ?? (tool.multiple ? "md" : "lg");

  return (
    <>
      <AppHeader />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2 max-md:border-b-0">
            <BackLink />
            <span className="shrink-0 text-sm font-semibold text-fg">{t(tool.title)}</span>
            <span className="min-w-0 truncate text-sm text-muted">· {tool.multiple ? pluralize(files.length, t("archivo"), t("archivos")) : files[0].name}</span>
          </div>
          <div inert={busy} className={cn("min-h-0 flex-1 overflow-y-auto bg-app p-3 md:p-5", busy && "opacity-60")}>
            <FileList
              files={files}
              size={size}
              sortable={Boolean(mod.sortable) && files.length > 1}
              multiple={tool.multiple}
              adding={adding}
              disabled={busy}
              extrasFor={mod.cardExtras ? (file) => mod.cardExtras!(file, options) : undefined}
              onAdd={() => void browse()}
              onRemove={removeFile}
              onReorder={setFiles}
            />
          </div>
          {busy && (
            <div className="absolute inset-0 z-20 grid place-items-center bg-app/50 p-6 backdrop-blur-[1px]">
              <div className="flex w-full max-w-sm flex-col gap-3 rounded-xl bg-surface p-5 shadow-pop" role="status" aria-live="polite">
                <div className="flex items-center gap-2.5 text-sm font-medium text-fg">
                  <Spinner size={18} /> {t("Procesando…")}
                </div>
                <ProgressBar value={progress.value} label={progress.label} />
              </div>
            </div>
          )}
        </main>

        <aside className="flex max-h-[55%] w-full shrink-0 flex-col border-t border-line bg-surface max-md:rounded-t-3xl max-md:border-t-0 max-md:shadow-pop md:max-h-none md:w-80 md:border-l md:border-t-0">
          <div className="shrink-0 border-b border-line px-5 py-3.5 max-md:border-b-0 max-md:pb-1">
            <h2 className="text-sm font-semibold text-fg max-md:text-base">{t("Opciones")}</h2>
          </div>
          <div inert={busy} className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-5", busy && "opacity-60")}>
            <Options files={files} options={options} onChange={onOptionsChange} disabled={busy} />
          </div>
          <div className="flex shrink-0 flex-col gap-2 border-t border-line p-4 max-md:border-t-0 max-md:pb-[max(1rem,env(safe-area-inset-bottom))]">
            {problem && !busy && <p className="text-xs leading-snug text-muted">{problem}</p>}
            <Button variant="primary" size="lg" fullWidth className="max-md:h-14! max-md:rounded-2xl! max-md:font-semibold" icon={Icon} loading={busy} disabled={Boolean(problem) || adding} onClick={() => void run()}>
              {busy ? t("Procesando…") : t(mod.actionLabel)}
            </Button>
          </div>
        </aside>
      </div>
    </>
  );
}
