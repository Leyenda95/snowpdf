import { Combine, EyeOff, ImagePlus, MousePointer2, Signature, TextCursorInput, type LucideIcon } from "lucide-react";
import { useAppStore } from "@/model/appStore";
import { openDocuments } from "@/model/workspace";
import { platform } from "@/platform";
import { useEditorStore, type EditorTool } from "@/features/editor/editorStore";
import { DOC_TOOLS, GROUP_ICON_CLASSES, GROUP_LABELS, type DocToolGroup } from "@/features/editor/tools/catalog";
import type { BatchToolId } from "@/features/tools/registry";
import { toast } from "@/ui";
import { t, type Msg } from "@/i18n";

/**
 * Home sidebar: tools for doing one thing. Editor tools and the editor's "Herramientas" entries
 * first ask for a PDF and open it on that tool; tools that start from several files have their
 * own page.
 */

export interface HomeToolEntry {
  id: string;
  label: Msg;
  icon: LucideIcon;
  iconClass: string;
  group: Msg;
  keywords: Msg[];
  run(): Promise<void>;
}

/** Ask for one PDF and open it in the editor; false if nothing was opened. */
async function pickOne(title: string): Promise<boolean> {
  try {
    const files = await platform.openFiles({ kinds: ["pdf"], multiple: false, title });
    if (files.length === 0) return false;
    await openDocuments(files, { view: "editor" });
    return useAppStore.getState().view.name === "editor";
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err));
    return false;
  }
}

function editorTool(id: string, label: Msg, icon: LucideIcon, tool: EditorTool, keywords: Msg[]): HomeToolEntry {
  return {
    id, label, icon, keywords,
    group: "Editar y firmar",
    iconClass: "text-brand-600 dark:text-brand-300",
    run: async () => {
      if (!(await pickOne(t(label)))) return;
      const ed = useEditorStore.getState();
      ed.setTool(tool);
      if (tool === "signature") ed.setSignatureDialog(true);
    },
  };
}

function batchTool(id: BatchToolId, label: Msg, icon: LucideIcon, keywords: Msg[]): HomeToolEntry {
  return {
    id, label, icon, keywords,
    group: "Crear",
    iconClass: "text-violet-600 dark:text-violet-300",
    run: async () => useAppStore.getState().navigate({ name: "tool", toolId: id }),
  };
}

const GROUP_ORDER: DocToolGroup[] = ["paginas", "proteger", "optimizar", "convertir", "marcas"];

/** Entries that only make sense with a document already open. */
const EDITOR_ONLY = new Set(["insert"]);

export const HOME_TOOLS: HomeToolEntry[] = [
  editorTool("edit", "Editar PDF", TextCursorInput, "editText", ["texto", "modificar", "cambiar"]),
  editorTool("sign", "Firmar PDF", Signature, "signature", ["firma", "rubricar"]),
  editorTool("fill", "Rellenar formulario", MousePointer2, "select", ["formulario", "campos", "rellenar"]),
  editorTool("redact", "Redactar PDF", EyeOff, "redact", ["tachar", "ocultar", "eliminar", "censurar"]),

  batchTool("merge", "Unir PDF", Combine, ["combinar", "juntar", "fusionar"]),
  batchTool("images-to-pdf", "Imágenes a PDF", ImagePlus, ["jpg", "png", "foto", "convertir"]),

  ...GROUP_ORDER.flatMap((group) =>
    DOC_TOOLS.filter((tool) => tool.group === group && !EDITOR_ONLY.has(tool.id)).map(
      (tool): HomeToolEntry => ({
        id: tool.id,
        label: tool.label,
        icon: tool.icon,
        iconClass: GROUP_ICON_CLASSES[tool.group],
        group: GROUP_LABELS[tool.group],
        keywords: tool.keywords,
        run: async () => {
          if (await pickOne(t(tool.label))) useEditorStore.getState().requestDocTool(tool.id);
        },
      }),
    ),
  ),
];

/** Case- and accent-insensitive search over label, group and keywords, in Spanish and in the current language. */
export function matchesHomeQuery(entry: HomeToolEntry, query: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const q = norm(query.trim());
  if (q === "") return true;
  const words = [entry.label, entry.group, ...entry.keywords];
  const hay = norm([...words, ...words.map((w) => t(w))].join(" "));
  return q.split(/\s+/).every((w) => hay.includes(w));
}
