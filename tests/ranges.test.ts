import { describe, expect, it } from "vitest";
import { formatPageSelection, parsePageRanges, parsePageSelection } from "@/pdf/ranges";

describe("parsePageRanges", () => {
  it("parses single pages and ranges into 0-based groups, in the order written", () => {
    expect(parsePageRanges("1-3, 5", 10)).toEqual([[0, 1, 2], [4]]);
    expect(parsePageRanges("5, 1-2", 10)).toEqual([[4], [0, 1]]);
  });

  it("accepts commas, semicolons and whitespace as separators", () => {
    expect(parsePageRanges("1;3 5,7", 10)).toEqual([[0], [2], [4], [6]]);
    expect(parsePageRanges("  1-2 ,\t4\n6  ", 10)).toEqual([[0, 1], [3], [5]]);
  });

  it("treats a trailing dash as 'to the last page' and a leading dash as 'from the first page'", () => {
    expect(parsePageRanges("8-", 10)).toEqual([[7, 8, 9]]);
    expect(parsePageRanges("-3", 10)).toEqual([[0, 1, 2]]);
    expect(parsePageRanges("1-3, 5, 8-", 10)).toEqual([[0, 1, 2], [4], [7, 8, 9]]);
  });

  it("supports descending ranges", () => {
    expect(parsePageRanges("5-3", 10)).toEqual([[4, 3, 2]]);
  });

  it("is forgiving with spaces and typographic dashes around the range separator", () => {
    expect(parsePageRanges("1 - 3", 10)).toEqual([[0, 1, 2]]);
    expect(parsePageRanges("2 -", 4)).toEqual([[1, 2, 3]]);
    expect(parsePageRanges("1\u{2013}3", 10)).toEqual([[0, 1, 2]]);
    expect(parsePageRanges("1\u{2014}3", 10)).toEqual([[0, 1, 2]]);
  });

  it("keeps repeated and overlapping ranges as written", () => {
    expect(parsePageRanges("1-3, 2-4", 5)).toEqual([[0, 1, 2], [1, 2, 3]]);
    expect(parsePageRanges("2, 2", 5)).toEqual([[1], [1]]);
  });

  it("returns no groups for empty input", () => {
    expect(parsePageRanges("", 10)).toEqual([]);
    expect(parsePageRanges("   ", 10)).toEqual([]);
    expect(parsePageRanges(" , ; ", 10)).toEqual([]);
  });

  it("understands the 'all pages' words", () => {
    expect(parsePageRanges("todas", 3)).toEqual([[0, 1, 2]]);
    expect(parsePageRanges("ALL", 3)).toEqual([[0, 1, 2]]);
    expect(parsePageRanges("*", 3)).toEqual([[0, 1, 2]]);
  });

  it("rejects pages that do not exist with a Spanish message", () => {
    expect(() => parsePageRanges("12", 10)).toThrow(RangeError);
    expect(() => parsePageRanges("12", 10)).toThrow("La página 12 no existe (el documento tiene 10).");
    expect(() => parsePageRanges("0", 10)).toThrow("La página 0 no existe (el documento tiene 10).");
    expect(() => parsePageRanges("3-12", 10)).toThrow("La página 12 no existe (el documento tiene 10).");
    expect(() => parsePageRanges("11-", 10)).toThrow("La página 11 no existe (el documento tiene 10).");
    expect(() => parsePageRanges("-11", 10)).toThrow("La página 11 no existe (el documento tiene 10).");
    expect(() => parsePageRanges("1", 0)).toThrow("La página 1 no existe (el documento tiene 0).");
    expect(() => parsePageRanges("99999999999999999999999", 10)).toThrow(RangeError);
  });

  it("rejects malformed tokens with a Spanish message", () => {
    expect(() => parsePageRanges("a-b", 10)).toThrow(RangeError);
    expect(() => parsePageRanges("a-b", 10)).toThrow('Rango no válido: "a-b"');
    expect(() => parsePageRanges("1-2-3", 10)).toThrow('Rango no válido: "1-2-3"');
    expect(() => parsePageRanges("1.5", 10)).toThrow('Rango no válido: "1.5"');
    expect(() => parsePageRanges("-", 10)).toThrow('Rango no válido: "-"');
    expect(() => parsePageRanges("1, x", 10)).toThrow('Rango no válido: "x"');
  });
});

describe("parsePageSelection", () => {
  it("flattens, de-duplicates and sorts ascending", () => {
    expect(parsePageSelection("5, 1-3, 2-4", 10)).toEqual([0, 1, 2, 3, 4]);
    expect(parsePageSelection("5-3", 10)).toEqual([2, 3, 4]);
    expect(parsePageSelection("8-", 10)).toEqual([7, 8, 9]);
  });

  it("selects every page for empty input and the 'all' words", () => {
    expect(parsePageSelection("", 3)).toEqual([0, 1, 2]);
    expect(parsePageSelection("  ", 3)).toEqual([0, 1, 2]);
    expect(parsePageSelection("todas", 3)).toEqual([0, 1, 2]);
    expect(parsePageSelection("All", 3)).toEqual([0, 1, 2]);
    expect(parsePageSelection("*", 3)).toEqual([0, 1, 2]);
    expect(parsePageSelection("", 0)).toEqual([]);
  });

  it("propagates the parser errors", () => {
    expect(() => parsePageSelection("4", 3)).toThrow("La página 4 no existe (el documento tiene 3).");
    expect(() => parsePageSelection("x", 3)).toThrow('Rango no válido: "x"');
  });
});

describe("formatPageSelection", () => {
  it("writes runs as ranges and isolated pages as numbers", () => {
    expect(formatPageSelection([0, 1, 2, 4])).toBe("1-3, 5");
    expect(formatPageSelection([0])).toBe("1");
    expect(formatPageSelection([0, 2, 4])).toBe("1, 3, 5");
    expect(formatPageSelection([0, 1, 5, 6, 7, 9])).toBe("1-2, 6-8, 10");
  });

  it("sorts and de-duplicates and ignores invalid indices", () => {
    expect(formatPageSelection([4, 2, 0, 1, 2, 4])).toBe("1-3, 5");
    expect(formatPageSelection([-1, 1.5, Number.NaN, 0])).toBe("1");
    expect(formatPageSelection([])).toBe("");
  });

  it("round-trips with parsePageSelection", () => {
    const indices = [0, 1, 2, 5, 7, 8];
    expect(parsePageSelection(formatPageSelection(indices), 10)).toEqual(indices);
  });
});
