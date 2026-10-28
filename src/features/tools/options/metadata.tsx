import { useEffect } from "react";
import { readMetadata, writeMetadata, type PdfMetadata } from "@/pdf/tools";
import { Spinner, TextField } from "@/ui";
import type { OptionsProps, ToolModule } from "../types";
import { baseOf, messageOf, nextFrame } from "../utils";
import { GroupLabel, Note, OptionStack } from "./common";
import { intlLocale, t } from "@/i18n";

interface MetadataToolOptions {
  /** File whose metadata is loaded into the fields below. */
  fileId: string | null;
  info: PdfMetadata | null;
  error: string | null;
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
}

const EMPTY: MetadataToolOptions = {
  fileId: null,
  info: null,
  error: null,
  title: "",
  author: "",
  subject: "",
  keywords: "",
  creator: "",
};

function formatDate(date: Date | null): string {
  return date ? new Intl.DateTimeFormat(intlLocale(), { dateStyle: "long", timeStyle: "short" }).format(date) : "—";
}

function MetadataOptions({ files, options, onChange, disabled }: OptionsProps<MetadataToolOptions>) {
  const file = files[0];
  const fileId = file?.id ?? null;

  useEffect(() => {
    if (!file || options.fileId === file.id) return;
    let cancelled = false;
    readMetadata(file.bytes)
      .then((info) => {
        if (cancelled) return;
        onChange({ ...EMPTY, fileId: file.id, info, title: info.title, author: info.author, subject: info.subject, keywords: info.keywords, creator: info.creator });
      })
      .catch((err) => {
        if (!cancelled) onChange({ ...EMPTY, fileId: file.id, error: messageOf(err) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  const set = (patch: Partial<MetadataToolOptions>) => onChange((prev) => ({ ...prev, ...patch }));
  const info = options.info;

  if (options.error) return <Note>{t("No se pudieron leer los metadatos:")} {options.error}</Note>;
  if (!info)
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner size={16} /> {t("Leyendo metadatos…")}
      </div>
    );

  const text = (key: "title" | "author" | "subject" | "keywords" | "creator", label: string, hint?: string) => (
    <TextField label={label} hint={hint} value={options[key]} disabled={disabled} autoComplete="off" onChange={(e) => set({ [key]: e.target.value })} />
  );

  return (
    <OptionStack>
      {text("title", t("Título"))}
      {text("author", t("Autor"))}
      {text("subject", t("Asunto"))}
      {text("keywords", t("Palabras clave"), t("Sepáralas con comas."))}
      {text("creator", t("Creador"))}

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <GroupLabel>{t("Información del archivo")}</GroupLabel>
        <TextField label={t("Productor")} value={info.producer || "—"} readOnly />
        <TextField label={t("Creado")} value={formatDate(info.creationDate)} readOnly />
        <TextField label={t("Modificado")} value={formatDate(info.modificationDate)} readOnly />
        <TextField label={t("Páginas")} value={String(info.pageCount)} readOnly />
      </div>
    </OptionStack>
  );
}

export const metadataTool: ToolModule<MetadataToolOptions> = {
  actionLabel: "Guardar metadatos",
  defaultOptions: () => EMPTY,
  Options: MetadataOptions,
  validate: (files, options) => (files[0] && !options.info ? (options.error ? t("No se pueden leer los metadatos.") : t("Leyendo metadatos…")) : null),
  async run(files, options, ctx) {
    const file = files[0];
    ctx.onProgress(undefined, t("Guardando metadatos…"));
    await nextFrame();
    const bytes = await writeMetadata(file.bytes, {
      title: options.title,
      author: options.author,
      subject: options.subject,
      keywords: options.keywords,
      creator: options.creator,
    });
    return {
      summary: t("Metadatos actualizados"),
      outputs: [{ name: `${baseOf(file.name)}${t("_metadatos")}.pdf`, bytes, kind: "pdf" }],
      zipName: t("metadatos.zip"),
      warnings: [],
    };
  },
};
