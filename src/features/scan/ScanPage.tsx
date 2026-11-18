import { ArrowLeft } from "lucide-react";
import { Button, IconButton } from "@/ui";
import { t } from "@/i18n";
import { CameraView } from "./CameraView";
import { CropEditor } from "./CropEditor";
import { ScanReview } from "./ScanReview";
import { finishScan, scanBack } from "./scanActions";
import { useScanStore } from "./scanStore";

/** The document scanner: photos -> cropped, cleaned pages -> a new PDF. */
export function ScanPage() {
  const pages = useScanStore((s) => s.pages);
  const currentId = useScanStore((s) => s.currentId);
  const step = useScanStore((s) => s.step);

  const index = Math.max(0, pages.findIndex((p) => p.id === currentId));
  // Without pages there is nothing to crop or review: only the camera.
  const page = pages.length > 0 && step !== "camera" ? pages[index] : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-2">
        <IconButton icon={ArrowLeft} label={t("Volver")} onClick={() => scanBack()} />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <h1 className="truncate text-base font-semibold text-fg">{t("Escanear")}</h1>
          {page && <span className="truncate text-xs text-muted">{t("Página {n} de {total}", { n: index + 1, total: pages.length })}</span>}
        </div>
        {page && step === "review" && (
          <Button size="sm" variant="primary" className="mr-1" onClick={() => void finishScan()}>
            {t("Crear PDF")}
          </Button>
        )}
      </header>

      {!page ? <CameraView /> : step === "crop" ? <CropEditor key={page.id} page={page} /> : <ScanReview page={page} pages={pages} />}
    </div>
  );
}
