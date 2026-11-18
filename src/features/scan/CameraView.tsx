import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Images, Zap, ZapOff, type LucideIcon } from "lucide-react";
import { Button, Spinner, cn } from "@/ui";
import { t } from "@/i18n";
import { closeCamera, grabFrame, hasTorch, openCamera, prepareStill, setTorch, takeStill } from "./camera";
import { addCameraPhoto, pickScanPhotos, takeSystemPhoto } from "./scanActions";
import { useScanStore } from "./scanStore";

type Status = "starting" | "live" | "failed";

/** A transparent 1×1 GIF: a poster that shows nothing. */
const NO_POSTER = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

/** Some phones only report the torch a moment after the camera starts. */
const TORCH_RECHECK_MS = 800;

/**
 * The camera, kept open while this is on screen and the app is in front. `retry` reopens it
 * after a failure.
 */
function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [canTorch, setCanTorch] = useState(false);
  const [torch, setTorchOn] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Each start gets a number: one that finishes after a newer start (or the unmount) is dropped.
    let run = 0;
    let recheck = 0;

    const stop = () => {
      run++;
      window.clearTimeout(recheck);
      if (streamRef.current) closeCamera(streamRef.current);
      streamRef.current = null;
      setTorchOn(false);
    };

    const start = async () => {
      stop();
      const mine = run;
      setStatus("starting");
      try {
        const stream = await openCamera();
        if (mine !== run) return closeCamera(stream);
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        if (mine !== run) return;
        prepareStill(stream);
        setStatus("live");
        setCanTorch(hasTorch(stream));
        recheck = window.setTimeout(() => setCanTorch(hasTorch(stream)), TORCH_RECHECK_MS);
      } catch {
        if (mine === run) setStatus("failed");
      }
    };

    // A camera left open in the background keeps its light and its indicator on.
    const onVisibility = () => (document.hidden ? stop() : void start());
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) void start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [attempt]);

  const toggleTorch = async () => {
    const stream = streamRef.current;
    if (!stream) return;
    try {
      await setTorch(stream, !torch);
      setTorchOn(!torch);
    } catch {
      setCanTorch(false);
    }
  };

  return { videoRef, streamRef, status, canTorch, torch, toggleTorch, retry: () => setAttempt((n) => n + 1) };
}

