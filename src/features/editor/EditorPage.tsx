import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Files, LayoutGrid, PanelRight, Save, X } from "lucide-react";
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
import { Button, IconButton, Menu, NumberField, confirmDialog, useWindowFileDrop } from "@/ui";
import { handleDroppedFiles } from "./askDropAction";
import { useEditorStore } from "./editorStore";
import { EditorToolbar, TOOL_SHORTCUTS, activateTool } from "./EditorToolbar";
import { Sidebar } from "./Sidebar";
import { ToolsPanel } from "./tools/ToolsPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { SaveDialog } from "./SaveDialog";
import { Viewer, zoomViewerTo } from "./viewer/Viewer";
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
  const [saveAsOpen, setSaveAsOpen] = useState(false);

  const save = useCallback(() => saveWorkspace(quickSaveOptions()), []);

  // Drop files anywhere: insert their pages after the current one.
  useWindowFileDrop(async (files) => {
    await handleDroppedFiles(files, {
      currentPage: useEditorStore.getState().currentPage,
      pageCount: useDocStore.getState().doc.pages.length,
    });
  }, ["pdf", "png", "jpg", "jpeg", "webp", "gif", "bmp"]);

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
        if (!(mod && (key === "z" || key === "y")) || isFreeText(e)) return;
        (e.target as HTMLElement).blur();
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
              ed.select(doc.doc.objects.filter((o) => o.pageId === page.id).map((o) => o.id));
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
    if (ok) window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const textInteractive = (tool === "select" || tool === "highlight") && !placing;
  const formsInteractive = tool === "select" && !placing;

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        right={
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" icon={LayoutGrid} onClick={() => useAppStore.getState().navigate({ name: "organize" })}>
              {t("Organizar")}
            </Button>
            <div className="flex">
              <Button size="sm" variant="primary" icon={Save} onClick={() => void save()} className="rounded-r-none">
                {t("Guardar")}
              </Button>
              <Menu
                align="end"
                trigger={<Button size="sm" variant="primary" icon={ChevronDown} aria-label={t("Más opciones de guardado")} className="rounded-l-none border-l border-white/25 px-1.5" />}
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
      <EditorToolbar />
      <div className="flex min-h-0 flex-1">
        <ToolsPanel />
        <Sidebar />
        <div className="relative flex min-w-0 flex-1 flex-col" onPointerDown={onViewerPointerDown}>
          <Viewer
            className="min-h-0 flex-1"
            textInteractive={textInteractive}
            formsInteractive={formsInteractive}
            onOpenExternal={(u) => void openExternal(u)}
            overlay={(page, index, geom) => <PageOverlay page={page} index={index} geom={geom} />}
            underlay={(page, geom) => <Underlay page={page} geom={geom} />}
          />
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
            {placing && <span className="ml-3 text-brand-600 dark:text-brand-300">{t("Haz clic en la página para colocar · Esc para cancelar")}</span>}
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
        </div>
        <PropertiesPanel />
      </div>

      <SignatureDialog
        open={signatureOpen}
        onClose={() => useEditorStore.getState().setSignatureDialog(false)}
        onSelect={(sig) => placeSignature(sig)}
      />
      <SaveDialog open={saveAsOpen} onClose={() => setSaveAsOpen(false)} hasForm={hasForm} />
    </div>
  );
}
