import { describe, expect, it } from "vitest";
import { PDFArray, PDFDocument, PDFRawStream, concatTransformationMatrix, decodePDFRawStream, degrees, rgb } from "@cantoo/pdf-lib";
import type { FontFamily } from "@/model/types";
import {
  addWatermark,
  type ImageWatermark,
  type TextWatermark,
  type WatermarkOptions,
  type WatermarkPosition,
} from "@/pdf/tools/watermark";
import {
  displaySize,
  fieldNames,
  fontMetrics,
  imageRuns,
  makeJpeg,
  makePdf,
  makePng,
  openPdf,
  pageLabels,
  pageText,
  renderPage,
  textLines,
  textRuns,
  type TextRun,
} from "./helpers";

const SIZE: [number, number] = [300, 400];
/** One page per /Rotate value; displayed sizes 300x400, 400x300, 300x400, 400x300. */
const ROTATIONS = [0, 90, 180, 270];

const textMark = (o: Partial<TextWatermark> = {}): TextWatermark => ({
  kind: "text",
  text: "CONFIDENCIAL",
  font: "helvetica",
  bold: true,
  italic: false,
  size: 30,
  color: "#ff0000",
  ...o,
});
const imageMark = (o: Partial<ImageWatermark> = {}): ImageWatermark => ({
  kind: "image",
  bytes: makePng(100, 50),
  mime: "image/png",
  widthRatio: 0.5,
  ...o,
});
const options = (o: Partial<WatermarkOptions> = {}): WatermarkOptions => ({
  mark: textMark(),
  position: "center",
  opacity: 0.5,
  angle: 0,
  layer: "over",
  ...o,
});

/** Runs painted by the watermark (everything but the "P1"-style labels of the fixtures). */
const marks = (bytes: Uint8Array, page: number): TextRun[] => textRuns(bytes, page).filter((r) => !/^P\d+$/.test(r.text));

/** Axis-aligned box (y up) of a rotated text box starting at the run's baseline origin. */
function boxOf(run: TextRun, width: number, height: number, pageHeight: number) {
  const a = (run.angle * Math.PI) / 180;
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([s, t]) => [run.x + s * Math.cos(a) - t * Math.sin(a), pageHeight - run.y + s * Math.sin(a) + t * Math.cos(a)]);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

