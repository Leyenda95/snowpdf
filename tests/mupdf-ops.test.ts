import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { PDFDocument, StandardFonts, degrees } from "@cantoo/pdf-lib";
import { PdfPasswordError, compress, decrypt, extractText, inspect, redact, renderPages, repair } from "@/pdf/mupdf/ops";

async function textPdf(rotation = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.setRotation(degrees(rotation));
  page.drawText("SECRETO-1234", { x: 50, y: 700, size: 20, font });
  page.drawText("Texto publico", { x: 50, y: 600, size: 20, font });
  return doc.save();
}

/** A large, noisy PNG made with MuPDF so the compressor has real work to do. */
function bigPng(w: number, h: number): Uint8Array {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
  const px = pix.getPixels();
  let seed = 7;
  for (let i = 0; i < px.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    px[i] = ((i % (w * 3)) / 3 + (seed % 40)) & 255;
  }
  const png = pix.asPNG().slice();
  pix.destroy();
  return png;
}

describe("mupdf ops", () => {
  it("redacts text for real on an unrotated page", async () => {
    const out = redact(await textPdf(0), [{ pageIndex: 0, box: [45, 690, 220, 722], mode: "redact" }]);
    const [text] = extractText(out);
    expect(text).not.toContain("SECRETO");
    expect(text).toContain("Texto publico");
  });

  it("redacts using user-space boxes on a rotated page", async () => {
    const out = redact(await textPdf(90), [{ pageIndex: 0, box: [45, 690, 220, 722], mode: "replace" }]);
    const [text] = extractText(out);
    expect(text).not.toContain("SECRETO");
    expect(text).toContain("Texto publico");
  });

  it("detects encryption and decrypts with the right password only", async () => {
    const doc = await PDFDocument.load(await textPdf());
    doc.encrypt({ userPassword: "a,b=c", ownerPassword: "owner" });
    const enc = await doc.save();
    expect(inspect(enc)).toMatchObject({ needsPassword: true, encrypted: true });
    expect(() => decrypt(enc, "wrong")).toThrow(PdfPasswordError);
    const plain = decrypt(enc, "a,b=c");
    expect(inspect(plain)).toMatchObject({ needsPassword: false, encrypted: false, pageCount: 1 });
    expect(extractText(plain)[0]).toContain("SECRETO");
  });

  it("recompresses oversized images and keeps the document valid", async () => {
    const doc = await PDFDocument.create();
    const img = await doc.embedPng(bigPng(2400, 1600));
    const page = doc.addPage([595, 842]);
    page.drawImage(img, { x: 20, y: 300, width: 555, height: 370 });
    const bytes = await doc.save();
    const res = compress(bytes, "medium");
    expect(res.recompressed).toBe(1);
    expect(res.bytes.length).toBeLessThan(bytes.length * 0.5);
    expect(inspect(res.bytes).pageCount).toBe(1);
  });

  it("renders pages to PNG at the requested dpi", async () => {
    const [p] = renderPages(await textPdf(90), { pages: [0], dpi: 72, format: "png" });
    expect([p.width, p.height]).toEqual([842, 595]);
    expect(Array.from(p.bytes.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]);
  });

  it("repairs a file with a broken cross-reference table", async () => {
    const bytes = await PDFDocument.create().then(async (d) => {
      d.addPage();
      return d.save({ useObjectStreams: false });
    });
    const text = new TextDecoder("latin1").decode(bytes).replace(/startxref\s+\d+/, "startxref\n99999");
    const broken = Uint8Array.from(text, (c) => c.charCodeAt(0));
    const res = repair(broken);
    expect(res.repaired).toBe(true);
    expect(inspect(res.bytes).pageCount).toBe(1);
  });
});
