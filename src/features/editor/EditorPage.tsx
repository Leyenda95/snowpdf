import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, EllipsisVertical, Files, LayoutGrid, PanelRight, Save, Settings, X } from "lucide-react";
import { openSettings } from "@/features/settings/SettingsPage";
import { useAppStore } from "@/model/appStore";
import { useDocStore } from "@/model/docStore";
import { deleteObjects, duplicateObjects, updateObjects } from "@/model/docActions";
import { displayRotation, type PageRef } from "@/model/types";
import { makeViewTransform } from "@/render/viewTransform";
import { closeTab, cycleTab, useTabsStore } from "@/model/tabs";
import { platform } from "@/platform";
import { openDocuments } from "@/model/workspace";
import { AppHeader } from "@/features/shell/AppHeader";
import { SignatureDialog } from "@/features/signature/SignatureDialog";
import { Button, IconButton, Menu, NumberField, cn, confirmDialog, toast, useEscapeLayer, useIsMobile, useMediaQuery, useWindowFileDrop } from "@/ui";
import { handleDroppedFiles } from "./askDropAction";
import { useEditorStore } from "./editorStore";
import { EditorToolbar, TOOL_SHORTCUTS, activateTool } from "./EditorToolbar";
import { Sidebar } from "./Sidebar";
import { ToolsPanel } from "./tools/ToolsPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { SaveDialog } from "./SaveDialog";
import { SHORT_QUERY, Viewer, phoneInsets, zoomViewerTo } from "./viewer/Viewer";
import { PhoneViewerOverlays } from "./PhoneOverlays";
import { clearTouchSelection } from "./touchSelection";
import { PageOverlay } from "./overlay/PageOverlay";
import { Underlay } from "./overlay/Underlay";
import { copySelection, cutSelection, paste, placeSignature } from "./actions";
import { quickSaveOptions, saveWorkspace } from "./save";
import { t } from "@/i18n";

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

/** Fields whose own text history is worth keeping on Ctrl+Z (not number boxes, selects...). */
function isFreeText(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable || t.tagName === "TEXTAREA") return true;
  return t instanceof HTMLInputElement && t.type === "text" && t.getAttribute("role") !== "spinbutton";
}

/** Nudge by `dx, dy` points as seen on screen. */
function nudge(page: PageRef | undefined, ids: string[], dx: number, dy: number) {
  if (!page || !ids.length) return;
  const d = makeViewTransform(page.view, 1, displayRotation(page)).deltaToUser(dx, dy);
  updateObjects(
    ids,
    (o) => {
      o.frame = { ...o.frame, cx: o.frame.cx + d.x, cy: o.frame.cy + d.y };
    },
    `nudge:${ids.join()}`,
  );
}

/** Close the active document's tab. */
export async function leaveEditor(): Promise<void> {
  const { activeId } = useTabsStore.getState();
  if (activeId) await closeTab(activeId);
}

async function openMore(): Promise<void> {
  const files = await platform.openFiles({ kinds: ["pdf"], multiple: true, title: t("Abrir PDF") });
  await openDocuments(files);
}