describe("addWatermark: text", () => {
  it("puts the text at the centre of upright and rotated pages, reading upright", async () => {
    const m = await fontMetrics("helvetica", true);
    const out = await addWatermark(await makePdf({ pages: 4, size: SIZE, rotations: ROTATIONS }), options());
    for (let i = 0; i < 4; i++) {
      const { width, height } = displaySize(out, i);
      const [run] = marks(out, i);
      expect(run.text).toBe("CONFIDENCIAL");
      expect(Math.abs(run.angle) % 360).toBeCloseTo(0, 3); // upright on screen
      expect(run.x + m.width("CONFIDENCIAL", 30) / 2).toBeCloseTo(width / 2, 1);
      expect(run.y - m.ascent(30) / 2).toBeCloseTo(height / 2, 1);
    }
    // and MuPDF's own text extraction agrees: one line, wider than tall, around the page centre
    const line = textLines(out, 1).find((l) => l.text === "CONFIDENCIAL")!;
    expect(line.bbox.w).toBeGreaterThan(line.bbox.h * 3);
    expect(line.cx).toBeCloseTo(200, -1);
    expect(line.cy).toBeCloseTo(150, -1);
  });

  it("applies colour, opacity and size", async () => {
    const out = await addWatermark(await makePdf({ size: SIZE }), options({ mark: textMark({ color: "#336699", size: 41 }), opacity: 0.25 }));
    const [run] = marks(out, 0);
    expect(run.size).toBeCloseTo(41, 3);
    expect(run.alpha).toBeCloseTo(0.25, 3);
    expect(run.color[0]).toBeCloseTo(0.2, 2);
    expect(run.color[1]).toBeCloseTo(0.4, 2);
    expect(run.color[2]).toBeCloseTo(0.6, 2);
  });

  it("clamps the opacity to 0..1", async () => {
    const bytes = await makePdf({ size: SIZE });
    expect(marks(await addWatermark(bytes, options({ opacity: 7 })), 0)[0].alpha).toBe(1);
    expect(marks(await addWatermark(bytes, options({ opacity: -1 })), 0)[0].alpha).toBe(0);
  });

  it("really blends with the page: half opacity black over white is mid-grey", async () => {
    const bytes = await makePdf({ size: SIZE });
    const bold = textMark({ color: "#000000", size: 90, text: "MMM" });
    /** Darkest red-channel value in the lower right of the page, away from the "P1" label. */
    const darkest = (out: Uint8Array) => {
      const r = renderPage(out, 0, 1);
      let min = 255;
      for (let y = r.height / 2; y < r.height; y++) for (let x = r.width / 3; x < r.width; x++) min = Math.min(min, r.pixel(Math.floor(x), Math.floor(y))[0]);
      return min;
    };
    const full = await addWatermark(bytes, options({ mark: bold, position: "bottom-right", opacity: 1 }));
    const half = await addWatermark(bytes, options({ mark: bold, position: "bottom-right", opacity: 0.5 }));
    expect(darkest(full)).toBeLessThan(30);
    expect(darkest(half)).toBeGreaterThan(110);
    expect(darkest(half)).toBeLessThan(150);
  });

  it("supports every font family, bold and italic", async () => {
    const bytes = await makePdf({ size: SIZE });
    const cases: [FontFamily, boolean, boolean, RegExp][] = [
      ["helvetica", false, false, /Helvetica$/],
      ["helvetica", true, false, /Helvetica-Bold$/],
      ["times", false, true, /Times-Italic$/],
      ["times", true, true, /Times-BoldItalic$/],
      ["courier", true, false, /Courier-Bold$/],
    ];
    for (const [font, bold, italic, expected] of cases) {
      const out = await addWatermark(bytes, options({ mark: textMark({ font, bold, italic, text: "Hola" }) }));
      const line = textLines(out, 0).find((l) => l.text === "Hola");
      expect(line?.fontName, `${font} ${bold} ${italic}`).toMatch(expected);
    }
  });

  it("replaces characters the standard fonts cannot encode instead of failing", async () => {
    const out = await addWatermark(await makePdf({ size: SIZE }), options({ mark: textMark({ text: "Ñandú ✓ 日本" }) }));
    expect(marks(out, 0)[0].text).toBe("Ñandú ? ??");
  });

  it("centres every line of a multi-line text", async () => {
    const m = await fontMetrics("helvetica", true);
    const out = await addWatermark(await makePdf({ pages: 2, size: SIZE, rotations: [0, 90] }), options({ mark: textMark({ text: "UNO\nDOSCIENTOS\nTRES", size: 20 }) }));
    for (let i = 0; i < 2; i++) {
      const { width, height } = displaySize(out, i);
      const runs = marks(out, i).sort((a, b) => a.y - b.y);
      expect(runs.map((r) => r.text)).toEqual(["UNO", "DOSCIENTOS", "TRES"]);
      runs.forEach((r) => expect(r.x + m.width(r.text, 20) / 2).toBeCloseTo(width / 2, 1));
      expect(runs[1].y - runs[0].y).toBeCloseTo(24, 2); // 1.2 x the font size
      expect(runs[2].y - runs[1].y).toBeCloseTo(24, 2);
      expect(runs[1].y - m.ascent(20) / 2).toBeCloseTo(height / 2, 1); // the block is centred
    }
  });

  it("keeps blank lines as spacing", async () => {
    const out = await addWatermark(await makePdf({ size: SIZE }), options({ mark: textMark({ text: "A\n\nB", size: 20 }) }));
    const runs = marks(out, 0).sort((a, b) => a.y - b.y);
    expect(runs.map((r) => r.text)).toEqual(["A", "B"]);
    expect(runs[1].y - runs[0].y).toBeCloseTo(48, 2);
  });

  it("turns the text counter-clockwise as seen on screen, whatever the page rotation", async () => {
    const out = await addWatermark(await makePdf({ pages: 4, size: SIZE, rotations: ROTATIONS }), options({ angle: 30 }));
    for (let i = 0; i < 4; i++) {
      const { width, height } = displaySize(out, i);
      const [run] = marks(out, i);
      expect(run.angle).toBeCloseTo(30, 2);
      // the middle of the rotated text stays at the page centre
      const m = await fontMetrics("helvetica", true);
      const box = boxOf(run, m.width("CONFIDENCIAL", 30), m.ascent(30), height);
      expect((box.x0 + box.x1) / 2).toBeCloseTo(width / 2, 1);
      expect((box.y0 + box.y1) / 2).toBeCloseTo(height / 2, 1);
    }
  });

  it("only marks the selected pages", async () => {
    const out = await addWatermark(await makePdf({ pages: 4, size: SIZE }), options({ pages: "2, 4" }));
    expect([0, 1, 2, 3].map((i) => marks(out, i).length)).toEqual([0, 1, 0, 1]);
    const all = await addWatermark(await makePdf({ pages: 3, size: SIZE }), options({ pages: "" }));
    expect([0, 1, 2].map((i) => marks(all, i).length)).toEqual([1, 1, 1]);
  });
});

