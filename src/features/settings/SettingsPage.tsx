import { useState, type ReactNode } from "react";
import { ArrowLeft, Eye, Info, Monitor, Moon, PenLine, Save, ShieldCheck, Signature, SlidersHorizontal, Sun, Trash, type LucideIcon } from "lucide-react";
import { useAppStore, type ThemeSetting } from "@/model/appStore";
import { cleanSuffix, usePrefs, type Prefs } from "@/model/prefs";
import { useTabsStore } from "@/model/tabs";
import { platform } from "@/platform";
import type { CompressLevel } from "@/pdf/mupdf/ops";
import { useEditorStore, type ToolStyles } from "@/features/editor/editorStore";
import { formatDate } from "@/features/editor/objects";
import { CHECKER_STYLE } from "@/features/signature/checker";
import { loadSavedSignatures, removeSavedSignature, type SavedSignature } from "@/features/signature/storage";
import { Button, IconButton, NumberField, SegmentedControl, Select, Switch, TextField, cn, confirmDialog } from "@/ui";
import { intlLocale, t, useI18n, type LanguageSetting, type Msg } from "@/i18n";

/** Open the settings screen (gear button, Ctrl+,). "Volver" returns to the current view. */
export function openSettings(): void {
  const app = useAppStore.getState();
  if (app.busy || app.view.name === "settings") return;
  app.navigate({ name: "settings", back: app.view });
}

type SectionId = "general" | "view" | "edit" | "save" | "signatures" | "privacy";

const SECTIONS: { id: SectionId; label: Msg; icon: LucideIcon }[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "view", label: "Visualización", icon: Eye },
  { id: "edit", label: "Edición", icon: PenLine },
  { id: "save", label: "Guardado", icon: Save },
  { id: "signatures", label: "Firmas", icon: Signature },
  { id: "privacy", label: "Privacidad", icon: ShieldCheck },
];

const desktop = platform.kind === "tauri";