/** The scanner's camera: viewfinder, shutter, light, and the way to photos already taken. */
export function CameraView() {
  const { videoRef, streamRef, status, canTorch, torch, toggleTorch, retry } = useCamera();
  const pages = useScanStore((s) => s.pages);
  const currentId = useScanStore((s) => s.currentId);
  const [shooting, setShooting] = useState(false);
  const [blink, setBlink] = useState(false);

  const shoot = async () => {
    const video = videoRef.current;
    if (!video || shooting || status !== "live") return;
    setShooting(true);
    let added = false;
    try {
      // The frame on screen first: it is the photo if the camera cannot take a still.
      const frame = await grabFrame(video).catch(() => null);
      // The still takes a moment, and the phone has to stay where it is meanwhile.
      const stream = streamRef.current;
      const still = stream ? await takeStill(stream) : null;
      // Taken: the picture stays put while the page is prepared.
      video.pause();
      setBlink(true);
      window.setTimeout(() => setBlink(false), 80);
      added = await addCameraPhoto(still, frame);
    } catch {
      added = false;
    }
    // On success the scanner moves on to cropping and this view goes away.
    if (!added) {
      setShooting(false);
      if (video.paused) void video.play().catch(() => retry());
    }
  };

  if (status === "failed") return <NoCamera onRetry={retry} />;

  return (
    <div className="relative min-h-0 flex-1 select-none overflow-hidden bg-black">
      {/*
        The poster is a transparent pixel: without one, Android's WebView paints its own (a grey
        "play" symbol, stretched over the whole video) until the camera delivers its first frame.
        The video is also kept invisible until then, for WebViews that ignore the poster.
      */}
      <video
        ref={videoRef}
        muted
        playsInline
        poster={NO_POSTER}
        aria-label={t("Cámara")}
        className={cn("absolute inset-0 size-full object-contain", status !== "live" && "opacity-0")}
      />
      {status === "starting" && (
        <div className="absolute inset-0 grid place-items-center text-white">
          <Spinner />
        </div>
      )}
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-0 bg-white", blink ? "opacity-70" : "opacity-0 transition-opacity duration-200")}
      />

      {shooting && (
        <p role="status" className="absolute inset-x-0 top-4 mx-auto w-fit rounded-full bg-black/60 px-4 py-1.5 text-sm font-medium text-white">
          {t("No muevas el móvil…")}
        </p>
      )}

      {canTorch && (
        <RoundButton
          icon={torch ? Zap : ZapOff}
          label={torch ? t("Apagar el flash") : t("Encender el flash")}
          pressed={torch}
          className="absolute right-3 top-3"
          onClick={() => void toggleTorch()}
        />
      )}

      <div
        className="absolute inset-x-0 bottom-0 grid grid-cols-3 items-center bg-gradient-to-t from-black/70 to-transparent px-6 pt-10"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
      >
        <RoundButton icon={Images} label={t("Elegir fotos")} className="justify-self-start" onClick={() => void pickScanPhotos()} />
        <button
          type="button"
          aria-label={t("Hacer foto")}
          disabled={status !== "live" || shooting}
          onClick={() => void shoot()}
          className="grid size-[4.5rem] place-items-center justify-self-center rounded-full border-4 border-white outline-none transition-transform focus-visible:ring-4 focus-visible:ring-brand-500/60 active:scale-95 disabled:opacity-50"
        >
          <span className="size-14 rounded-full bg-white" />
        </button>
        {pages.length > 0 && (
          <button
            type="button"
            onClick={() => useScanStore.getState().show(currentId ?? pages[0].id, "review")}
            className="h-11 justify-self-end rounded-full bg-black/45 px-4 text-sm font-semibold text-white outline-none ring-1 ring-white/25 focus-visible:ring-2 focus-visible:ring-brand-500 active:bg-black/65"
          >
            {t(pages.length === 1 ? "1 página" : "{n} páginas", { n: pages.length })}
          </button>
        )}
      </div>
    </div>
  );
}

function RoundButton({ icon: Icon, label, pressed, className, onClick }: { icon: LucideIcon; label: string; pressed?: boolean; className?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "grid size-11 place-items-center rounded-full outline-none ring-1 ring-white/25 focus-visible:ring-2 focus-visible:ring-brand-500",
        pressed ? "bg-white text-neutral-900" : "bg-black/45 text-white active:bg-black/65",
        className,
      )}
    >
      <Icon size={20} aria-hidden />
    </button>
  );
}

/** No camera (none on the device, or no permission): the other ways to get a photo in. */
function NoCamera({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8 text-center">
      <span className="grid size-16 place-items-center rounded-2xl bg-brand-500 text-ink">
        <CameraOff size={32} aria-hidden />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-fg">{t("No se pudo abrir la cámara")}</h2>
      <p className="mt-1.5 max-w-xs text-balance text-sm text-muted">
        {t("Comprueba que SnowPDF tiene permiso para usarla. También puedes usar la cámara del teléfono o fotos que ya tengas.")}
      </p>
      <div className="mt-6 flex w-full max-w-xs flex-col gap-3">
        <Button variant="primary" size="lg" fullWidth onClick={onRetry}>
          {t("Reintentar")}
        </Button>
        <Button size="lg" icon={Camera} fullWidth onClick={() => void takeSystemPhoto()}>
          {t("Cámara del teléfono")}
        </Button>
        <Button size="lg" icon={Images} fullWidth onClick={() => void pickScanPhotos()}>
          {t("Elegir fotos")}
        </Button>
      </div>
    </div>
  );
}