describe("addWatermark: positions", () => {
  const positions: Exclude<WatermarkPosition, "tile">[] = [
    "top-left",
    "top-center",
    "top-right",
    "middle-left",
    "center",
    "middle-right",
    "bottom-left",
    "bottom-center",
    "bottom-right",
  ];

  for (const angle of [0, 30]) {
    it(`places the mark inside the margins at the right edge or corner (angle ${angle})`, async () => {
      const m = await fontMetrics("helvetica", true);
      const size = 20;
      const w = m.width("MARCA", size);
      const h = m.ascent(size);
      for (const margin of [undefined, 20]) {
        const effective = margin ?? 36; // default margin
        for (const position of positions) {
          const out = await addWatermark(
            await makePdf({ pages: 4, size: SIZE, rotations: ROTATIONS }),
            options({ position, angle, margin, mark: textMark({ text: "MARCA", size }) }),
          );
          for (let i = 0; i < 4; i++) {
            const { width: W, height: H } = displaySize(out, i);
            const [run] = marks(out, i);
            const box = boxOf(run, w, h, H);
            const where = `${position} page ${i + 1} margin ${effective}`;
            const [vertical, horizontal] = position === "center" ? ["middle", "center"] : position.split("-");
            if (horizontal === "left") expect(box.x0, where).toBeCloseTo(effective, 1);
            if (horizontal === "right") expect(box.x1, where).toBeCloseTo(W - effective, 1);
            if (horizontal === "center") expect((box.x0 + box.x1) / 2, where).toBeCloseTo(W / 2, 1);
            if (vertical === "bottom") expect(box.y0, where).toBeCloseTo(effective, 1);
            if (vertical === "top") expect(box.y1, where).toBeCloseTo(H - effective, 1);
            if (vertical === "middle") expect((box.y0 + box.y1) / 2, where).toBeCloseTo(H / 2, 1);
          }
        }
      }
    });
  }

  it("centres a mark that does not fit inside the margins", async () => {
    const out = await addWatermark(await makePdf({ size: SIZE }), options({ position: "top-left", mark: textMark({ size: 60 }) }));
    const m = await fontMetrics("helvetica", true);
    const [run] = marks(out, 0);
    expect(run.x + m.width("CONFIDENCIAL", 60) / 2).toBeCloseTo(150, 1); // wider than the page: centred
    expect(run.y).toBeLessThan(100); // but still at the top
  });
});

