import { describe, expect, it } from "vitest";
import { PDFDict, PDFName, PDFRawStream } from "@cantoo/pdf-lib";
import { imagesToPdf, readJpegOrientation, type ImageInput, type ImagesToPdfOptions } from "@/pdf/tools/imagesToPdf";
import {
  displaySize,
  inkBounds,
  isColor,
  makeJpeg,
  makePng,
  openPdf,
  pageCountOf,
  renderPage,
  withExifOrientation,
  type Pixel,
} from "./helpers";

const A4 = { width: 595.28, height: 841.89 };
const LETTER = { width: 612, height: 792 };

const png = (w: number, h: number): ImageInput => ({ bytes: makePng(w, h), mime: "image/png", name: `${w}x${h}.png` });
const jpg = (w: number, h: number): ImageInput => ({ bytes: makeJpeg(w, h), mime: "image/jpeg", name: `${w}x${h}.jpg` });

/** Rendered edges land on whole pixels (plus anti-aliasing): allow a pixel and a half. */
function near(actual: number, expected: number, tolerance = 1.5): void {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);
}

const opts = (o: Partial<ImagesToPdfOptions> = {}): ImagesToPdfOptions => ({ pageSize: "A4", orientation: "auto", margin: 36, ...o });

describe("imagesToPdf: pages", () => {
  it("makes one page per image, in order", async () => {
    const out = await imagesToPdf([png(100, 50), jpg(50, 100), png(60, 60)], opts({ pageSize: "fit", margin: 0 }));
    expect(pageCountOf(out)).toBe(3);
    const sizes = [0, 1, 2].map((i) => displaySize(out, i));
    expect(sizes[0].width).toBeCloseTo(75, 1);
    expect(sizes[0].height).toBeCloseTo(37.5, 1);
    expect(sizes[1].width).toBeCloseTo(37.5, 1);
    expect(sizes[1].height).toBeCloseTo(75, 1);
    expect(sizes[2].width).toBeCloseTo(45, 1);
  });

  it("uses A4 or Letter and picks the orientation from the image when 'auto'", async () => {
    const a4 = await imagesToPdf([png(100, 50), png(50, 100), png(70, 70)], opts());
    expect(displaySize(a4, 0).width).toBeCloseTo(A4.height, 1);
    expect(displaySize(a4, 0).height).toBeCloseTo(A4.width, 1);
    expect(displaySize(a4, 1).width).toBeCloseTo(A4.width, 1);
    expect(displaySize(a4, 2).width).toBeCloseTo(A4.width, 1); // square -> portrait

    const letter = await imagesToPdf([png(100, 50), png(50, 100)], opts({ pageSize: "Letter" }));
    expect(displaySize(letter, 0).width).toBeCloseTo(LETTER.height, 1);
    expect(displaySize(letter, 1).width).toBeCloseTo(LETTER.width, 1);
    expect(displaySize(letter, 1).height).toBeCloseTo(LETTER.height, 1);
  });

  it("forces the orientation when asked", async () => {
    const portrait = await imagesToPdf([png(100, 50)], opts({ orientation: "portrait" }));
    expect(displaySize(portrait, 0).width).toBeCloseTo(A4.width, 1);
    const landscape = await imagesToPdf([png(50, 100)], opts({ orientation: "landscape" }));
    expect(displaySize(landscape, 0).width).toBeCloseTo(A4.height, 1);
  });

  it("'fit' makes the page the size of the image at 96 dpi plus the margins and ignores the orientation", async () => {
    const out = await imagesToPdf([png(200, 100)], opts({ pageSize: "fit", orientation: "portrait", margin: 10 }));
    expect(displaySize(out, 0).width).toBeCloseTo(150 + 20, 1);
    expect(displaySize(out, 0).height).toBeCloseTo(75 + 20, 1);
    const bounds = inkBounds(renderPage(out, 0, 4))!;
    near(bounds.x0 / 4, 10);
    near(bounds.y0 / 4, 10);
    near(bounds.x1 / 4, 160);
    near(bounds.y1 / 4, 85);
  });

  it("keeps 'fit' pages within the largest size PDF viewers accept", async () => {
    const out = await imagesToPdf([png(30000, 8)], opts({ pageSize: "fit", margin: 0 }));
    expect(displaySize(out, 0).width).toBeCloseTo(14400, 0);
    expect(displaySize(out, 0).height).toBeCloseTo(3.84, 1); // 8 px at the same reduced scale
  });
});

