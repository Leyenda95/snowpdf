import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader } from "lucide-react";
import { Button, Dropzone, Slider, Switch, toast } from "@/ui";
import { platform, EXTENSIONS } from "@/platform";
import { normalizeImage } from "@/render/imageDecode";
import { CHECKER_STYLE } from "./checker";
import { MAX_SIDE } from "./trim";
import type { SignatureSource } from "./types";
import { t } from "@/i18n";

/** Width (in luminance levels) of the soft edge below the threshold. */
const RAMP = 40;

/** Makes near-white pixels transparent: opaque below `threshold - RAMP`, clear above `threshold`. */
export function removeLightBackground(src: HTMLCanvasElement, threshold: number): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const image = ctx.getImageData(0, 0, out.width, out.height);
  const d = image.data;
  const low = threshold - RAMP;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum >= threshold) d[i + 3] = 0;
    else if (lum > low) d[i + 3] = Math.round((d[i + 3] * (threshold - lum)) / RAMP);
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

async function decodeToCanvas(bytes: Uint8Array): Promise<HTMLCanvasElement> {
  const normalized = await normalizeImage(bytes);
  const bitmap = await createImageBitmap(new Blob([normalized.bytes as Uint8Array<ArrayBuffer>], { type: normalized.mime }));
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

export interface ImageSignatureProps {
  onSourceChange: (source: SignatureSource | null) => void;
}

export function ImageSignature({ onSourceChange }: ImageSignatureProps) {
  const [original, setOriginal] = useState<HTMLCanvasElement | null>(null);
  const [removeBg, setRemoveBg] = useState(true);
  const [threshold, setThreshold] = useState(225);
  const [loading, setLoading] = useState(false);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const load = useCallback(async (bytes: Uint8Array) => {
    setLoading(true);
    try {
      setOriginal(await decodeToCanvas(bytes));
    } catch {
      toast.error(t("No se pudo abrir la imagen. Prueba con otro archivo."));
    } finally {
      setLoading(false);
    }
  }, []);

  const browse = useCallback(async () => {
    try {
      const [file] = await platform.openFiles({ kinds: ["image"], title: t("Elegir imagen de la firma") });
      if (file) await load(file.bytes);
    } catch {
      toast.error(t("No se pudo abrir el selector de archivos."));
    }
  }, [load]);

  const onFiles = useCallback(
    async (files: File[]) => {
      try {
        await load(new Uint8Array(await files[0].arrayBuffer()));
      } catch {
        toast.error(t("No se pudo leer el archivo."));
      }
    },
    [load],
  );

  // Processed artwork: recomputed live, drawn into the preview and published to the dialog.
  useEffect(() => {
    if (!original) {
      onSourceChange(null);
      return;
    }
    const processed = removeBg ? removeLightBackground(original, threshold) : original;
    const preview = previewRef.current;
    if (preview) {
      preview.width = processed.width;
      preview.height = processed.height;
      preview.getContext("2d")?.drawImage(processed, 0, 0);
    }
    onSourceChange(() => processed);
  }, [original, removeBg, threshold, onSourceChange]);

  if (!original) {
    return (
      <Dropzone accept={EXTENSIONS.image} onFiles={onFiles} onBrowse={browse} disabled={loading} className="min-h-56">
        <div className="grid size-12 place-items-center rounded-2xl bg-surface-3 text-muted">
          {loading ? <Loader size={22} className="animate-spin" aria-hidden /> : <ImagePlus size={22} aria-hidden />}
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium text-fg">{t("Arrastra una foto de tu firma o haz clic para elegirla")}</p>
          <p className="text-xs text-subtle">{t("Mejor sobre papel blanco y con buena luz. Admite PNG, JPG, WEBP, GIF y BMP.")}</p>
        </div>
      </Dropzone>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex h-56 items-center justify-center overflow-hidden rounded-xl border border-line-strong p-3"
        style={CHECKER_STYLE}
      >
        <canvas ref={previewRef} className="h-auto max-h-full w-auto max-w-full" />
      </div>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Switch checked={removeBg} onChange={setRemoveBg} label={t("Quitar fondo claro")} />
        <Slider
          className="w-52"
          label={t("Umbral")}
          min={120}
          max={255}
          step={1}
          value={threshold}
          disabled={!removeBg}
          onChange={setThreshold}
        />
        <Button size="sm" variant="secondary" icon={ImagePlus} className="ml-auto" disabled={loading} onClick={browse}>
          {t("Cambiar imagen")}
        </Button>
      </div>
    </div>
  );
}
