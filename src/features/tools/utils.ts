import { intlLocale, t } from "@/i18n";
import type { RunContext, ToolFile, ToolOutput } from "./types";

/** 4404019 -> "4,2 MB" */
export function formatSize(bytes: number): string {
  const sizeFormat = new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${sizeFormat.format(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${sizeFormat.format(bytes / (1024 * 1024))} MB`;
  return `${sizeFormat.format(bytes / (1024 * 1024 * 1024))} GB`;
}

/** "Informe final.pdf" -> "Informe final" */
export function baseOf(name: string): string {
  const stripped = name.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim();
  return stripped === "" ? t("documento") : stripped;
}

export function pluralize(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Keeps names unique (case-insensitive) so saving them to one folder or ZIP never overwrites a file. */
export function uniqueOutputs(outputs: ToolOutput[]): ToolOutput[] {
  const used = new Set<string>();
  return outputs.map((out) => {
    let name = out.name;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = out.name.replace(/(\.[^.]+)?$/, `_${n}$1`);
    used.add(name.toLowerCase());
    return name === out.name ? out : { ...out, name };
  });
}

/** Lets the browser paint (progress bar) between heavy synchronous steps. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Runs `fn` over every file, reporting progress. A file that fails does not stop the others: its
 * error becomes a warning. When every file fails the whole run throws.
 */
export async function processFiles<T>(
  files: ToolFile[],
  ctx: RunContext,
  label: string,
  fn: (file: ToolFile, report: (fraction: number) => void) => Promise<T>,
): Promise<{ results: { file: ToolFile; value: T }[]; warnings: string[] }> {
  const results: { file: ToolFile; value: T }[] = [];
  const warnings: string[] = [];
  for (const [i, file] of files.entries()) {
    const text = files.length > 1 ? t("{label} {n} de {total}: {name}", { label, n: i + 1, total: files.length, name: file.name }) : `${label} ${file.name}`;
    ctx.onProgress(i / files.length, text);
    await nextFrame();
    try {
      const value = await fn(file, (f) => ctx.onProgress((i + Math.min(1, Math.max(0, f))) / files.length, text));
      results.push({ file, value });
    } catch (err) {
      warnings.push(t("«{name}»: {error}", { name: file.name, error: messageOf(err) }));
    }
  }
  ctx.onProgress(1);
  if (results.length === 0) throw new Error(warnings.join("\n"));
  return { results, warnings };
}

/** "De 4,2 MB a 1,1 MB (−74 %)" */
export function reductionText(before: number, after: number): string {
  const range = t("De {before} a {after}", { before: formatSize(before), after: formatSize(after) });
  if (before <= 0 || after >= before) return t("{range} (sin cambios)", { range });
  return `${range} (−${Math.round((1 - after / before) * 100)} %)`;
}