describe("addWatermark: tile", () => {
  /** Distinct sorted values (merging those closer than `tolerance`). */
  const distinct = (values: number[], tolerance = 0.5) =>
    [...values].sort((a, b) => a - b).filter((v, i, all) => i === 0 || v - all[i - 1] > tolerance);

  it("repeats the mark in a staggered grid that covers the page", async () => {
    const m = await fontMetrics("helvetica", true);
    const size = 24;
    const w = m.width("TILE", size);
    for (const [rotation, W, H] of [
      [0, 300, 400],
      [90, 400, 300],
    ] as const) {
      const out = await addWatermark(
        await makePdf({ size: SIZE, rotations: [rotation] }),
        options({ position: "tile", mark: textMark({ text: "TILE", size }) }),
      );
      const runs = marks(out, 0);
      expect(runs.length).toBeGreaterThan(6);
      runs.forEach((r) => expect(Math.abs(r.angle) % 360).toBeCloseTo(0, 2));

      // rows share a baseline; rows are evenly spaced; every row has evenly spaced marks
      const centres = runs.map((r) => ({ x: r.x + w / 2, y: r.y }));
      const rows = distinct(centres.map((c) => c.y));
      expect(rows.length).toBeGreaterThan(2);
      const dy = rows[1] - rows[0];
      rows.forEach((y, i) => i > 0 && expect(y - rows[i - 1]).toBeCloseTo(dy, 1));
      expect(dy).toBeGreaterThan(m.ascent(size)); // rows do not overlap

      const xsOf = (y: number) => centres.filter((c) => Math.abs(c.y - y) < 0.5).map((c) => c.x).sort((a, b) => a - b);
      const dx = xsOf(rows[0]).length > 1 ? xsOf(rows[0])[1] - xsOf(rows[0])[0] : xsOf(rows[1])[1] - xsOf(rows[1])[0];
      expect(dx).toBeGreaterThan(w); // marks in a row do not overlap
      rows.forEach((y) => {
        const xs = xsOf(y);
        xs.forEach((x, i) => i > 0 && expect(x - xs[i - 1]).toBeCloseTo(dx, 1));
      });

      // odd rows are shifted by half a step
      const phase = (y: number) => (((xsOf(y)[0] - W / 2) % dx) + dx) % dx;
      const apart = (a: number, b: number) => Math.min(Math.abs(a - b), dx - Math.abs(a - b));
      expect(apart(phase(rows[1]), phase(rows[0]))).toBeCloseTo(dx / 2, 1);
      expect(apart(phase(rows[2]), phase(rows[0]))).toBeCloseTo(0, 1);

      // one mark sits exactly at the page centre
      const centre = centres.find((c) => Math.abs(c.x - W / 2) < 0.5 && Math.abs(c.y - m.ascent(size) / 2 - H / 2) < 0.5);
      expect(centre, `centre mark on ${rotation} degree page`).toBeDefined();

      // the grid reaches every edge of the page
      expect(Math.min(...centres.map((c) => c.x))).toBeLessThan(dx);
      expect(Math.max(...centres.map((c) => c.x))).toBeGreaterThan(W - dx);
      expect(Math.min(...rows)).toBeLessThan(dy + m.ascent(size));
      expect(Math.max(...rows)).toBeGreaterThan(H - dy);
    }
  });

  it("tiles along the text direction when turned", async () => {
    const out = await addWatermark(
      await makePdf({ size: SIZE }),
      options({ position: "tile", angle: 45, mark: textMark({ text: "TILE", size: 24 }) }),
    );
    const runs = marks(out, 0);
    expect(runs.length).toBeGreaterThan(8);
    runs.forEach((r) => expect(r.angle).toBeCloseTo(45, 2));
    // marks are spread all over the page, not bunched up
    const xs = runs.map((r) => r.x);
    const ys = runs.map((r) => r.y);
    expect(Math.min(...xs)).toBeLessThan(75);
    expect(Math.max(...xs)).toBeGreaterThan(225);
    expect(Math.min(...ys)).toBeLessThan(100);
    expect(Math.max(...ys)).toBeGreaterThan(300);
  });

  it("never produces an absurd number of copies", async () => {
    const out = await addWatermark(
      await makePdf({ size: [2000, 2000] }),
      options({ position: "tile", mark: textMark({ text: "x", size: 1 }) }),
    );
    expect(marks(out, 0).length).toBeLessThanOrEqual(1500);
    expect(marks(out, 0).length).toBeGreaterThan(50);
  });

  it("tiles images as well", async () => {
    const out = await addWatermark(
      await makePdf({ size: SIZE }),
      options({ position: "tile", mark: imageMark({ widthRatio: 0.25 }), opacity: 0.4 }),
    );
    const runs = imageRuns(out, 0);
    expect(runs.length).toBeGreaterThan(4);
    runs.forEach((r) => {
      expect(r.width).toBeCloseTo(75, 1);
      expect(r.height).toBeCloseTo(37.5, 1);
      expect(r.alpha).toBeCloseTo(0.4, 2);
    });
  });
});

