import { loadPdf } from "./docUtils";
import { t } from "@/i18n";

/** Password protection (AES-256, like Acrobat's highest compatibility setting). */

export interface Permissions {
  printing: "high" | "low" | "none";
  copying: boolean;
  modifying: boolean;
  annotating: boolean;
  fillingForms: boolean;
  assembling: boolean;
}

export const ALL_PERMISSIONS: Permissions = {
  printing: "high",
  copying: true,
  modifying: true,
  annotating: true,
  fillingForms: true,
  assembling: true,
};

export interface ProtectOptions {
  /** Needed to open the file. Empty = anyone can open it but permissions apply. */
  userPassword: string;
  /** Needed to change permissions; defaults to the user password. */
  ownerPassword?: string;
  permissions?: Permissions;
}

export async function protectPdf(bytes: Uint8Array, opts: ProtectOptions): Promise<Uint8Array> {
  if (!opts.userPassword && !opts.ownerPassword) throw new Error(t("Indica al menos una contraseña."));
  const p = opts.permissions ?? ALL_PERMISSIONS;
  const doc = await loadPdf(bytes);
  doc.encrypt({
    userPassword: opts.userPassword,
    ownerPassword: opts.ownerPassword || opts.userPassword,
    algorithm: "AES-256",
    permissions: {
      printing: p.printing === "high" ? "highResolution" : p.printing === "low" ? "lowResolution" : false,
      copying: p.copying,
      modifying: p.modifying,
      annotating: p.annotating,
      fillingForms: p.fillingForms,
      contentAccessibility: true,
      documentAssembly: p.assembling,
    },
  });
  return doc.save({ useObjectStreams: false });
}
