import { filesToPicked, platform } from "@/platform";
import { useAppStore, type RecentFile } from "@/model/appStore";
import { openDocuments, openRecent } from "@/model/workspace";
import { toast } from "@/ui";

/** Every home action reports failures as a toast instead of throwing into the UI. */
function reportError(err: unknown): void {
  toast.error(err instanceof Error ? err.message : String(err));
}

/** "Abrir PDF": ask for one or more PDFs and open them in the editor. */
export async function pickAndOpenPdfs(): Promise<void> {
  try {
    const files = await platform.openFiles({ kinds: ["pdf"], multiple: true });
    if (files.length > 0) await openDocuments(files, { view: "editor" });
  } catch (err) {
    reportError(err);
  }
}

/** Files dropped from the OS (drop zone or anywhere on the window). */
export async function openDroppedFiles(files: File[]): Promise<void> {
  try {
    await openDocuments(await filesToPicked(files), { view: "editor" });
  } catch (err) {
    reportError(err);
  }
}

/** Re-opens a recent file; a file that can no longer be read is dropped from the list. */
export async function openRecentFile(file: RecentFile): Promise<void> {
  try {
    await openRecent(file.path);
  } catch (err) {
    reportError(err);
    useAppStore.getState().removeRecent(file.path);
  }
}
