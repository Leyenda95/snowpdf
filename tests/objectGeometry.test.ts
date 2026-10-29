import { describe, expect, it } from "vitest";
import { boxOverlapRatio, trimBoxAgainst } from "@/pdf/objectGeometry";
import type { PdfBox } from "@/model/types";

describe("boxOverlapRatio", () => {
  it("is the share of b covered by a", () => {
    expect(boxOverlapRatio([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1);
    expect(boxOverlapRatio([0, 0, 10, 5], [0, 0, 10, 10])).toBeCloseTo(0.5);
    expect(boxOverlapRatio([0, 8, 10, 20], [0, 0, 10, 10])).toBeCloseTo(0.2);
  });
  it("is 0 for disjoint, touching or empty boxes", () => {
    expect(boxOverlapRatio([20, 20, 30, 30], [0, 0, 10, 10])).toBe(0);
    expect(boxOverlapRatio([0, 10, 10, 20], [0, 0, 10, 10])).toBe(0);
    expect(boxOverlapRatio([0, 0, 10, 10], [5, 5, 5, 5])).toBe(0);
  });
});

describe("trimBoxAgainst", () => {
  const line: PdfBox = [0, 100, 200, 112.65];
  it("cuts at the middle of the overlap with the line above and below", () => {
    const above: PdfBox = [0, 111, 150, 124];
    const below: PdfBox = [0, 88, 150, 101];
    const out = trimBoxAgainst(line, [above, below], 0);
    expect(out[3]).toBeCloseTo(111.825);
    expect(out[1]).toBeCloseTo(100.5);
    expect(out[0]).toBe(0);
    expect(out[2]).toBe(200);
  });
  it("ignores boxes that do not overlap in either direction", () => {
    expect(trimBoxAgainst(line, [[0, 120, 200, 130]], 0)).toEqual(line);
    expect(trimBoxAgainst(line, [[300, 105, 400, 118]], 0)).toEqual(line);
  });
  it("never cuts past the centre", () => {
    const deep: PdfBox = [0, 90, 200, 111];
    const out = trimBoxAgainst(line, [deep], 0);
    expect(out[1]).toBeLessThanOrEqual(106.325);
    expect(out[1]).toBeGreaterThanOrEqual(100);
  });
  it("works on the x axis for quarter turns and skips other angles", () => {
    const col: PdfBox = [100, 0, 112.65, 200];
    const next: PdfBox = [111, 0, 124, 150];
    expect(trimBoxAgainst(col, [next], 90)[2]).toBeCloseTo(111.825);
    expect(trimBoxAgainst(line, [[0, 111, 150, 124]], 30)).toEqual(line);
  });
});
