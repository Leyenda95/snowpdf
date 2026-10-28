import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CircleCheck, Download, FileText, Info, RotateCcw, SquarePen, TriangleAlert } from "lucide-react";
import { openDocuments } from "@/model/workspace";
import { platform } from "@/platform";
import { Button, toast } from "@/ui";
import type { ToolResult } from "./types";
import { formatSize, messageOf, uniqueOutputs } from "./utils";
import { t } from "@/i18n";

interface ResultViewProps {
  result: ToolResult;
  onRestart: () => void;
  onBack: () => void;
}

function useObjectUrls(result: ToolResult): (string | null)[] {
  const urls = useMemo(
    () =>
      result.outputs.map((out) =>
        out.kind === "pdf" ? null : URL.createObjectURL(new Blob([out.bytes as Uint8Array<ArrayBuffer>], { type: out.kind === "png" ? "image/png" : "image/jpeg" })),
      ),
    [result],
  );
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  return urls;
}

export function ResultView({ result, onRestart, onBack }: ResultViewProps) {
  const [saving, setSaving] = useState(false);
  const urls = useObjectUrls(result);
  const outputs = useMemo(() => uniqueOutputs(result.outputs), [result]);
  const hasOutputs = outputs.length > 0;
  const single = outputs.length === 1 ? outputs[0] : null;

  const save = async () => {
    setSaving(true);
    try {
      const where = single
        ? await platform.saveFile(single.bytes, { suggestedName: single.name, kind: single.kind })
        : await platform.saveFiles(
            outputs.map(({ name, bytes }) => ({ name, bytes })),
            { zipName: result.zipName },
          );
      if (where) toast.success(single ? t("Archivo guardado") : t("Archivos guardados"));
    } catch (err) {
      toast.error(t("No se pudo guardar"), { description: messageOf(err) });
    } finally {
      setSaving(false);
    }
  };

  const openInEditor = async () => {
    if (!single) return;
    try {
      await openDocuments([{ name: single.name, path: null, bytes: single.bytes }]);
    } catch (err) {
      toast.error(t("No se pudo abrir en el editor"), { description: messageOf(err) });
    }
  };

  const Icon = hasOutputs ? CircleCheck : Info;

  return (
    <main className="flex flex-1 flex-col items-center overflow-y-auto px-4 py-10">
      <div className="flex w-full max-w-xl flex-col items-center text-center">
        <span
          className={
            hasOutputs
              ? "grid size-16 place-items-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "grid size-16 place-items-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300"
          }
        >
          <Icon size={36} aria-hidden />
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-fg">{hasOutputs ? t("¡Listo!") : t("Nada que hacer")}</h1>
        <p className="mt-1.5 text-base text-muted" role="status">
          {result.summary}
        </p>

        {hasOutputs && (
          <ul className="mt-6 w-full divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface text-left shadow-sm">
            {outputs.map((out, i) => (
              <li key={out.name} className="flex items-center gap-3 px-3 py-2.5">
                {urls[i] ? (
                  <img src={urls[i]!} alt="" className="size-10 shrink-0 rounded border border-line bg-white object-cover" />
                ) : (
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-3 text-muted">
                    <FileText size={20} aria-hidden />
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-fg" title={out.name}>
                    {out.name}
                  </span>
                  {out.note && <span className="truncate text-xs text-muted">{out.note}</span>}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted">{formatSize(out.bytes.length)}</span>
              </li>
            ))}
          </ul>
        )}

        {result.warnings.length > 0 && (
          <div className="mt-4 flex w-full gap-2.5 rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-left text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />
            <ul className="flex flex-col gap-1">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          {hasOutputs && (
            <Button variant="primary" size="lg" icon={Download} loading={saving} onClick={save}>
              {single ? t("Guardar") : t("Guardar {n} archivos", { n: outputs.length })}
            </Button>
          )}
          {single?.kind === "pdf" && (
            <Button size="lg" icon={SquarePen} onClick={openInEditor}>
              {t("Abrir en el editor")}
            </Button>
          )}
          <Button size="lg" variant="ghost" icon={RotateCcw} onClick={onRestart}>
            {t("Empezar de nuevo")}
          </Button>
        </div>

        <button
          type="button"
          onClick={onBack}
          className="mt-6 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/50"
        >
          <ArrowLeft size={14} aria-hidden /> {t("Volver a herramientas")}
        </button>
      </div>
    </main>
  );
}