export function EditorPage() {
  const pageCount = useDocStore((s) => s.doc.pages.length);
  const hasForm = useDocStore((s) => Object.values(s.sources).some((x) => x.hasForm));
  const tool = useEditorStore((s) => s.tool);
  const placing = useEditorStore((s) => s.placing);
  const current = useEditorStore((s) => s.currentPage);
  const thumbnails = useEditorStore((s) => s.thumbnails);
  const showProps = useEditorStore((s) => s.showProps);
  const signatureOpen = useEditorStore((s) => s.signatureDialog);
  const sidebar = useEditorStore((s) => s.sidebar);
  const toolsPanel = useEditorStore((s) => s.toolsPanel);
  const hasSelection = useEditorStore((s) => s.selection.length > 0);
  const activeTab = useTabsStore((s) => s.activeId);
  const mobile = useIsMobile();
  const short = useMediaQuery(SHORT_QUERY);
  // The root font size is fixed for the session (set once in index.html).
  const insetsTall = useMemo(() => phoneInsets(false), []);
  const insetsShort = useMemo(() => phoneInsets(true), []);
  const immersive = useEditorStore((s) => s.immersive) && mobile;
  const [saveAsOpen, setSaveAsOpen] = useState(false);

  const save = useCallback(() => saveWorkspace(quickSaveOptions()), []);

  // Drop files anywhere: insert their pages after the current one.
  useWindowFileDrop(async (files) => {
    await handleDroppedFiles(files, {
      currentPage: useEditorStore.getState().currentPage,
      pageCount: useDocStore.getState().doc.pages.length,
    });
  }, ["pdf", "png", "jpg", "jpeg", "webp", "gif", "bmp"]);

  // The selection only ever names objects that exist: undoing a creation or deleting from a
  // panel would otherwise leave a ghost that swallows the arrow keys and the next tap.
  useEffect(
    () =>
      useDocStore.subscribe((s, prev) => {
        if (s.doc.objects === prev.doc.objects) return;
        const ed = useEditorStore.getState();
        if (ed.selection.length === 0) return;
        const alive = new Set(s.doc.objects.map((o) => o.id));
        if (ed.selection.some((id) => !alive.has(id))) ed.select(ed.selection.filter((id) => alive.has(id)));
      }),
    [],
  );

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const ed = useEditorStore.getState();
      const doc = useDocStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (isTyping(e)) {
        // Undo/redo in a property field (size, colour...) undoes the document, not the field.
        const undo = mod && (key === "z" || key === "y") && !isFreeText(e);
        // Saving works from anywhere: what is being typed is already in the document.
        const saving = mod && key === "s";
        if (!undo && !saving) return;
        if (undo) (e.target as HTMLElement).blur();
      }
      const page = doc.doc.pages[ed.currentPage];

      if (mod) {
        const handled = (() => {
          switch (key) {
            case "z":
              if (e.shiftKey) doc.redo();
              else doc.undo();
              return true;
            case "y":
              doc.redo();
              return true;
            case "s":
              // A held key repeats: one save is enough.
              if (e.repeat) return true;
              if (e.shiftKey) setSaveAsOpen(true);
              else void save();
              return true;
            case "c":
              return copySelection() > 0;
            case "x":
              cutSelection();
              return true;
            case "v":
              paste();
              return true;
            case "d":
              if (ed.selection.length) ed.select(duplicateObjects(ed.selection));
              return true;
            case "a":
              if (!page) return false;
              ed.setTool("select");
              ed.select(doc.doc.objects.filter((o) => o.pageId === page.id && !(o.kind === "text" && o.replaces)).map((o) => o.id));
              return true;
            case "+":
            case "=":
              zoomViewerTo(ed.zoom * 1.2);
              return true;
            case "-":
              zoomViewerTo(ed.zoom / 1.2);
              return true;
            case "0":
              zoomViewerTo(1);
              return true;
            case "f":
              ed.setSidebar("search");
              return true;
            case "w":
              void leaveEditor();
              return true;
            case "tab":
              cycleTab(e.shiftKey ? -1 : 1);
              return true;
            case "o":
              void openMore();
              return true;
          }
          return false;
        })();
        if (handled) e.preventDefault();
        return;
      }

      switch (e.key) {
        case "Escape":
          if (ed.placing) ed.setPlacing(null);
          else if (ed.selection.length) ed.select([]);
          else ed.setTool("select");
          return;
        case "Delete":
        case "Backspace":
          if (ed.selection.length) {
            e.preventDefault();
            deleteObjects(ed.selection);
            ed.select([]);
          }
          return;
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown": {
          if (!ed.selection.length) return;
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          const objPage = doc.doc.pages.find((p) => doc.doc.objects.some((o) => o.pageId === p.id && ed.selection.includes(o.id)));
          nudge(objPage, ed.selection, dx, dy);
          return;
        }
        case "PageDown":
          e.preventDefault();
          ed.goToPage(Math.min(doc.doc.pages.length - 1, ed.currentPage + 1));
          return;
        case "PageUp":
          e.preventDefault();
          ed.goToPage(Math.max(0, ed.currentPage - 1));
          return;
        case "Home":
          ed.goToPage(0);
          return;
        case "End":
          ed.goToPage(doc.doc.pages.length - 1);
          return;
      }
      if (!e.altKey && !e.shiftKey) {
        const b = TOOL_SHORTCUTS[key];
        if (b) {
          e.preventDefault();
          activateTool(b);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  // Clicking empty page space or the grey background clears the selection.
  const onViewerPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-object-id],[data-handle],.annotationLayer section")) return;
    const ed = useEditorStore.getState();
    if (ed.tool === "select" && ed.selection.length) ed.select([]);
  };

  const openExternal = useCallback(async (url: string) => {
    if (!/^https?:|^mailto:/i.test(url)) return;
    const ok = await confirmDialog({ title: t("Abrir enlace externo"), message: url, confirmLabel: t("Abrir") });
    if (!ok) return;
    try {
      await platform.openExternalUrl(url);
    } catch (err) {
      toast.error(t("No se pudo abrir el enlace"), { description: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  // Immersive reading mode (phone): any interaction that needs the chrome brings it back.
  const exitImmersive = useCallback(() => useEditorStore.getState().setImmersive(false), []);
  useEscapeLayer(immersive, exitImmersive);
  const leaves = (tool !== "select" && tool !== "hand") || !!placing || hasSelection || thumbnails || showProps || toolsPanel || !!sidebar;
  useEffect(() => {
    if (leaves || !mobile) exitImmersive();
  }, [leaves, mobile, exitImmersive]);
  useEffect(() => {
    exitImmersive();
  }, [activeTab, exitImmersive]);

  // Phone text selection ends with a tool change, a drawer/sheet or another document.
  useEffect(() => {
    clearTouchSelection();
  }, [tool, placing, sidebar, toolsPanel, thumbnails, showProps, activeTab]);

  const textInteractive = (tool === "select" || tool === "highlight") && !placing;
  const formsInteractive = tool === "select" && !placing;

  const phoneHeader = (
    <AppHeader
      phoneHideSettings
      phoneLeading={<IconButton icon={ArrowLeft} label={t("Inicio")} onClick={() => useAppStore.getState().navigate({ name: "home" })} />}
      right={
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t("Guardar")}
            onClick={() => void save()}
            className="grid size-10 place-items-center rounded-full bg-primary text-on-primary outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-brand-500/50 active:bg-primary-hover"
          >
            <Save size={20} />
          </button>
          <Menu
            align="end"
            trigger={<IconButton icon={EllipsisVertical} label={t("Más opciones")} />}
            items={[
              { id: "organize", label: t("Organizar páginas"), icon: LayoutGrid, onSelect: () => useAppStore.getState().navigate({ name: "organize" }) },
              { id: "saveas", label: t("Guardar como…"), icon: Save, onSelect: () => setSaveAsOpen(true) },
              { id: "settings", label: t("Preferencias"), icon: Settings, onSelect: openSettings },
              { type: "separator" },
              { id: "close", label: t("Cerrar documento"), icon: X, onSelect: () => void leaveEditor() },
            ]}
          />
        </div>
      }
    />
  );

  const header = mobile ? phoneHeader : (
      <AppHeader
        right={
          <div className="flex items-center gap-1.5 max-md:gap-1">
            <Button
              size="sm"
              variant="ghost"
              icon={LayoutGrid}
              aria-label={t("Organizar")}
              onClick={() => useAppStore.getState().navigate({ name: "organize" })}
              className="max-md:size-9 max-md:px-0"
            >
              <span className="max-md:hidden">{t("Organizar")}</span>
            </Button>
            <div className="flex">
              <Button size="sm" variant="primary" icon={Save} aria-label={t("Guardar")} onClick={() => void save()} className="rounded-r-none max-md:size-9 max-md:px-0">
                <span className="max-md:hidden">{t("Guardar")}</span>
              </Button>
              <Menu
                align="end"
                trigger={<Button size="sm" variant="primary" icon={ChevronDown} aria-label={t("Más opciones de guardado")} className="rounded-l-none border-l border-white/25 px-1.5 max-md:h-9 max-md:w-8 max-md:justify-center max-md:px-0" />}
                items={[
                  { id: "saveas", label: t("Guardar como…"), shortcut: "Ctrl+Mayús+S", onSelect: () => setSaveAsOpen(true) },
                  { type: "separator" },
                  { id: "close", label: t("Cerrar documento"), icon: X, onSelect: () => void leaveEditor() },
                ]}
              />
            </div>
          </div>
        }
      />
  );

  return (
    <div className={cn("flex h-full flex-col", mobile && "relative")}>
      {mobile ? (
        <div
          inert={immersive}
          className={cn(
            "absolute inset-x-0 top-0 z-20 transition-transform duration-200 motion-reduce:transition-none",
            immersive && "-translate-y-full",
          )}
        >
          {header}
        </div>
      ) : (
        header
      )}
      {!mobile && <EditorToolbar />}
      <div className="flex min-h-0 flex-1">
        <ToolsPanel />
        <Sidebar />
        <div className="relative flex min-w-0 flex-1 flex-col" onPointerDown={onViewerPointerDown}>
          <Viewer
            className="min-h-0 flex-1"
            insets={mobile ? (short ? insetsShort : insetsTall) : undefined}
            onTap={mobile ? () => useEditorStore.getState().setImmersive(!useEditorStore.getState().immersive) : undefined}
            textInteractive={textInteractive}
            formsInteractive={formsInteractive}
            onOpenExternal={(u) => void openExternal(u)}
            overlay={(page, index, geom) => <PageOverlay page={page} index={index} geom={geom} />}
            underlay={(page, geom) => <Underlay page={page} geom={geom} />}
          />
          {mobile ? (
            <PhoneViewerOverlays />
          ) : (
            <div className="flex h-9 shrink-0 items-center gap-2 border-t border-line bg-surface px-2 text-xs text-muted">
              <span>{t("Página")}</span>
              <NumberField
                value={current + 1}
                min={1}
                max={pageCount}
                onChange={(n) => useEditorStore.getState().goToPage(Math.min(pageCount, Math.max(1, Math.round(n))) - 1)}
                className="w-16"
                inputClassName="h-7 text-xs"
              />
              <span>{t("de {total}", { total: pageCount })}</span>
              {placing && (
                <span className="ml-3 min-w-0 truncate text-brand-600 dark:text-brand-300">
                  {t("Haz clic en la página para colocar · Esc para cancelar")}
                </span>
              )}
              <span className="ml-auto" />
              <IconButton
                size="sm"
                icon={Files}
                label={thumbnails && showProps ? t("Ocultar miniaturas de páginas") : t("Mostrar miniaturas de páginas")}
                active={thumbnails && showProps}
                onClick={() => {
                  const ed = useEditorStore.getState();
                  if (ed.thumbnails && ed.showProps) ed.setThumbnails(false);
                  else {
                    ed.setThumbnails(true);
                    if (!ed.showProps) ed.toggleProps();
                  }
                }}
              />
              <IconButton size="sm" icon={PanelRight} label={showProps ? t("Ocultar propiedades") : t("Mostrar propiedades")} active={showProps} onClick={() => useEditorStore.getState().toggleProps()} />
            </div>
          )}
        </div>
        <PropertiesPanel />
      </div>
      {mobile && <EditorToolbar hidden={immersive} />}

      <SignatureDialog
        open={signatureOpen}
        onClose={() => useEditorStore.getState().setSignatureDialog(false)}
        onSelect={(sig) => placeSignature(sig)}
      />
      <SaveDialog open={saveAsOpen} onClose={() => setSaveAsOpen(false)} hasForm={hasForm} />
    </div>
  );
}
