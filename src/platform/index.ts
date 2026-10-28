import { isTauri } from "@tauri-apps/api/core";
import { browserPlatform, filesToPicked } from "./browser";
import { tauriPlatform } from "./tauri";
import type { Platform } from "./types";

export * from "./types";
export { filesToPicked };

export const platform: Platform = isTauri() ? tauriPlatform : browserPlatform;
