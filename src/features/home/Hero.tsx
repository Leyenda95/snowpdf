import { FileUp, FolderOpen, ScanLine } from "lucide-react";
import { BrandMark, Dropzone } from "@/ui";
import { Wordmark } from "@/features/shell/Wordmark";
import { startScan } from "@/features/scan/scanActions";
import { openDroppedFiles, pickAndOpenPdfs } from "./actions";
import { t, type Msg } from "@/i18n";

const TAGLINE: Msg[] = ["Ver", "Editar", "Construir"];

/** The promise of the app, set like a footnote: a rule and the asterisk of the logotype. */
function Footnote({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div aria-hidden className="h-px bg-rule" />
      <p className="mt-3 flex items-start gap-2 text-xs font-semibold text-fg md:text-[13px]">
        <BrandMark className="mt-[0.15em] size-3.5 text-brand-500" />
        <span className="text-balance">{t("Procesamiento 100 % local · Sin subidas · Sin cuentas")}</span>
      </p>
    </div>
  );
}

/** Phone hero: the tagline as a headline, one big "open" button and the footnote (no drop zone on a touch screen). */
function PhoneHero() {
  return (
    <section className="flex flex-col pb-2 pt-3 md:hidden">
      <h1 className="sr-only">SnowPDF</h1>
      <p className="font-display text-[2.75rem] font-extrabold leading-[0.95] tracking-tight text-fg">
        {TAGLINE.map((word) => (
          <span key={word} className="block">
            {t(word)}.
          </span>
        ))}
      </p>
      <button
        type="button"
        onClick={() => void pickAndOpenPdfs()}
        className="mt-7 inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-primary text-base font-semibold text-on-primary outline-none transition-colors active:bg-primary-hover focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-app"
      >
        <FolderOpen size={22} aria-hidden />
        {t("Abrir PDF")}
      </button>
      <button
        type="button"
        onClick={() => startScan()}
        className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-2xl border border-rule bg-surface text-base font-semibold text-fg outline-none transition-colors active:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-app"
      >
        <ScanLine size={22} aria-hidden />
        {t("Escanear documento")}
      </button>
      <Footnote className="mt-6" />
    </section>
  );
}

export function Hero() {
  return (
    <>
      <PhoneHero />
      <DesktopHero />
    </>
  );
}

function DesktopHero() {
  return (
    <section className="grid items-stretch gap-8 max-md:hidden lg:grid-cols-2">
      <div className="flex min-w-0 flex-col justify-between gap-8 py-1">
        <h1>
          <Wordmark className="h-11 xl:h-[3.25rem]" />
        </h1>
        <p className="font-display text-2xl font-semibold tracking-tight text-fg">{TAGLINE.map((word) => `${t(word)}.`).join(" ")}</p>
        <Footnote />
      </div>

      <Dropzone
        accept={["pdf"]}
        multiple
        onFiles={openDroppedFiles}
        onBrowse={() => void pickAndOpenPdfs()}
        className="min-h-60 items-start! justify-end! gap-4! rounded-lg! p-7! text-left!"
      >
        <span className="grid size-12 place-items-center rounded-lg bg-brand-500 text-ink">
          <FileUp size={24} aria-hidden />
        </span>
        <span className="flex flex-col gap-1.5">
          <span className="text-balance font-display text-2xl font-bold leading-tight tracking-tight text-fg">
            <span className="pointer-coarse:hidden">{t("Arrastra aquí tus PDF o haz clic para elegirlos")}</span>
            <span className="hidden pointer-coarse:inline">{t("Toca aquí para elegir tus PDF")}</span>
          </span>
          <span className="text-sm text-muted">{t("Puedes abrir varios a la vez.")}</span>
        </span>
      </Dropzone>
    </section>
  );
}
