import {
  Crop,
  FileOutput,
  FilePlus,
  Images,
  LayoutGrid,
  Layers,
  ListOrdered,
  Lock,
  Minimize2,
  RotateCw,
  Scissors,
  Search,
  Stamp,
  Tags,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useAppStore } from "@/model/appStore";
import { rotatePages } from "@/model/docActions";
import { useDocStore } from "@/model/docStore";
import { addFilesToWorkspace } from "@/model/workspace";
import { parsePageSelection } from "@/pdf/ranges";
import { platform } from "@/platform";
import type { BatchToolId } from "@/features/tools/registry";
import { messageOf } from "@/features/tools/utils";
import { promptDialog, toast } from "@/ui";
import { useEditorStore } from "../editorStore";
import { extractPages } from "../save";
import type { DocToolMode } from "./runDocTool";
import { t, type Msg } from "@/i18n";

/** Entries of the editor's "Herramientas" pane, grouped like Acrobat's "All tools". */

export type DocToolGroup = "paginas" | "proteger" | "optimizar" | "convertir" | "marcas";

export const GROUP_LABELS: Record<DocToolGroup, Msg> = {
  paginas: "Organizar páginas",
  proteger: "Proteger",
  optimizar: "Optimizar",
  convertir: "Convertir",
  marcas: "Marcas y páginas",
};

/** Static map: Tailwind only generates classes it can read literally. */
export const GROUP_ICON_CLASSES: Record<DocToolGroup, string> = {
  paginas: "text-orange-600 dark:text-orange-300",
  proteger: "text-sky-600 dark:text-sky-300",
  optimizar: "text-emerald-600 dark:text-emerald-300",
  convertir: "text-amber-600 dark:text-amber-300",
  marcas: "text-fuchsia-600 dark:text-fuchsia-300",
};

interface EntryBase {
  id: string;
  label: Msg;
  icon: LucideIcon;
  group: DocToolGroup;
  /** Extra words for the search box. */
  keywords: Msg[];
}

/** Runs immediately: selects an editor tool, opens a dialog or another view. */
export interface ActionEntry extends EntryBase {
  kind: "action";
  run(): void | Promise<void>;
}

/** Shows the options of a batch tool module in the pane and runs it on the open document. */
export interface ModuleEntry extends EntryBase {
  kind: "module";
  toolId: BatchToolId;
  /** "replace": the result becomes the document (undoable). "save": written as new file(s). */
  mode: DocToolMode;
  /** One line under the title explaining what happens to the document. */
  description: Msg;
  actionLabel?: Msg;
  /** Apply directly to the page list instead of running the module (instant, keeps edits). */
  applyInModel?(options: unknown): boolean;
}

export type DocToolEntry = ActionEntry | ModuleEntry;


async function insertFromFiles(): Promise<void> {
  try {
    const files = await platform.openFiles({ kinds: ["pdf", "image"], multiple: true, title: t("Insertar páginas") });
    if (files.length === 0) return;
    const at = useEditorStore.getState().currentPage + 1;
    const added = await addFilesToWorkspace(files, at);
    if (added > 0) {
      toast.success(t(added === 1 ? "{n} página insertada" : "{n} páginas insertadas", { n: added }), { description: t("Después de la página {n}.", { n: at }) });
      useEditorStore.getState().goToPage(at);
    }
  } catch (err) {
    toast.error(t("No se pudieron insertar las páginas"), { description: messageOf(err) });
  }
}

async function extractFromPrompt(): Promise<void> {
  const pages = useDocStore.getState().doc.pages;
  if (pages.length === 0) return;
  const validate = (v: string): string | null => {
    if (v.trim() === "") return t("Indica las páginas.");
    try {
      parsePageSelection(v, pages.length);
      return null;
    } catch (err) {
      return messageOf(err);
    }
  };
  const input = await promptDialog({
    title: t("Extraer páginas"),
    message: t(pages.length === 1 ? "Se guardarán en un PDF nuevo. El documento tiene {n} página." : "Se guardarán en un PDF nuevo. El documento tiene {n} páginas.", { n: pages.length }),
    label: t("Páginas"),
    placeholder: "1-3, 5",
    defaultValue: String(useEditorStore.getState().currentPage + 1),
    confirmLabel: t("Extraer"),
    validate,
  });
  if (input === null) return;
  const ids = parsePageSelection(input, pages.length).map((i) => pages[i].id);
  await extractPages(ids);
}

function rotateInModel(options: unknown): boolean {
  const o = options as { angle: "90" | "180" | "270"; pages: string };
  const pages = useDocStore.getState().doc.pages;
  const ids = parsePageSelection(o.pages, pages.length).map((i) => pages[i].id);
  if (ids.length === 0) return false;
  rotatePages(ids, Number(o.angle) as 90 | 180 | 270);
  toast.success(t(ids.length === 1 ? "{n} página girada" : "{n} páginas giradas", { n: ids.length }), { description: t("Puedes deshacerlo con Ctrl+Z.") });
  return true;
}

