import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "@cantoo/pdf-lib";
import { cssRotation, makeViewTransform } from "@/render/viewTransform";
import type { PdfBox, Rotation } from "@/model/types";

describe("makeViewTransform", () => {
  it("matches pdf.js PageViewport for every rotation and an offset box", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 700]);
    page.setMediaBox(30, 50, 400, 700);
    const pdf = await getDocument({ data: await doc.save(), verbosity: 0 }).promise;
    const p = await pdf.getPage(1);
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      for (const scale of [1, 1.75]) {
        const ref = p.getViewport({ scale, rotation });
        const mine = makeViewTransform(p.view as PdfBox, scale, rotation);
        mine.m.forEach((v, i) => expect(v).toBeCloseTo(ref.transform[i], 6));
        expect(mine.width).toBeCloseTo(ref.width, 6);
        expect(mine.height).toBeCloseTo(ref.height, 6);
        const pt = mine.toView(100, 200);
        const [rx, ry] = ref.convertToViewportPoint(100, 200);
        expect(pt.x).toBeCloseTo(rx, 6);
        expect(pt.y).toBeCloseTo(ry, 6);
        const back = mine.toUser(pt.x, pt.y);
        expect(back.x).toBeCloseTo(100, 6);
        expect(back.y).toBeCloseTo(200, 6);
      }
    }
    await pdf.loadingTask.destroy();
  });

  it("maps user-space directions to the expected CSS rotation", () => {
    for (const R of [0, 90, 180, 270] as Rotation[]) {
      const t = makeViewTransform([0, 0, 595, 842], 1, R);
      for (const rot of [0, 30, 90, -45]) {
        const r = (rot * Math.PI) / 180;
        const o = t.toView(0, 0);
        const e = t.toView(Math.cos(r), Math.sin(r));
        const screenAngle = (Math.atan2(e.y - o.y, e.x - o.x) * 180) / Math.PI;
        const expected = cssRotation(R, rot);
        const diff = (((screenAngle - expected) % 360) + 540) % 360 - 180;
        expect(Math.abs(diff)).toBeLessThan(1e-6);
      }
    }
  });
});