describe("addWatermark: images", () => {
  it("sizes the image from the displayed page width and centres it, on every page rotation", async () => {
    const out = await addWatermark(await makePdf({ pages: 4, size: SIZE, rotations: ROTATIONS }), options({ mark: imageMark({ widthRatio: 0.5 }) }));
    for (let i = 0; i < 4; i++) {
      const { width, height } = displaySize(out, i);
      const [img] = imageRuns(out, i);
      expect(img.width).toBeCloseTo(width * 0.5, 1);
      expect(img.height).toBeCloseTo(width * 0.25, 1); // 2:1 image
      expect(img.cx).toBeCloseTo(width / 2, 1);
      expect(img.cy).toBeCloseTo(height / 2, 1);
      expect(img.angle).toBeCloseTo(0, 2); // upright
      expect(img.alpha).toBeCloseTo(0.5, 2);
    }
  });

  it("turns and places the image like text", async () => {
    const out = await addWatermark(
      await makePdf({ pages: 4, size: SIZE, rotations: ROTATIONS }),
      options({ mark: imageMark({ widthRatio: 0.4 }), position: "bottom-right", angle: 30, margin: 20 }),
    );
    for (let i = 0; i < 4; i++) {
      const { width: W, height: H } = displaySize(out, i);
      const [img] = imageRuns(out, i);
      expect(img.angle).toBeCloseTo(30, 2);
      // box of the rotated image
      const a = (30 * Math.PI) / 180;
      const halfW = (img.width * Math.abs(Math.cos(a)) + img.height * Math.abs(Math.sin(a))) / 2;
      const halfH = (img.width * Math.abs(Math.sin(a)) + img.height * Math.abs(Math.cos(a))) / 2;
      expect(img.cx + halfW).toBeCloseTo(W - 20, 1);
      expect(H - img.cy - halfH).toBeCloseTo(20, 1);
    }
  });

  it("accepts JPEGs and keeps the aspect ratio", async () => {
    const out = await addWatermark(await makePdf({ size: SIZE }), options({ mark: imageMark({ bytes: makeJpeg(30, 60), mime: "image/jpeg", widthRatio: 0.2 }) }));
    const [img] = imageRuns(out, 0);
    expect(img.width).toBeCloseTo(60, 1);
    expect(img.height).toBeCloseTo(120, 1);
  });

  it("limits the width ratio to 1 and never lets the image outgrow the page height", async () => {
    const wide = await addWatermark(await makePdf({ size: SIZE }), options({ mark: imageMark({ widthRatio: 5 }) }));
    expect(imageRuns(wide, 0)[0].width).toBeCloseTo(300, 1);
    const tall = await addWatermark(await makePdf({ size: SIZE }), options({ mark: imageMark({ bytes: makePng(10, 100), widthRatio: 1 }) }));
    const [img] = imageRuns(tall, 0);
    expect(img.height).toBeCloseTo(400, 1);
    expect(img.width).toBeCloseTo(40, 1);
  });

  it("trusts the bytes over the declared type", async () => {
    const out = await addWatermark(await makePdf({ size: SIZE }), options({ mark: imageMark({ bytes: makeJpeg(40, 20), mime: "image/png" }) }));
    expect(imageRuns(out, 0)).toHaveLength(1);
  });
});

describe("addWatermark: layer", () => {
  /** A page covered by an opaque green rectangle, as scanned or designed documents often are. */
  async function coveredPage(): Promise<Uint8Array> {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([300, 400]);
    page.drawRectangle({ x: 0, y: 0, width: 300, height: 400, color: rgb(0, 1, 0) });
    return doc.save();
  }
  const reddish = (out: Uint8Array) => {
    const r = renderPage(out, 0, 1);
    let count = 0;
    for (let y = 0; y < r.height; y += 2) for (let x = 0; x < r.width; x += 2) {
      const [R, G, B] = r.pixel(x, y);
      if (R > 200 && G < 90 && B < 90) count++;
    }
    return count;
  };

  it("paints 'over' on top of the page and 'under' behind it", async () => {
    const mark = textMark({ size: 70, text: "MMM", color: "#ff0000" });
    const over = await addWatermark(await coveredPage(), options({ mark, opacity: 1, layer: "over" }));
    const under = await addWatermark(await coveredPage(), options({ mark, opacity: 1, layer: "under" }));
    expect(reddish(over)).toBeGreaterThan(100);
    expect(reddish(under)).toBe(0); // hidden by the green rectangle
  });

  it("shows an 'under' mark through transparent areas of the page", async () => {
    const out = await addWatermark(await makePdf({ size: SIZE }), options({ layer: "under", opacity: 1 }));
    expect(marks(out, 0)).toHaveLength(1);
    expect(textLines(out, 0).map((l) => l.text)).toEqual(expect.arrayContaining(["P1", "CONFIDENCIAL"]));
  });

  it("orders the content streams: the watermark first for 'under', last for 'over'", async () => {
    const streamTexts = async (out: Uint8Array) => {
      const doc = await openPdf(out);
      const contents = doc.getPage(0).node.Contents();
      expect(contents).toBeInstanceOf(PDFArray);
      return Array.from({ length: (contents as PDFArray).size() }, (_, i) => {
        const stream = (contents as PDFArray).lookup(i, PDFRawStream);
        return new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
      });
    };
    const bytes = await makePdf({ size: SIZE });
    const isMark = (s: string) => / gs\b/.test(s); // only the watermark sets a graphics state (opacity)
    const over = await streamTexts(await addWatermark(bytes, options({ layer: "over" })));
    const under = await streamTexts(await addWatermark(bytes, options({ layer: "under" })));
    expect(over.map(isMark)).toEqual([false, false, false, true]); // q, original, Q, watermark
    expect(under.map(isMark)).toEqual([true, false, false, false]); // watermark, q, original, Q
    // the original content (the label) is intact in both and still wrapped in q ... Q
    expect(under[1].trim()).toBe("q");
    expect(under[3].trim()).toBe("Q");
  });

  it("is not thrown off by content that leaves the graphics state modified", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([300, 400]);
    // scale everything that follows by 2 and never restore it
    page.pushOperators(concatTransformationMatrix(2, 0, 0, 2, 0, 0));
    const bytes = await doc.save();
    const m = await fontMetrics("helvetica", true);
    for (const layer of ["over", "under"] as const) {
      const out = await addWatermark(bytes, options({ layer }));
      const [run] = marks(out, 0);
      expect(run.size, layer).toBeCloseTo(30, 2); // not doubled
      expect(run.x, layer).toBeCloseTo((300 - m.width("CONFIDENCIAL", 30)) / 2, 1);
      expect(run.y, layer).toBeCloseTo(200 + m.ascent(30) / 2, 1);
    }
  });

  it("works on a page with no content at all", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([300, 400]);
    const bytes = await doc.save();
    for (const layer of ["over", "under"] as const) {
      expect(marks(await addWatermark(bytes, options({ layer })), 0)).toHaveLength(1);
    }
  });
});

