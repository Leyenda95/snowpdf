import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { PDFDocument, StandardFonts, degrees, rgb } from "@cantoo/pdf-lib";
import { composeDocument } from "@/pdf/compose";
import { eraseRegion, redact as redactOp, renderPages } from "@/pdf/mupdf/ops";
import type { EraseObject, PageRef } from "@/model/types";
import { detectInk } from "@/pdf/inpaint";
import type { Pixel } from "./helpers";

const YELLOW: Pixel = [230, 199, 61];
const BLUE: Pixel = [60, 120, 200];

const color = ([r, g, b]: Pixel) => rgb(r / 255, g / 255, b / 255);

/** Page 300 x 200 with a coloured panel and a line of text on it. */
async function textOnPanel(fill: Pixel = YELLOW): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([300, 200]);
  page.drawRectangle({ x: 0, y: 0, width: 300, height: 200, color: color(fill) });
  page.drawText("HOLA MUNDO", { x: 40, y: 90, size: 28, font, color: rgb(0, 0, 0) });
  return doc.save();
}

/** The same "text" but drawn as filled shapes, the way converted-to-outlines text is stored. */
async function outlinedOnPanel(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  page.drawRectangle({ x: 0, y: 0, width: 300, height: 200, color: color(YELLOW) });
  // x, y = top-left corner of the path's own space (y down).
  const bar = (x: number, w: number, h: number) => `M ${x} 0 L ${x + w} 0 L ${x + w} ${h} L ${x} ${h} Z`;
  for (let i = 0; i < 6; i++) {
    page.drawSvgPath(bar(i * 20, 5, 24), { x: 40, y: 114, color: rgb(0, 0, 0) });
    page.drawSvgPath(bar(i * 20, 14, 5), { x: 40, y: 104, color: rgb(0, 0, 0) });
  }
  return doc.save();
}

/** A page whose only content is a picture of `source` (text included), like a scan. */
async function scanOf(source: Uint8Array): Promise<Uint8Array> {
  const [shot] = renderPages(source, { pages: [0], dpi: 150, format: "png" });
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(shot.bytes);
  doc.addPage([300, 200]).drawImage(image, { x: 0, y: 0, width: 300, height: 200 });
  return doc.save();
}

interface Decoded {
  width: number;
  height: number;
  pixel(x: number, y: number): Pixel;
}

function decode(png: Uint8Array): Decoded {
  const pix = new mupdf.Image(png).toPixmap();
  try {
    const n = pix.getNumberOfComponents() + pix.getAlpha();
    const stride = pix.getStride();
    const data = pix.getPixels().slice();
    return { width: pix.getWidth(), height: pix.getHeight(), pixel: (x, y) => [data[y * stride + x * n], data[y * stride + x * n + 1], data[y * stride + x * n + 2]] };
  } finally {
    pix.destroy();
  }
}

function near(a: Pixel, b: Pixel, tolerance: number): boolean {
  return a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
}

/** Fraction of the pixels of the picture (inside `margin` px of the edges excluded) that are not `target`. */
function offColor(img: Decoded, target: Pixel, tolerance: number, margin = 0): number {
  let off = 0;
  let total = 0;
  for (let y = margin; y < img.height - margin; y++) {
    for (let x = margin; x < img.width - margin; x++) {
      total++;
      if (!near(img.pixel(x, y), target, tolerance)) off++;
    }
  }
  return off / total;
}

// Zone of the text line, user space (the text is 28 pt, baseline at y = 90).
const TEXT_BOX: [number, number, number, number] = [36, 82, 235, 116];

