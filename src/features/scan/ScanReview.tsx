import { Camera, Crop, Images, RotateCw, Trash, type LucideIcon } from "lucide-react";
import { SCAN_FILTERS, type ScanFilter } from "@/pdf/scan/enhance";
import { Spinner, cn, confirmDialog } from "@/ui";
import { t, type Msg } from "@/i18n";
import { RasterCanvas } from "./RasterCanvas";
import { pickScanPhotos } from "./scanActions";
import { useScanRender } from "./scanEngine";
import { useScanStore, type ScanPage } from "./scanStore";

const FILTER_LABELS: Record<ScanFilter, Msg> = {
  original: "Original",
  color: "Color",
  gray: "Grises",
  bw: "B/N",
};

/** Longest side of the processed page on screen, of the filter samples and of the page thumbnails. */
const VIEW_SIDE = 1280;
const FILTER_SIDE = 240;
const THUMB_SIDE = 160;

/** The current page as it will be in the PDF, with its filters, actions and the page strip. */
export function ScanReview({ page, pages }: { page: ScanPage; pages: ScanPage[] }) {
  const { quad, filter, turns } = page;
  // Rendered by the scan worker: the screen stays responsive, and shows the last picture meanwhile.
  const view = useScanRender(page.id, { quad, filter, turns }, VIEW_SIDE);

  const store = useScanStore.getState;
  const onDelete = async () => {
    const ok = await confirmDialog({ title: t("¿Eliminar esta página?"), confirmLabel: t("Eliminar"), danger: true });
    if (ok) store().remove(page.id);
  };

  return (
    <>
      <div className="relative min-h-0 flex-1 bg-canvas">
        <div className="absolute inset-0 flex items-center justify-center p-3">
          {view.raster && <RasterCanvas raster={view.raster} className="max-h-full max-w-full object-contain shadow-md" />}
        </div>
        {view.pending && (
          <div className={cn("absolute grid place-items-center text-muted", view.raster ? "right-3 top-3" : "inset-0")} role="status" aria-label={t("Procesando…")}>
            <Spinner size={view.raster ? 18 : 24} />
          </div>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto border-t border-line bg-surface px-3 py-2">
        {SCAN_FILTERS.map((f) => (
          <FilterSample key={f} page={page} filter={f} selected={f === filter} />
        ))}
      </div>

      <div className="flex items-center justify-around bg-surface px-3 py-1">
        <IconTile caption className={ACTION_TILE} icon={Crop} label={t("Ajustar bordes")} onClick={() => store().show(page.id, "crop")} />
        <IconTile caption className={ACTION_TILE} icon={RotateCw} label={t("Girar")} onClick={() => store().update(page.id, { turns: (turns + 1) % 4 })} />
        <IconTile caption className={ACTION_TILE} icon={Trash} label={t("Eliminar")} onClick={() => void onDelete()} />
      </div>

      <div
        className="flex items-center gap-2 overflow-x-auto border-t border-line bg-surface px-3 pt-2"
        style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
      >
        {pages.map((p, i) => (
          <PageThumb key={p.id} page={p} n={i + 1} total={pages.length} current={p.id === page.id} />
        ))}
        <IconTile className={ADD_TILE} icon={Camera} label={t("Añadir página con la cámara")} onClick={() => store().camera()} />
        <IconTile className={ADD_TILE} icon={Images} label={t("Añadir páginas desde fotos")} onClick={() => void pickScanPhotos()} />
      </div>
    </>
  );
}

const ACTION_TILE = "flex min-w-16 flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-xs text-fg";
const ADD_TILE = "grid h-16 w-12 shrink-0 place-items-center rounded-md border border-dashed border-line-strong text-muted hover:text-fg";

/** Icon button of the review screen; `caption` shows the label under the icon instead of only announcing it. */
function IconTile({ icon: Icon, label, caption = false, className, onClick }: { icon: LucideIcon; label: string; caption?: boolean; className: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={caption ? undefined : label}
      title={caption ? undefined : label}
      onClick={onClick}
      className={cn("outline-none hover:bg-surface-2 active:bg-surface-3 focus-visible:ring-2 focus-visible:ring-brand-500/50", className)}
    >
      <Icon size={20} aria-hidden />
      {caption && label}
    </button>
  );
}

/** A filter to pick, shown as a small sample of the page with it. */
function FilterSample({ page, filter, selected }: { page: ScanPage; filter: ScanFilter; selected: boolean }) {
  const { raster } = useScanRender(page.id, { quad: page.quad, filter, turns: page.turns }, FILTER_SIDE, true);
  const frame = cn("h-20 w-16 rounded-lg bg-surface-3 object-cover", selected ? "ring-2 ring-brand-500" : "ring-1 ring-line");
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => useScanStore.getState().update(page.id, { filter })}
      className="flex shrink-0 flex-col items-center gap-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      {raster ? <RasterCanvas raster={raster} className={frame} /> : <div className={frame} />}
      <span className={cn("text-xs", selected ? "font-semibold text-fg" : "text-muted")}>{t(FILTER_LABELS[filter])}</span>
    </button>
  );
}

function PageThumb({ page, n, total, current }: { page: ScanPage; n: number; total: number; current: boolean }) {
  const { raster } = useScanRender(page.id, { quad: page.quad, filter: page.filter, turns: page.turns }, THUMB_SIDE, true);
  const frame = cn("h-16 w-12 rounded-md bg-surface-3 object-cover", current ? "ring-2 ring-brand-500" : "ring-1 ring-line");
  return (
    <button
      type="button"
      aria-label={t("Página {n} de {total}", { n, total })}
      aria-current={current || undefined}
      onClick={() => useScanStore.getState().show(page.id, "review")}
      className="relative shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      {raster ? <RasterCanvas raster={raster} className={frame} /> : <div className={frame} />}
      <span className="absolute bottom-0.5 right-0.5 min-w-4 rounded bg-neutral-900/70 px-1 text-center text-[10px] font-semibold leading-4 text-white">
        {n}
      </span>
    </button>
  );
}