describe("addWatermark: odd pages and untouched content", () => {
  it("centres on the visible area of a cropped, rotated page", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([300, 400]);
    page.setCropBox(50, 60, 200, 250); // visible: 200 x 250 at an offset
    page.setRotation(degrees(90));
    const out = await addWatermark(await doc.save(), options());
    const { width, height } = displaySize(out, 0);
    expect([width, height]).toEqual([250, 200]);
    const m = await fontMetrics("helvetica", true);
    const [run] = marks(out, 0);
    expect(run.x + m.width("CONFIDENCIAL", 30) / 2).toBeCloseTo(125, 1);
    expect(run.y - m.ascent(30) / 2).toBeCloseTo(100, 1);
  });

  it("leaves the rest of the document alone", async () => {
    const bytes = await makePdf({ pages: 3, withForm: true, meta: { title: "T", creator: "Original" } });
    const out = await addWatermark(bytes, options({ position: "tile" }));
    expect(pageLabels(out)).toEqual(["P1", "P2", "P3"]);
    expect(pageText(out, 0)).toContain("P1");
    expect(await fieldNames(out)).toEqual(["texto_1", "acepto", "texto_2", "texto_3"]);
    const doc = await openPdf(out);
    expect(doc.getTitle()).toBe("T");
    expect(doc.getCreator()).toBe("Original");
    expect(doc.getProducer()).toBe("SnowPDF");
  });
});

describe("addWatermark: errors", () => {
  it("needs some text", async () => {
    const bytes = await makePdf();
    for (const text of ["", "   ", "\n \n"]) {
      await expect(addWatermark(bytes, options({ mark: textMark({ text }) }))).rejects.toThrow("Escribe el texto de la marca de agua.");
    }
  });

  it("needs a positive text size", async () => {
    const bytes = await makePdf();
    for (const size of [0, -5, Number.NaN]) {
      await expect(addWatermark(bytes, options({ mark: textMark({ size }) }))).rejects.toThrow(RangeError);
    }
  });

  it("explains an unreadable image", async () => {
    const bad = imageMark({ bytes: new TextEncoder().encode("no soy una imagen") });
    await expect(addWatermark(await makePdf(), options({ mark: bad }))).rejects.toThrow(
      "No se pudo leer la imagen de la marca de agua: el archivo está dañado o no es un PNG o JPEG válido.",
    );
  });

  it("rejects pages that do not exist with a Spanish message", async () => {
    const bytes = await makePdf({ pages: 2 });
    await expect(addWatermark(bytes, options({ pages: "5" }))).rejects.toThrow("La página 5 no existe (el documento tiene 2).");
  });
});