export const DOC_TOOLS: DocToolEntry[] = [
  // Organizar páginas
  { id: "organize", kind: "action", group: "paginas", icon: LayoutGrid, label: "Organizar páginas", keywords: ["ordenar", "mover", "borrar", "eliminar", "duplicar"], run: () => useAppStore.getState().navigate({ name: "organize" }) },
  {
    id: "rotate", kind: "module", toolId: "rotate", mode: "replace", group: "paginas", icon: RotateCw, label: "Rotar páginas", keywords: ["girar", "orientación"],
    description: "Gira las páginas del documento abierto. Puedes deshacerlo con Ctrl+Z.", actionLabel: "Rotar", applyInModel: rotateInModel,
  },
  { id: "insert", kind: "action", group: "paginas", icon: FilePlus, label: "Insertar páginas", keywords: ["añadir", "combinar", "unir", "archivo"], run: insertFromFiles },
  { id: "extract", kind: "action", group: "paginas", icon: FileOutput, label: "Extraer páginas", keywords: ["sacar", "copiar", "separar"], run: extractFromPrompt },
  {
    id: "split", kind: "module", toolId: "split", mode: "save", group: "paginas", icon: Scissors, label: "Dividir", keywords: ["separar", "partir", "rangos"],
    description: "Guarda partes del documento como archivos nuevos. El documento abierto no cambia.",
  },

  // Proteger
  {
    id: "protect", kind: "module", toolId: "protect", mode: "save", group: "proteger", icon: Lock, label: "Proteger con contraseña", keywords: ["cifrar", "bloquear", "contraseña"],
    description: "Guarda una copia cifrada del documento con sus cambios. El documento abierto no cambia.", actionLabel: "Proteger y guardar",
  },
  {
    id: "find-redact", kind: "action", group: "proteger", icon: Search, label: "Buscar datos sensibles", keywords: ["dni", "email", "teléfono", "iban", "redactar"],
    run: () => useEditorStore.getState().setSidebar("search"),
  },
  {
    id: "metadata", kind: "module", toolId: "metadata", mode: "replace", group: "proteger", icon: Tags, label: "Metadatos", keywords: ["propiedades", "autor", "título", "quitar"],
    description: "Cambia o borra el título, autor y demás datos del documento. Puedes deshacerlo con Ctrl+Z.", actionLabel: "Aplicar metadatos",
  },

  // Optimizar
  {
    id: "compress", kind: "module", toolId: "compress", mode: "replace", group: "optimizar", icon: Minimize2, label: "Comprimir", keywords: ["reducir", "tamaño", "peso"],
    description: "Reduce el tamaño del documento abierto. Puedes deshacerlo con Ctrl+Z.", actionLabel: "Comprimir",
  },
  {
    id: "flatten", kind: "module", toolId: "flatten", mode: "replace", group: "optimizar", icon: Layers, label: "Aplanar formularios", keywords: ["fijar", "anotaciones", "campos"],
    description: "Puedes deshacerlo con Ctrl+Z.", actionLabel: "Aplanar",
  },
  {
    id: "repair", kind: "module", toolId: "repair", mode: "replace", group: "optimizar", icon: Wrench, label: "Reparar", keywords: ["arreglar", "dañado", "corrupto"],
    description: "Reconstruye el documento abierto. Puedes deshacerlo con Ctrl+Z.", actionLabel: "Reparar",
  },

  // Convertir
  {
    id: "to-images", kind: "module", toolId: "pdf-to-images", mode: "save", group: "convertir", icon: Images, label: "Exportar como imágenes", keywords: ["jpg", "png", "convertir"],
    description: "Guarda las páginas como imágenes. El documento abierto no cambia.", actionLabel: "Exportar imágenes",
  },

  // Marcas y páginas
  {
    id: "watermark", kind: "module", toolId: "watermark", mode: "replace", group: "marcas", icon: Stamp, label: "Marca de agua", keywords: ["sello", "logo", "confidencial"],
    description: "Estampa la marca en el documento abierto. Puedes deshacerlo con Ctrl+Z.",
  },
  {
    id: "page-numbers", kind: "module", toolId: "page-numbers", mode: "replace", group: "marcas", icon: ListOrdered, label: "Numerar páginas", keywords: ["numeración", "pie", "encabezado"],
    description: "Añade los números al documento abierto. Puedes deshacerlo con Ctrl+Z.",
  },
  {
    id: "crop", kind: "module", toolId: "crop", mode: "replace", group: "marcas", icon: Crop, label: "Recortar márgenes", keywords: ["márgenes", "recorte"],
    description: "Recorta las páginas del documento abierto. Puedes deshacerlo con Ctrl+Z.",
  },
];

/** Case- and accent-insensitive search over label, group and keywords, in Spanish and in the current language. */
export function matchesQuery(entry: DocToolEntry, query: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const q = norm(query.trim());
  if (q === "") return true;
  const words = [entry.label, GROUP_LABELS[entry.group], ...entry.keywords];
  const hay = norm([...words, ...words.map((w) => t(w))].join(" "));
  return q.split(/\s+/).every((w) => hay.includes(w));
}