describe("eraseRegion", () => {
  it("removes text from a coloured panel and shows the panel", async () => {
    const res = eraseRegion(await textOnPanel(), 0, TEXT_BOX);
    expect(res.method).toBe("text");
    expect(res.box).toEqual([35, 81, 236, 117]);
    const img = decode(res.png);
    expect(img.width).toBe(Math.ceil(201 * (150 / 72)));
    expect(near(img.pixel(Math.floor(img.width / 2), Math.floor(img.height / 2)), YELLOW, 8)).toBe(true);
    expect(offColor(img, YELLOW, 8)).toBeLessThan(0.002);
  });

  it("falls back to removing vector art when the text is outlines", async () => {
    const res = eraseRegion(await outlinedOnPanel(), 0, TEXT_BOX);
    expect(res.method).toBe("vector");
    expect(offColor(decode(res.png), YELLOW, 8)).toBeLessThan(0.002);
  });

  it("rebuilds the background when the text is part of an image", async () => {
    const scan = await scanOf(await textOnPanel(BLUE));
    const res = eraseRegion(scan, 0, TEXT_BOX);
    expect(res.method).toBe("pixels");
    const img = decode(res.png);
    // Patch is rendered at 300 dpi.
    expect(img.width).toBe(Math.ceil(201 * (300 / 72)));
    expect(offColor(img, BLUE, 12)).toBeLessThan(0.01);
  });

  it("does not go past the allowed method", async () => {
    const scan = await scanOf(await textOnPanel(BLUE));
    const res = eraseRegion(scan, 0, TEXT_BOX, { maxMethod: "text" });
    // Removing glyphs does nothing to a picture: nothing was erased, the text is still there.
    expect(res.method).toBe("none");
    expect(offColor(decode(res.png), BLUE, 12)).toBeGreaterThan(0.02);
  });

  it("renders upright in user space on a page with /Rotate", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const sheet = doc.addPage([300, 200]);
    sheet.setRotation(degrees(90));
    sheet.drawRectangle({ x: 0, y: 0, width: 130, height: 200, color: color(YELLOW) });
    sheet.drawText("HOLA MUNDO", { x: 40, y: 90, size: 28, font, color: rgb(0, 0, 0) });
    const res = eraseRegion(await doc.save(), 0, TEXT_BOX);
    expect(res.method).toBe("text");
    const img = decode(res.png);
    // Left of the picture = low x in the file, whatever the page rotation.
    expect(near(img.pixel(5, Math.floor(img.height / 2)), YELLOW, 8)).toBe(true);
    expect(near(img.pixel(img.width - 5, Math.floor(img.height / 2)), [255, 255, 255], 8)).toBe(true);
  });

  it("reports nothing to erase on an empty zone", async () => {
    const res = eraseRegion(await textOnPanel(), 0, [40, 150, 200, 190]);
    expect(res.method).toBe("none");
    expect(offColor(decode(res.png), YELLOW, 8)).toBeLessThan(0.001);
  });
});

// ------------------------------------------------------------------ export

function eraseObject(pageId: string, method: EraseObject["method"], res?: ReturnType<typeof eraseRegion>, assetId: string | null = null): EraseObject {
  const [x0, y0, x1, y1] = TEXT_BOX;
  return {
    id: "e1",
    pageId,
    kind: "erase",
    frame: { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, rot: 0 },
    opacity: 1,
    method,
    assetId,
    renderBox: res?.box ?? null,
  };
}

function page(width = 300, height = 200): PageRef {
  return { id: "pg", sourceId: "a", sourceIndex: 0, baseRotation: 0, rotation: 0, view: [0, 0, width, height], crop: null };
}

function textOf(bytes: Uint8Array): string {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  return doc.loadPage(0).toStructuredText("preserve-whitespace").asText();
}

/** The pixel at user-space point (x, y) of a 300 x 200 page rendered at 150 dpi. */
function pixelAt(bytes: Uint8Array, x: number, y: number, height = 200): Pixel {
  const [shot] = renderPages(bytes, { pages: [0], dpi: 150, format: "png" });
  const img = decode(shot.bytes);
  return img.pixel(Math.round((x * 150) / 72), Math.round(((height - y) * 150) / 72));
}

