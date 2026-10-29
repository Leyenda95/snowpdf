import { describe, expect, it } from "vitest";
import { joinSelectedLines, type SelectedLine } from "@/render/textJoin";

function line(text: string, row: number, opts: Partial<SelectedLine> & { h?: number; gap?: number } = {}): SelectedLine {
  const h = opts.h ?? 10;
  const top = row * (h + (opts.gap ?? 2));
  const { h: _h, gap: _gap, ...rest } = opts;
  return { text, inlineStart: 0, inlineEnd: 400, blockStart: top, blockEnd: top + h, group: 0, ...rest };
}

describe("joinSelectedLines", () => {
  it("joins a wrapped paragraph with spaces", () => {
    expect(joinSelectedLines([line("The quick brown", 0), line("fox jumps over", 1), line("the lazy dog", 2)])).toBe(
      "The quick brown fox jumps over the lazy dog",
    );
  });

  it("keeps a paragraph gap as a newline", () => {
    expect(joinSelectedLines([line("First paragraph", 0), line("Second paragraph", 0, { blockStart: 30, blockEnd: 40 })])).toBe(
      "First paragraph\nSecond paragraph",
    );
  });

  it("breaks after a short line ending a sentence", () => {
    const lines = [line("A full line of text", 0), line("The end.", 1, { inlineEnd: 100 }), line("Next paragraph", 2)];
    expect(joinSelectedLines(lines)).toBe("A full line of text The end.\nNext paragraph");
  });

  it("does not break after a full-width line ending with a period", () => {
    expect(joinSelectedLines([line("Ends here.", 0), line("and goes on", 1, { inlineEnd: 200 })])).toBe("Ends here. and goes on");
  });

  it("removes the hyphen when the next line starts in lowercase", () => {
    expect(joinSelectedLines([line("an electro-", 0), line("magnetic wave", 1)])).toBe("an electromagnetic wave");
  });

  it("keeps the hyphen without a space when the next line is not lowercase", () => {
    expect(joinSelectedLines([line("Covid-", 0), line("19 cases", 1)])).toBe("Covid-19 cases");
  });

  it("drops soft hyphens", () => {
    expect(joinSelectedLines([line("co­operate", 0)])).toBe("cooperate");
  });

  it("breaks when the line height changes a lot", () => {
    expect(joinSelectedLines([line("Title", 0, { h: 20 }), line("Body text", 2, { h: 10 })])).toBe("Title\nBody text");
  });

  it("returns a single line unchanged and skips empty lines", () => {
    expect(joinSelectedLines([line("Hello world", 0)])).toBe("Hello world");
    expect(joinSelectedLines([line("  ", 0), line("a", 1), line("", 2), line("b", 2)])).toBe("a b");
  });

  it("joins lines from different groups with a space", () => {
    expect(joinSelectedLines([line("end of page one", 5, { group: 0 }), line("start of page two", 0, { group: 1 })])).toBe(
      "end of page one start of page two",
    );
  });
});