describe("imagesToPdf: placement", () => {
  it("scales the image to fit inside the margins, keeps its aspect ratio and centres it", async () => {
    // A4 landscape, 36 pt margin: a 2:1 image is limited by the width
    const out = await imagesToPdf([png(100, 50)], opts());
    const b = inkBounds(renderPage(out, 0, 1))!;
    const imageW = A4.height - 72;
    const imageH = imageW / 2;
    near(b.x0, 36);
    near(b.x1, 36 + imageW);
    near(b.y0, (A4.width - imageH) / 2);
    near(b.y1, (A4.width + imageH) / 2);
  });

  it("is limited by the height when the image is taller than the page area", async () => {
    // 1:3 image on A4 portrait: height-bound
    const out = await imagesToPdf([png(40, 120)], opts());
    const b = inkBounds(renderPage(out, 0, 1))!;
    const imageH = A4.height - 72;
    const imageW = imageH / 3;
    near(b.y0, 36);
    near(b.y1, 36 + imageH);
    near(b.x0, (A4.width - imageW) / 2);
    near(b.x1, (A4.width + imageW) / 2);
  });

  it("honours the margin", async () => {
    for (const margin of [0, 20, 100]) {
      const out = await imagesToPdf([png(100, 50)], opts({ margin }));
      const b = inkBounds(renderPage(out, 0, 1))!;
      near(b.x0, margin);
      near(b.x1, A4.height - margin);
    }
  });

  it("copes with absurd margins by leaving a usable area", async () => {
    const out = await imagesToPdf([png(100, 50)], opts({ margin: 10000 }));
    const b = inkBounds(renderPage(out, 0, 1))!;
    expect(b.x1 - b.x0).toBeGreaterThan(50);
  });

  it("draws JPEGs too", async () => {
    const out = await imagesToPdf([jpg(60, 40)], opts({ pageSize: "fit", margin: 0 }));
    const r = renderPage(out, 0, 2);
    expect(isColor(r.pixel(Math.round(r.width / 2), Math.round(r.height / 2)), [30, 90, 200])).toBe(true);
  });

  it("trusts the bytes over the declared type", async () => {
    const out = await imagesToPdf(
      [
        { bytes: makePng(30, 20), mime: "image/jpeg" },
        { bytes: makeJpeg(30, 20), mime: "image/png" },
      ],
      opts(),
    );
    expect(pageCountOf(out)).toBe(2);
  });
});