function usePref<K extends keyof Prefs>(key: K): [Prefs[K], (value: Prefs[K]) => void] {
  const value = usePrefs((s) => s[key]);
  return [value, (v) => usePrefs.getState().setPrefs({ [key]: v } as Partial<Prefs>)];
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      {title && <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>}
      <div className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-4">{children}</div>
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-muted">
      <Info size={16} aria-hidden className="mt-px shrink-0 text-brand-600 dark:text-brand-300" />
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

const THEMES: { value: ThemeSetting; label: Msg; icon: LucideIcon }[] = [
  { value: "system", label: "Sistema", icon: Monitor },
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
];

function GeneralSection() {
  const theme = useAppStore((s) => s.theme);
  const language = useI18n((s) => s.language);
  const [restoreTabs, setRestoreTabs] = usePref("restoreTabs");
  const [dropAction, setDropAction] = usePref("dropAction");
  return (
    <>
      <Group title={t("Apariencia")}>
        <SegmentedControl<ThemeSetting>
          label={t("Tema")}
          value={theme}
          onChange={(value) => useAppStore.getState().setTheme(value)}
          options={THEMES.map((th) => ({ value: th.value, label: t(th.label), icon: th.icon }))}
        />
        <SegmentedControl<LanguageSetting>
          label={t("Idioma")}
          value={language}
          onChange={(value) => useI18n.getState().setLanguage(value)}
          options={[
            { value: "system", label: t("Sistema"), icon: Monitor },
            // Each language in its own name, whatever the current one.
            { value: "es", label: "Español" },
            { value: "en", label: "English" },
          ]}
        />
      </Group>
      <Group title={t("Al arrancar")}>
        <Switch
          label={t("Restaurar las pestañas abiertas")}
          description={desktop ? t("Vuelve a abrir los PDF que tenías abiertos. Los cambios sin guardar no se recuperan.") : t("Solo en la app de escritorio.")}
          checked={desktop && restoreTabs}
          disabled={!desktop}
          onChange={setRestoreTabs}
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-fg">{t("Abrir los PDF con SnowPDF")}</span>
          <Note>
            {desktop ? (
              <>
                <p>{t("Windows no deja que una app se elija sola como predeterminada. Hazlo tú en un momento:")}</p>
                <p>
                  {t("Abre")} <strong className="font-medium text-fg">{t("Configuración › Aplicaciones › Aplicaciones predeterminadas")}</strong>{t(", busca")}{" "}
                  <strong className="font-medium text-fg">.pdf</strong> {t("y elige SnowPDF.")}
                </p>
                <p>{t("También puedes hacer clic derecho en un PDF › Abrir con › Elegir otra aplicación.")}</p>
              </>
            ) : (
              <p>{t("Solo en la app de escritorio.")}</p>
            )}
          </Note>
        </div>
      </Group>
      <Group title={t("Arrastrar y soltar")}>
        <Select<Prefs["dropAction"]>
          label={t("Al soltar archivos sobre un documento abierto")}
          value={dropAction}
          onChange={setDropAction}
          options={[
            { value: "ask", label: t("Preguntar qué hacer") },
            { value: "insert", label: t("Insertar después de la página actual") },
            { value: "tab", label: t("Abrir en una pestaña nueva") },
          ]}
        />
      </Group>
    </>
  );
}

function ViewSection() {
  const [initialZoom, setInitialZoom] = usePref("initialZoom");
  const [showThumbnails, setShowThumbnails] = usePref("showThumbnails");
  const toolsPanel = useEditorStore((s) => s.toolsPanel);
  return (
    <Group title={t("Al abrir un documento")}>
      <SegmentedControl<Prefs["initialZoom"]>
        label={t("Zoom inicial")}
        value={initialZoom}
        onChange={setInitialZoom}
        options={[
          { value: "width", label: t("Ajustar al ancho") },
          { value: "page", label: t("Página completa") },
          { value: "actual", label: "100 %" },
        ]}
      />
      <Switch label={t("Mostrar el panel de miniaturas")} checked={showThumbnails} onChange={setShowThumbnails} />
      <Switch
        label={t("Mostrar el panel «Herramientas»")}
        description={t("También cambia al abrirlo o cerrarlo en el editor.")}
        checked={toolsPanel}
        onChange={(v) => useEditorStore.getState().setToolsPanel(v)}
      />
    </Group>
  );
}

const DATE_FORMATS: ToolStyles["date"]["format"][] = ["dd/mm/yyyy", "d de mmmm de yyyy", "yyyy-mm-dd"];

function EditSection() {
  const [author, setAuthor] = usePref("author");
  const [useSourceFont, setUseSourceFont] = usePref("useSourceFont");
  const dateFormat = useEditorStore((s) => s.styles.date.format);
  const textSize = usePrefs((s) => s.textSize);
  return (
    <>
      <Group title={t("Autor")}>
        <TextField
          label={t("Nombre del autor")}
          value={author}
          placeholder={t("Tu nombre")}
          maxLength={120}
          onChange={(e) => setAuthor(e.target.value)}
          hint={t("Se guarda como autor del PDF si el documento no tiene ninguno.")}
        />
      </Group>
      <Group title={t("Texto nuevo")}>
        <Select<ToolStyles["date"]["format"]>
          label={t("Formato de fecha")}
          value={dateFormat}
          onChange={(format) => useEditorStore.getState().setStyle("date", { format })}
          options={DATE_FORMATS.map((f) => ({ value: f, label: formatDate(f) }))}
        />
        <NumberField
          label={t("Tamaño de letra")}
          value={textSize}
          min={4}
          max={400}
          suffix="pt"
          className="w-40"
          onChange={(n) => Number.isFinite(n) && usePrefs.getState().setPrefs({ textSize: Math.min(400, Math.max(4, n)) })}
        />
        <p className="text-xs text-muted">
          {t("Cada documento parte de la fuente y el tamaño de su propio texto. Este tamaño se usa cuando no tiene texto, como un escaneo.")}
        </p>
      </Group>
      <Group title={t("Editar texto")}>
        <Switch
          label={t("Usar la fuente del documento")}
          description={t("Intenta reutilizar la letra original. Si lo desactivas, se usa la fuente estándar más parecida.")}
          checked={useSourceFont}
          onChange={setUseSourceFont}
        />
      </Group>
    </>
  );
}

function SaveSection() {
  const [saveMode, setSaveMode] = usePref("saveMode");
  const [copySuffix, setCopySuffix] = usePref("copySuffix");
  const [compress, setCompress] = usePref("compress");
  const [flattenForms, setFlattenForms] = usePref("flattenForms");
  const [stripMetadata, setStripMetadata] = usePref("stripMetadata");
  return (
    <>
      <Group title={t("Guardar (Ctrl+S)")}>
        <SegmentedControl<Prefs["saveMode"]>
          label={t("Al guardar")}
          value={saveMode}
          onChange={setSaveMode}
          options={[
            { value: "overwrite", label: t("Sobrescribir el original") },
            { value: "ask", label: t("Preguntar siempre dónde") },
          ]}
        />
        <TextField
          label={t("Sufijo para las copias")}
          value={copySuffix}
          placeholder={t("_editado")}
          maxLength={40}
          className="max-w-xs"
          onChange={(e) => setCopySuffix(cleanSuffix(e.target.value))}
          hint={copySuffix ? t("Informe.pdf se propone como Informe{suffix}.pdf", { suffix: copySuffix }) : t("Se añade al nombre propuesto al guardar una copia.")}
        />
      </Group>
      <Group title={t("Archivo final")}>
        <SegmentedControl<CompressLevel | "none">
          label={t("Comprimir al guardar")}
          value={compress}
          onChange={setCompress}
          options={[
            { value: "none", label: t("No") },
            { value: "low", label: t("Poco") },
            { value: "medium", label: t("Recomendado") },
            { value: "high", label: t("Máximo") },
          ]}
        />
        <Switch
          label={t("Aplanar formularios")}
          description={t("Los campos rellenados pasan a ser texto fijo. Se aplica a los documentos que abras desde ahora.")}
          checked={flattenForms}
          onChange={setFlattenForms}
        />
        <Switch
          label={t("Quitar los metadatos")}
          description={t("Borra título, autor, asunto, palabras clave y fechas. Solo queda SnowPDF como productor.")}
          checked={stripMetadata}
          onChange={setStripMetadata}
        />
      </Group>
    </>
  );
}

function SignaturesSection() {
  const [items, setItems] = useState<SavedSignature[]>(() => loadSavedSignatures());
  const remove = async (item: SavedSignature) => {
    const ok = await confirmDialog({
      title: item.kind === "firma" ? t("¿Borrar esta firma?") : t("¿Borrar estas iniciales?"),
      message: t("Se borrará de este equipo. No afecta a los PDF ya firmados."),
      confirmLabel: t("Borrar"),
      danger: true,
    });
    if (ok) setItems(removeSavedSignature(item.id));
  };
  return (
    <Group title={t("Firmas guardadas")}>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t("No tienes firmas guardadas. Puedes crearlas al firmar un documento.")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {[...items].reverse().map((item) => (
            <li key={item.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
              <span className="grid h-14 w-32 shrink-0 place-items-center overflow-hidden rounded-lg border border-line-strong p-1.5" style={CHECKER_STYLE}>
                <img src={item.dataUrl} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-fg">{item.kind === "firma" ? t("Firma") : t("Iniciales")}</span>
                <span className="text-xs text-muted">{t("Creada el {date}", { date: new Date(item.createdAt).toLocaleDateString(intlLocale()) })}</span>
              </span>
              <IconButton icon={Trash} label={t("Borrar")} onClick={() => void remove(item)} />
            </li>
          ))}
        </ul>
      )}
    </Group>
  );
}

