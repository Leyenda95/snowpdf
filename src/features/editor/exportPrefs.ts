import { create } from "zustand";

/** Per-session export choices shared by the properties panel and the save dialog. */
interface ExportPrefs {
  flattenForms: boolean;
  set(patch: Partial<Omit<ExportPrefs, "set">>): void;
}

export const useExportPrefs = create<ExportPrefs>((set) => ({
  flattenForms: false,
  set: (patch) => set(patch),
}));