describe("imagesToPdf: EXIF orientation", () => {
  const R: Pixel = [255, 0, 0];
  const G: Pixel = [0, 255, 0];
  const B: Pixel = [0, 0, 255];
  const Y: Pixel = [255, 255, 0];
  /** Stored image (80 x 40): red top-left, green top-right, blue bottom-left, yellow bottom-right. */
  const quadrants = (x: number, y: number): Pixel => (y < 20 ? (x < 40 ? R : G) : x < 40 ? B : Y);
  /** What a photo viewer shows, as [top-left, top-right, bottom-left, bottom-right], per EXIF value. */
  const EXPECTED: Record<number, [Pixel, Pixel, Pixel, Pixel]> = {
    1: [R, G, B, Y],
    2: [G, R, Y, B], // mirrored horizontally
    3: [Y, B, G, R], // rotated 180
    4: [B, Y, R, G], // mirrored vertically
    5: [R, B, G, Y], // transposed
    6: [B, R, Y, G], // rotated 90 clockwise
    7: [Y, G, B, R], // transversed
    8: [G, Y, R, B], // rotated 90 counter-clockwise
  };

  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`shows a photo with orientation ${orientation} the way a photo viewer does`, async () => {
      const bytes = orientation === 1 ? makeJpeg(80, 40, quadrants) : withExifOrientation(makeJpeg(80, 40, quadrants), orientation);
      expect(readJpegOrientation(bytes)).toBe(orientation === 1 ? 1 : orientation);
      const out = await imagesToPdf([{ bytes, mime: "image/jpeg" }], opts({ pageSize: "fit", margin: 0 }));

      const sideways = orientation >= 5;
      const size = displaySize(out, 0);
      expect(size.width).toBeCloseTo(sideways ? 30 : 60, 1);
      expect(size.height).toBeCloseTo(sideways ? 60 : 30, 1);

      const raster = renderPage(out, 0, 4);
      const at = (fx: number, fy: number) => raster.pixel(Math.round(raster.width * fx), Math.round(raster.height * fy));
      const shown = [at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75)];
      shown.forEach((pixel, i) => expect(isColor(pixel, EXPECTED[orientation][i], 70), `quadrant ${i}: ${pixel}`).toBe(true));
    });
  }

  it("picks the page orientation from the photo as displayed, not as stored", async () => {
    const stored = makeJpeg(80, 40); // wider than tall
    const out = await imagesToPdf([{ bytes: withExifOrientation(stored, 6), mime: "image/jpeg" }], opts());
    expect(displaySize(out, 0).width).toBeCloseTo(A4.width, 1); // portrait
  });

  it("embeds the photo with an upright tag so no viewer rotates it a second time", async () => {
    const out = await imagesToPdf([{ bytes: withExifOrientation(makeJpeg(80, 40), 6), mime: "image/jpeg" }], opts());
    const doc = await openPdf(out);
    const jpegs = doc.context
      .enumerateIndirectObjects()
      .filter(([, o]) => o instanceof PDFRawStream && o.dict.lookup(PDFName.of("Filter")) === PDFName.of("DCTDecode"))
      .map(([, o]) => (o as PDFRawStream).contents);
    expect(jpegs).toHaveLength(1);
    expect(readJpegOrientation(jpegs[0])).toBe(1);
    const image = doc.context.enumerateIndirectObjects().find(([, o]) => o instanceof PDFRawStream && o.dict.has(PDFName.of("Width")));
    expect((image![1] as PDFRawStream).dict instanceof PDFDict).toBe(true);
  });

  it("ignores broken or missing EXIF data", () => {
    const plain = makeJpeg(20, 20);
    expect(readJpegOrientation(plain)).toBe(1);
    expect(readJpegOrientation(new Uint8Array([1, 2, 3]))).toBe(1);
    const truncated = withExifOrientation(plain, 6).subarray(0, 14);
    expect(readJpegOrientation(truncated)).toBe(1);
    expect(readJpegOrientation(withExifOrientation(plain, 9))).toBe(1); // not a valid value
    expect(readJpegOrientation(withExifOrientation(plain, 0))).toBe(1);
  });
});

describe("imagesToPdf: errors", () => {
  it("needs at least one image", async () => {
    await expect(imagesToPdf([], opts())).rejects.toThrow("Añade al menos una imagen para crear el PDF.");
  });

  it("names the image that cannot be read", async () => {
    const bad: ImageInput = { bytes: new TextEncoder().encode("no soy una imagen"), mime: "image/png", name: "rota.png" };
    await expect(imagesToPdf([png(10, 10), bad], opts())).rejects.toThrow(
      'No se pudo leer la imagen "rota.png": el archivo está dañado o no es un PNG o JPEG válido.',
    );
    await expect(imagesToPdf([{ ...bad, name: undefined }], opts())).rejects.toThrow("No se pudo leer la imagen:");
  });

  it("stamps the file as made by SnowPDF", async () => {
    const doc = await openPdf(await imagesToPdf([png(10, 10)], opts()));
    expect(doc.getCreator()).toBe("SnowPDF");
    expect(doc.getProducer()).toBe("SnowPDF");
  });
});
