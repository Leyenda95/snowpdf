import { useState } from "react";
import { ChevronRight, FileText, X } from "lucide-react";
import { useAppStore, type RecentFile } from "@/model/appStore";
import { platform } from "@/platform";
import { Button, IconButton } from "@/ui";
import { openRecentFile } from "./actions";
import { formatRelativeTime } from "./relativeTime";
import { t } from "@/i18n";

const COLLAPSED_COUNT = 5;

/** Folder part of a path, for the secondary line under the file name. */
function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return cut > 0 ? path.slice(0, cut) : path;
}

function RecentRow({ file }: { file: RecentFile }) {
  return (
    <li className="flex items-center gap-1 pr-2 transition-colors hover:bg-surface-2 max-md:rounded-3xl max-md:bg-surface max-md:pr-1 max-md:border max-md:border-line">
      <button
        type="button"
        title={file.path}
        onClick={() => void openRecentFile(file)}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50 max-md:rounded-3xl max-md:py-3.5 max-md:active:bg-surface-3"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-3 text-fg max-md:size-11 max-md:rounded-xl">
          <FileText size={18} aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-fg">{file.name}</span>
          <span className="truncate text-xs text-subtle max-md:text-muted">{folderOf(file.path)}</span>
        </span>
        <span className="hidden shrink-0 text-xs text-subtle sm:block">{formatRelativeTime(file.openedAt)}</span>
        <ChevronRight size={16} aria-hidden className="shrink-0 text-subtle md:hidden" />
      </button>
      <IconButton
        icon={X}
        label={t("Quitar de recientes")}
        size="sm"
        onClick={() => useAppStore.getState().removeRecent(file.path)}
      />
    </li>
  );
}

/** Recently opened files. Only meaningful on the desktop app, where files have real paths. */
export function RecentSection() {
  const recent = useAppStore((state) => state.recent);
  const [expanded, setExpanded] = useState(false);

  if (platform.kind !== "tauri" || recent.length === 0) return null;
  const shown = expanded ? recent : recent.slice(0, COLLAPSED_COUNT);

  return (
    <section aria-label={t("Recientes")} className="mt-10 max-md:mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-fg max-md:text-base">{t("Recientes")}</h2>
        {recent.length > COLLAPSED_COUNT && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => !e)}>
            {expanded ? t("Ver menos") : t("Ver todos ({n})", { n: recent.length })}
          </Button>
        )}
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-rule bg-surface max-md:flex max-md:flex-col max-md:gap-2 max-md:divide-y-0 max-md:overflow-visible max-md:rounded-none max-md:border-0 max-md:bg-transparent">
        {shown.map((file) => (
          <RecentRow key={file.path} file={file} />
        ))}
      </ul>
    </section>
  );
}