describe("export with erase objects", () => {
  const redact = async (bytes: Uint8Array, areas: Parameters<typeof redactOp>[1]) => redactOp(bytes, areas);

  it("removes the text of a 'text' erase and keeps the panel", async () => {
    const src = await textOnPanel();
    const p = page();
    const out = await composeDocument({ sources: { a: src }, pages: [p], objects: [eraseObject(p.id, "text")], asset: () => { throw new Error("no assets"); }, redact });
    expect(textOf(out)).not.toContain("HOLA");
    expect(near(pixelAt(out, 100, 98), YELLOW, 8)).toBe(true);
  });

  it("removes outlined text with a 'vector' erase", async () => {
    const src = await outlinedOnPanel();
    const p = page();
    const out = await composeDocument({ sources: { a: src }, pages: [p], objects: [eraseObject(p.id, "vector")], asset: () => { throw new Error("no assets"); }, redact });
    expect(near(pixelAt(out, 62, 100), YELLOW, 8)).toBe(true);
    expect(near(pixelAt(out, 42, 106), YELLOW, 8)).toBe(true);
  });

  it("paints the reconstructed patch for a 'pixels' erase and reports the size cost", async () => {
    const src = await scanOf(await textOnPanel(BLUE));
    const analysed = eraseRegion(src, 0, TEXT_BOX);
    expect(analysed.method).toBe("pixels");
    const p = page();
    const out = await composeDocument({
      sources: { a: src },
      pages: [p],
      objects: [eraseObject(p.id, "pixels", analysed, "patch")],
      asset: () => ({ bytes: analysed.png, mime: analysed.mime }),
      redact,
    });
    for (const [x, y] of [[50, 98], [100, 98], [200, 98]]) expect(near(pixelAt(out, x, y), BLUE, 14)).toBe(true);
  });

  describe("JPEG scans keep their size when pixels are removed (plan, section 6)", () => {
    // A4 text page scanned to a noisy 1496 x 2117 JPEG, line 14 is the zone worked on.
    const BOX: [number, number, number, number] = [48, 560, 420, 580];

    async function bigScan(): Promise<Uint8Array> {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const sheet = doc.addPage([595, 842]);
      sheet.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(0.93, 0.9, 0.82) });
      for (let i = 0; i < 40; i++) sheet.drawText(`Linea de texto numero ${i} del documento escaneado`, { x: 50, y: 800 - i * 18, size: 11, font });
      const [shot] = renderPages(await doc.save(), { pages: [0], dpi: 181, format: "png" });
      const pix = new mupdf.Image(shot.bytes).toPixmap();
      const px = pix.getPixels();
      let seed = 1;
      for (let i = 0; i < px.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        px[i] = Math.max(0, Math.min(255, px[i] + ((seed >>> 24) - 128) / 20));
      }
      const jpeg = pix.asJPEG(75, false).slice();
      pix.destroy();
      const scan = await PDFDocument.create();
      scan.addPage([595, 842]).drawImage(await scan.embedJpg(jpeg), { x: 0, y: 0, width: 595, height: 842 });
      return scan.save();
    }

    /** Ink pixels (150 dpi) inside `box` of page 1, kept 3 px away from its edges. */
    function inkIn(bytes: Uint8Array, box: [number, number, number, number]): number {
      const [shot] = renderPages(bytes, { pages: [0], dpi: 150, format: "png" });
      const img = decode(shot.bytes);
      const data = new Uint8ClampedArray(img.width * img.height * 3);
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) data.set(img.pixel(x, y), (y * img.width + x) * 3);
      const k = 150 / 72;
      const region = { x0: box[0] * k + 3, y0: (842 - box[3]) * k + 3, x1: box[2] * k - 3, y1: (842 - box[1]) * k - 3 };
      return detectInk({ data, width: img.width, height: img.height, channels: 3 }, { dpi: 150, region, dilate: 0 }).count;
    }

    it("erase-pixels (export of a pixels eraser)", async () => {
      const src = await bigScan();
      const analysed = eraseRegion(src, 0, BOX);
      expect(analysed.method).toBe("pixels");
      const p = page(595, 842);
      const obj: EraseObject = { ...eraseObject(p.id, "pixels", analysed, "patch"), frame: { cx: 234, cy: 570, w: 372, h: 20, rot: 0 } };
      const out = await composeDocument({ sources: { a: src }, pages: [p], objects: [obj], asset: () => ({ bytes: analysed.png, mime: analysed.mime }), redact });
      const ratio = out.length / src.length;
      console.info(`erase-pixels on a 1496x2117 JPEG scan: ${src.length} -> ${out.length} bytes (x${ratio.toFixed(2)})`);
      console.info(`pixels patch: ${analysed.mime}, ${analysed.png.length} bytes`);
      expect(ratio).toBeLessThan(1.35);
      // The text is really gone, not only hidden by lossy rewriting.
      expect(inkIn(src, BOX)).toBeGreaterThan(300);
      expect(inkIn(out, BOX)).toBeLessThan(15);
    });

    it("redact (the redaction tool)", async () => {
      const src = await bigScan();
      const out = redactOp(src, [{ pageIndex: 0, box: BOX, mode: "redact" }]);
      const ratio = out.length / src.length;
      console.info(`redact on a 1496x2117 JPEG scan: ${src.length} -> ${out.length} bytes (x${ratio.toFixed(2)})`);
      expect(ratio).toBeLessThan(1.5);
      expect(inkIn(src, BOX)).toBeGreaterThan(300);
      expect(inkIn(out, BOX)).toBeLessThan(15);
      // Outside the zone the scan is still there.
      expect(inkIn(out, [48, 520, 420, 540])).toBeGreaterThan(300);
    });
  });

  describe("scans with soft glyph edges", () => {
    // Real scans are blurred and noisy, unlike MuPDF's crisp text: the edges of the letters
    // must go too, or a grey ghost of every letter stays.
    const PAPER = 245;

    function gaussianNoise(seed: number): () => number {
      let state = seed;
      const uniform = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return (state + 0.5) / 4294967296;
      };
      return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
    }

    /** Separable gaussian blur of interleaved 8-bit pixels. */
    function blur(data: Uint8ClampedArray, w: number, h: number, n: number, sigma: number): Uint8ClampedArray {
      const r = Math.ceil(sigma * 3);
      const kernel = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
      const total = kernel.reduce((a, b) => a + b, 0);
      const tmp = new Float32Array(data.length);
      const out = new Uint8ClampedArray(data.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          for (let c = 0; c < n; c++) {
            let a = 0;
            for (let i = -r; i <= r; i++) a += kernel[i + r] * data[(y * w + Math.min(w - 1, Math.max(0, x + i))) * n + c];
            tmp[(y * w + x) * n + c] = a / total;
          }
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          for (let c = 0; c < n; c++) {
            let a = 0;
            for (let i = -r; i <= r; i++) a += kernel[i + r] * tmp[(Math.min(h - 1, Math.max(0, y + i)) * w + x) * n + c];
            out[(y * w + x) * n + c] = a / total;
          }
        }
      }
      return out;
    }

    /** 300 dpi scan of the page: off-white paper, blurred (sigma 1.2 px), noisy (sigma 4), JPEG quality 75. */
    async function softScan(withText: boolean): Promise<Uint8Array> {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const sheet = doc.addPage([300, 200]);
      sheet.drawRectangle({ x: 0, y: 0, width: 300, height: 200, color: rgb(PAPER / 255, PAPER / 255, PAPER / 255) });
      if (withText) sheet.drawText("HOLA MUNDO", { x: 40, y: 90, size: 28, font, color: rgb(0, 0, 0) });
      const [shot] = renderPages(await doc.save(), { pages: [0], dpi: 300, format: "png" });
      const pix = new mupdf.Image(shot.bytes).toPixmap();
      const w = pix.getWidth();
      const h = pix.getHeight();
      const n = pix.getNumberOfComponents();
      const stride = pix.getStride();
      const raw = new Uint8ClampedArray(w * h * n);
      for (let y = 0; y < h; y++) raw.set(pix.getPixels().subarray(y * stride, y * stride + w * n), y * w * n);
      pix.destroy();
      const soft = blur(raw, w, h, n, 1.2);
      const noise = gaussianNoise(11);
      const out = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
      const dst = out.getPixels();
      const outStride = out.getStride();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const grain = noise() * 4;
          for (let c = 0; c < 3; c++) dst[y * outStride + x * 3 + c] = soft[(y * w + x) * n + c] + grain;
        }
      }
      const jpeg = out.asJPEG(75, false).slice();
      out.destroy();
      const scan = await PDFDocument.create();
      scan.addPage([300, 200]).drawImage(await scan.embedJpg(jpeg), { x: 0, y: 0, width: 300, height: 200 });
      return scan.save();
    }

    function rasterOf(png: Uint8Array): { data: Uint8ClampedArray; width: number; height: number } {
      const img = decode(png);
      const data = new Uint8ClampedArray(img.width * img.height * 3);
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) data.set(img.pixel(x, y), (y * img.width + x) * 3);
      return { data, width: img.width, height: img.height };
    }

    it("leaves no ghost of the letters and matches the clean paper", async () => {
      const k = 300 / 72;
      const res = eraseRegion(await softScan(true), 0, TEXT_BOX);
      expect(res.method).toBe("pixels");
      const result = rasterOf(res.png);
      const { width: w, height: h } = result;

      // The same page without text: what the zone should look like.
      const [cleanShot] = renderPages(await softScan(false), { pages: [0], dpi: 300, format: "png" });
      const clean = rasterOf(cleanShot.bytes);
      const x0 = Math.round((TEXT_BOX[0] - 1) * k);
      const y0 = Math.round((200 - TEXT_BOX[3] - 1) * k);
      const ref = new Uint8ClampedArray(w * h * 3);
      for (let y = 0; y < h; y++) ref.set(clean.data.subarray(((y + y0) * clean.width + x0) * 3, ((y + y0) * clean.width + x0 + w) * 3), y * w * 3);

      // Inside the zone proper (the 1 pt margin is untouched page).
      const zone = { x0: Math.ceil(k), y0: Math.ceil(k), x1: w - Math.ceil(k), y1: h - Math.ceil(k) };
      const area = (zone.x1 - zone.x0) * (zone.y1 - zone.y0);

      // Ghosts are smooth: compare 5 x 5 averages, which the grain barely moves, with the clean paper.
      const r = 2;
      let ghost = 0;
      let counted = 0;
      let error = 0;
      for (let y = zone.y0 + r; y < zone.y1 - r; y++) {
        for (let x = zone.x0 + r; x < zone.x1 - r; x++) {
          let a = 0;
          let b = 0;
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const i = ((y + dy) * w + x + dx) * 3 + 1;
              a += result.data[i];
              b += ref[i];
            }
          }
          if (Math.abs(a - b) / (2 * r + 1) ** 2 > 3) ghost++;
          counted++;
        }
      }
      for (let y = zone.y0; y < zone.y1; y++) for (let x = zone.x0; x < zone.x1; x++) for (let c = 0; c < 3; c++) error += Math.abs(result.data[(y * w + x) * 3 + c] - ref[(y * w + x) * 3 + c]);
      const ghostShare = ghost / counted;
      const meanError = error / (area * 3);
      const strong = detectInk({ data: result.data, width: w, height: h, channels: 3 }, { dpi: 300, region: zone, dilate: 0 }).count;
      console.info(`soft scan: ghost ${(ghostShare * 100).toFixed(2)} % of the zone, mean error ${meanError.toFixed(2)} levels, strong ink ${strong} px`);
      expect(ghostShare).toBeLessThan(0.005);
      expect(meanError).toBeLessThan(4);
      expect(strong).toBe(0);
    });
  });
});