function PrivacySection() {
  const [rememberRecent, setRememberRecent] = usePref("rememberRecent");
  const recentCount = useAppStore((s) => s.recent.length);
  return (
    <Group title={t("Archivos recientes")}>
      <Switch
        label={t("Recordar los archivos recientes")}
        description={t("Si lo desactivas, también se borra la lista actual.")}
        checked={rememberRecent}
        onChange={(v) => {
          setRememberRecent(v);
          if (!v) useAppStore.getState().clearRecent();
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted">
          {recentCount === 0
            ? t("La lista está vacía.")
            : t(recentCount === 1 ? "{n} archivo en la lista." : "{n} archivos en la lista.", { n: recentCount })}
        </span>
        <Button size="sm" icon={Trash} disabled={recentCount === 0} onClick={() => useAppStore.getState().clearRecent()}>
          {t("Borrar recientes")}
        </Button>
      </div>
      <Note>
        <p>{t("Todo se guarda solo en este equipo. SnowPDF no envía nada a internet.")}</p>
      </Note>
    </Group>
  );
}

const CONTENT: Record<SectionId, () => ReactNode> = {
  general: GeneralSection,
  view: ViewSection,
  edit: EditSection,
  save: SaveSection,
  signatures: SignaturesSection,
  privacy: PrivacySection,
};

function goBack(): void {
  const app = useAppStore.getState();
  const back = app.view.name === "settings" ? app.view.back : { name: "home" as const };
  const needsTab = back.name === "editor" || back.name === "organize";
  app.navigate(needsTab && !useTabsStore.getState().activeId ? { name: "home" } : back);
}

/** Acrobat-like "Preferencias": sections on the left, their settings on the right. */
export function SettingsPage() {
  const [section, setSection] = useState<SectionId>("general");
  const current = SECTIONS.find((s) => s.id === section)!;
  const Content = CONTENT[section];
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted outline-none transition-colors hover:bg-surface-3 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <ArrowLeft size={14} aria-hidden /> {t("Volver")}
          </button>
          <h1 className="text-lg font-semibold tracking-tight text-fg">{t("Preferencias")}</h1>
        </div>
        <div className="flex flex-col gap-6 md:flex-row">
          <nav aria-label={t("Secciones")} className="md:w-52 md:shrink-0">
            <ul className="flex gap-1 overflow-x-auto md:flex-col">
              {SECTIONS.map((s) => {
                const Icon = s.icon;
                const active = s.id === section;
                return (
                  <li key={s.id} className="shrink-0">
                    <button
                      type="button"
                      aria-current={active ? "page" : undefined}
                      onClick={() => setSection(s.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/50",
                        active ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/60 dark:text-brand-200" : "text-muted hover:bg-surface-3 hover:text-fg",
                      )}
                    >
                      <Icon size={16} aria-hidden />
                      {t(s.label)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="flex min-w-0 flex-1 flex-col gap-6 pb-10">
            <h2 className="text-base font-semibold text-fg">{t(current.label)}</h2>
            <Content />
          </div>
        </div>
      </div>
    </main>
  );
}
