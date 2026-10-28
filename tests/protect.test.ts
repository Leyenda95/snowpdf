import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { protectPdf } from "@/pdf/protect";
import { decrypt, extractText, inspect } from "@/pdf/mupdf/ops";

async function sample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText("Confidencial", { x: 50, y: 700, size: 20, font });
  return doc.save();
}

describe("protectPdf", () => {
  it("encrypts with AES-256 so it needs the password, and keeps the content", async () => {
    const enc = await protectPdf(await sample(), { userPassword: "clave, con coma", ownerPassword: "jefe" });
    expect(inspect(enc)).toMatchObject({ needsPassword: true });
    const m = mupdf.Document.openDocument(enc, "application/pdf");
    expect(m.authenticatePassword("mala")).toBe(0);
    expect(m.authenticatePassword("clave, con coma")).toBeGreaterThan(0);
    expect(m.getMetaData(mupdf.Document.META_ENCRYPTION)).toMatch(/AES/i);
    expect(extractText(decrypt(enc, "clave, con coma"))[0]).toContain("Confidencial");
  });

  it("can restrict permissions without an open password", async () => {
    const enc = await protectPdf(await sample(), {
      userPassword: "",
      ownerPassword: "jefe",
      permissions: { printing: "none", copying: false, modifying: false, annotating: false, fillingForms: true, assembling: false },
    });
    const m = mupdf.Document.openDocument(enc, "application/pdf");
    expect(m.needsPassword()).toBe(false);
    expect(m.hasPermission("print")).toBe(false);
    expect(m.hasPermission("copy")).toBe(false);
  });

  it("rejects an empty configuration", async () => {
    await expect(protectPdf(await sample(), { userPassword: "" })).rejects.toThrow();
  });
});
