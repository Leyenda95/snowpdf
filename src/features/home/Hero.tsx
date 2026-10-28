import { Fragment } from "react";
import { FileUp, ShieldCheck, Snowflake } from "lucide-react";
import { Dropzone } from "@/ui";
import { Wordmark } from "@/features/shell/Wordmark";
import { openDroppedFiles, pickAndOpenPdfs } from "./actions";
import { t, type Msg } from "@/i18n";

const TAGLINE: Msg[] = ["Ver", "Editar", "Organizar"];

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden rounded-3xl border border-line bg-surface shadow-sm">
      {/* Decoration: soft glows and a faint snowflake watermark. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-28 -z-10 size-[26rem] rounded-full bg-brand-300/30 blur-3xl dark:bg-brand-500/15"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-36 -left-28 -z-10 size-[26rem] rounded-full bg-sky-200/40 blur-3xl dark:bg-brand-700/20"
      />
      <Snowflake
        aria-hidden
        strokeWidth={1}
        className="pointer-events-none absolute -bottom-12 right-8 -z-10 size-64 text-brand-500/[0.07] dark:text-brand-300/[0.06]"
      />

      <div className="grid items-center gap-8 px-6 py-8 sm:px-10 sm:py-10 lg:grid-cols-2">
        <div className="flex flex-col items-center text-center">
          <h1 className="flex items-center gap-3 sm:gap-4">
            <img src="/snowpdf.svg" alt="" aria-hidden draggable={false} className="size-12 shrink-0 drop-shadow-sm sm:size-16" />
            <Wordmark className="h-10 sm:h-12" />
          </h1>
          <p className="mt-4 text-lg font-medium tracking-tight text-muted sm:text-xl">
            {TAGLINE.map((word, i) => (
              <Fragment key={word}>
                {i > 0 && (
                  <span aria-hidden className="mx-2.5 font-bold text-brand-500">
                    ·
                  </span>
                )}
                {t(word)}
              </Fragment>
            ))}
          </p>
          <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 py-1.5 pl-3 pr-3.5 text-sm text-muted">
            <ShieldCheck size={16} aria-hidden className="shrink-0 text-emerald-600 dark:text-emerald-400" />
            {t("Procesamiento 100 % local · Sin subidas · Sin cuentas")}
          </p>
        </div>

        <Dropzone
          accept={["pdf"]}
          multiple
          onFiles={openDroppedFiles}
          onBrowse={() => void pickAndOpenPdfs()}
          className="min-h-44 gap-3 px-8"
        >
          <span className="grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-500/25">
            <FileUp size={24} aria-hidden />
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-balance text-base font-semibold text-fg">
              {t("Arrastra aquí tus PDF o haz clic para elegirlos")}
            </span>
            <span className="text-sm text-muted">{t("Puedes abrir varios a la vez.")}</span>
          </span>
        </Dropzone>
      </div>
    </section>
  );
}
