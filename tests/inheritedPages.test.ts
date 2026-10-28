import { describe, expect, it } from "vitest";
import { addPageNumbers } from "@/pdf/tools/pageNumbers";
import { addWatermark } from "@/pdf/tools/watermark";
import { cropPages } from "@/pdf/tools/crop";
import { mergeDocuments } from "@/pdf/tools/merge";
import { rotatePages } from "@/pdf/tools/rotate";
import { splitDocument } from "@/pdf/tools/split";
import { displaySize, fontMetrics, makeInheritedPdf, openPdf, pageLabels, textRuns } from "./helpers";

/**
 * Many generators write /Resources, /MediaBox and /Rotate once, on the page tree, and leave the
 * pages with nothing but /Contents. Every tool has to cope with that.
 */
describe("pages that inherit their attributes", () => {
  it("fixture check: the label is upright in the displayed page", async () => {
    for (const rotate of [0, 90, 180, 270]) {
      const bytes = await makeInheritedPdf({ pages: 2, rotate });
      expect(pageLabels(bytes), `rotate ${rotate}`).toEqual(["P1", "P2"]);
      const [label] = textRuns(bytes, 0);
      expect(label.x).toBeCloseTo(20, 1);
      expect(label.y).toBeCloseTo(60, 1);
      expect(Math.abs(label.angle) % 360).toBeCloseTo(0, 1);
    }
  });

  it("watermarks over and under, centred on the displayed page", async () => {
    const m = await fontMetrics("helvetica", true);
    for (const rotate of [0, 90, 180, 270]) {
      for (const layer of ["over", "under"] as const) {
        const out = await addWatermark(await makeInheritedPdf({ pages: 2, rotate }), {
          mark: { kind: "text", text: "COPIA", font: "helvetica", bold: true, italic: false, size: 30, color: "#ff0000" },
          position: "center",
          opacity: 0.5,
          angle: 0,
          layer,
        });
        for (let i = 0; i < 2; i++) {
          const { width, height } = displaySize(out, i);
          const run = textRuns(out, i).find((r) => r.text === "COPIA")!;
          expect(run, `rotate ${rotate} ${layer} page ${i + 1}`).toBeDefined();
          expect(run.x + m.width("COPIA", 30) / 2).toBeCloseTo(width / 2, 1);
          expect(run.y - m.ascent(30) / 2).toBeCloseTo(height / 2, 1);
        }
        expect(pageLabels(out)).toEqual(["P1", "P2"]);
      }
    }
  });

  it("numbers pages at the visual bottom", async () => {
    const m = await fontMetrics("helvetica", false);
    for (const rotate of [0, 90, 180, 270]) {
      const out = await addPageNumbers(await makeInheritedPdf({ pages: 2, rotate }), {
        position: "bottom-center",
        template: "{n}",
        startAt: 1,
        font: "helvetica",
        size: 12,
        color: "#000000",
        margin: 20,
      });
      const { width, height } = displaySize(out, 1);
      const run = textRuns(out, 1).find((r) => r.text === "2")!;
      expect(run.x + m.width("2", 12) / 2).toBeCloseTo(width / 2, 1);
      expect(height - run.y - m.descent(12)).toBeCloseTo(20, 1);
    }
  });

  it("rotates from the inherited rotation", async () => {
    const out = await rotatePages(await makeInheritedPdf({ pages: 2, rotate: 90 }), { angle: 90, pages: "2" });
    const doc = await openPdf(out);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 180]);
  });

  it("crops on the displayed page", async () => {
    const bytes = await makeInheritedPdf({ pages: 1, rotate: 90 });
    const out = await cropPages(bytes, { margins: { top: 10, right: 20, bottom: 30, left: 40 } });
    const before = displaySize(bytes, 0);
    const after = displaySize(out, 0);
    expect(after.width).toBeCloseTo(before.width - 60, 3);
    expect(after.height).toBeCloseTo(before.height - 40, 3);
    expect(textRuns(out, 0)[0].x).toBeCloseTo(20 - 40, 2);
    expect(textRuns(out, 0)[0].y).toBeCloseTo(60 - 10, 2);
  });

  it("splits and merges them without losing size, rotation or content", async () => {
    const bytes = await makeInheritedPdf({ pages: 3, rotate: 270, size: [200, 300] });
    const files = await splitDocument(bytes, "Doc", { kind: "each" });
    expect(files).toHaveLength(3);
    for (const [i, file] of files.entries()) {
      expect(displaySize(file.bytes)).toEqual({ width: 300, height: 200 });
      expect(pageLabels(file.bytes)).toEqual([`P${i + 1}`]);
      expect((await openPdf(file.bytes)).getPage(0).getRotation().angle).toBe(270);
    }
    const merged = await mergeDocuments(files.map((f) => ({ name: f.name, bytes: f.bytes, kind: "pdf" as const })).reverse());
    expect(pageLabels(merged)).toEqual(["P3", "P2", "P1"]);
    expect(displaySize(merged, 2)).toEqual({ width: 300, height: 200 });
  });

  it("works with an inherited CropBox", async () => {
    const bytes = await makeInheritedPdf({ pages: 1, size: [300, 400], cropBox: [50, 60, 250, 360] });
    expect(displaySize(bytes)).toEqual({ width: 200, height: 300 });
    const out = await addWatermark(bytes, {
      mark: { kind: "text", text: "COPIA", font: "helvetica", bold: false, italic: false, size: 20, color: "#000000" },
      position: "center",
      opacity: 1,
      angle: 0,
      layer: "over",
    });
    const m = await fontMetrics("helvetica", false);
    const run = textRuns(out, 0).find((r) => r.text === "COPIA")!;
    expect(run.x + m.width("COPIA", 20) / 2).toBeCloseTo(100, 1);
    expect(run.y - m.ascent(20) / 2).toBeCloseTo(150, 1);
    const [first] = await splitDocument(out, "Doc", { kind: "each" });
    expect(displaySize(first.bytes)).toEqual({ width: 200, height: 300 });
  });
});
