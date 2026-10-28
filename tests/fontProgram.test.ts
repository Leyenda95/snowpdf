import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fontProgram, loadFontProgram, parseFontProgram, registerFontProgram, unloadFontProgram, type FontProgram } from "@/pdf/fontProgram";

// Liberation Sans (OFL) ships with pdfjs-dist: a real TrueType font, metric-compatible with Helvetica.
const LIBERATION = new URL("../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf", import.meta.url);
const bytes = () => new Uint8Array(readFileSync(LIBERATION));

describe("parseFontProgram (Liberation Sans)", () => {
  let program: FontProgram;
  beforeAll(async () => {
    program = await parseFontProgram(bytes());
  });

  it("reports coverage", () => {
    expect(program.has("H")).toBe(true);
    expect(program.has("ñ")).toBe(true);
    expect(program.has("€")).toBe(true);
    expect(program.has("漢")).toBe(false);
  });

  it("excludes the private-use areas pdf.js maps raw character codes to", () => {
    expect(program.has("")).toBe(false);
    expect(program.has("")).toBe(false);
    expect(program.has(String.fromCodePoint(0xf0000))).toBe(false);
  });

  it("measures advances in 1/1000 em like Helvetica", () => {
    expect(program.advance("H")).toBeCloseTo(722, 0);
    expect(program.advance("a")).toBeCloseTo(556, 0);
    expect(program.advance(" ")).toBeCloseTo(278, 0);
    expect(program.advance("W")).toBeGreaterThan(program.advance("i"));
  });

  it("gives 0 for characters the font lacks", () => {
    expect(program.advance("")).toBe(0);
    expect(program.advance("漢")).toBe(0);
  });

  it("exposes vertical metrics as positive fractions of the em", () => {
    expect(program.ascent).toBeGreaterThan(0.8);
    expect(program.ascent).toBeLessThan(1.1);
    expect(program.descent).toBeGreaterThan(0.1);
    expect(program.descent).toBeLessThan(0.4);
  });

  it("tells drawn glyphs from blank ones", () => {
    expect(program.hasOutline("H")).toBe(true);
    expect(program.hasOutline("ñ")).toBe(true);
    expect(program.hasOutline(" ")).toBe(false);
    expect(program.hasOutline("漢")).toBe(false);
  });
});

describe("font program cache", () => {
  afterEach(() => {
    unloadFontProgram("a");
    unloadFontProgram("b");
  });

  it("loads once per id and can be looked up synchronously", async () => {
    expect(fontProgram("a")).toBeUndefined();
    expect(fontProgram(null)).toBeUndefined();
    const first = await loadFontProgram("a", bytes());
    expect(fontProgram("a")).toBe(first);
    // A second load with the same id reuses the parsed program.
    expect(await loadFontProgram("a", new Uint8Array([1, 2, 3]))).toBe(first);
  });

  it("registers programs and unloads them", async () => {
    const program = await parseFontProgram(bytes());
    registerFontProgram("b", program);
    expect(fontProgram("b")).toBe(program);
    unloadFontProgram("b");
    expect(fontProgram("b")).toBeUndefined();
  });
});
