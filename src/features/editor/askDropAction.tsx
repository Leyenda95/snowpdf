import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { filesToPicked } from "@/platform";
import { addFilesToWorkspace, openDocuments } from "@/model/workspace";
import { usePrefs } from "@/model/prefs";
import { Button, Modal, SegmentedControl } from "@/ui";
import { t } from "@/i18n";

export type DropAction = { kind: "tab" } | { kind: "insert"; at: number };

export interface DropContext {
  /** Zero-based index of the page the user is on. */
  currentPage: number;
  pageCount: number;
}

type Position = "after" | "start" | "end";
type Choice = "tab" | "insert";

function isPdf(f: File): boolean {
  return f.type === "application/pdf" || /\.pdf$/i.test(f.name);
}

function DropActionDialog({
  files,
  ctx,
  onDone,
}: {
  files: File[];
  ctx: DropContext;
  onDone: (action: DropAction | null) => void;
}) {
  const hasPdf = files.some(isPdf);
  const [position, setPosition] = useState<Position>("after");
  const primaryRef = useRef<HTMLButtonElement>(null);
  const subject = files.length === 1 ? files[0].name : t("{n} archivos", { n: files.length });

  const insertAt = (p: Position) => (p === "start" ? 0 : p === "end" ? ctx.pageCount : ctx.currentPage + 1);
  const choose = (choice: Choice) => onDone(choice === "tab" ? { kind: "tab" } : { kind: "insert", at: insertAt(position) });

  return (
    <Modal
      open
      size="sm"
      title={t("¿Qué quieres hacer con {subject}?", { subject })}
      onClose={() => onDone(null)}
      initialFocusRef={primaryRef}
      footer={<Button onClick={() => onDone(null)}>{t("Cancelar")}</Button>}
    >
      <div className="flex flex-col gap-4">
        {hasPdf && (
          <Button ref={primaryRef} variant="primary" onClick={() => choose("tab")}>
            {t("Abrir en una pestaña nueva")}
          </Button>
        )}
        <div className="flex flex-col gap-2">
          <SegmentedControl<Position>
            label={t("Insertar en este documento")}
            fullWidth
            size="sm"
            value={position}
            onChange={setPosition}
            options={[
              { value: "after", label: t("Después de la página {n}", { n: ctx.currentPage + 1 }) },
              { value: "start", label: t("Al inicio") },
              { value: "end", label: t("Al final") },
            ]}
          />
          <Button ref={hasPdf ? undefined : primaryRef} variant={hasPdf ? "secondary" : "primary"} onClick={() => choose("insert")}>
            {t("Insertar en este documento")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Asks, then applies the answer: PDFs open one tab each, or all files are inserted as pages. */
export async function handleDroppedFiles(files: File[], ctx: DropContext): Promise<void> {
  if (files.length === 0) return;
  // Settings may skip the question (opening in a tab needs at least one PDF).
  const mode = usePrefs.getState().dropAction;
  const action: DropAction | null =
    mode === "insert"
      ? { kind: "insert", at: ctx.currentPage + 1 }
      : mode === "tab" && files.some(isPdf)
        ? { kind: "tab" }
        : await askDropAction(files, ctx);
  if (!action) return;
  if (action.kind === "tab") {
    await openDocuments(await filesToPicked(files.filter(isPdf)), { view: "editor" });
  } else {
    await addFilesToWorkspace(await filesToPicked(files), action.at);
  }
}

/**
 * Asks what to do with files dropped onto an open document: open them in new tabs or insert
 * their pages. Resolves null when cancelled. Mounts its own React root, so no host is needed.
 */
export function askDropAction(files: File[], ctx: DropContext): Promise<DropAction | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (action: DropAction | null) => {
      resolve(action);
      window.setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
    };
    root.render(<DropActionDialog files={files} ctx={ctx} onDone={done} />);
  });
}
