import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, StandardFonts } from "@cantoo/pdf-lib";
import { composeDocument, type ComposeInput } from "@/pdf/compose";
import { redact } from "@/pdf/mupdf/ops";
import { TEXT_PADDING } from "@/pdf/textLayout";
import { linkBoxes, sameBox, shiftLinkRanges, textInkBox } from "@/pdf/textLinks";
import { fontChain, layoutText, splitSpans } from "@/pdf/textLayout";
import type { PageRef, PdfBox, TextLink, TextObject } from "@/model/types";

function textObj(frame: TextObject["frame"], extra: Partial<TextObject> = {}): TextObject {
  return {
    id: "t1",
    pageId: "a-p0",
    kind: "text",
    frame,
    opacity: 1,
    text: "Nuevo",
    font: "helvetica",
    bold: false,
    italic: false,
    size: 20,
    color: "#000000",
    align: "left",
    lineHeight: 1.2,
    background: "#ffffff",
    replaces: null,
    links: null,
    sourceFont: null,
    useSourceFont: false,
    justifyWidth: null,
    hScale: 1,
    ...extra,
  };
}

describe("textInkBox", () => {
  it("is the frame minus the padding on each side", () => {
    const box = textInkBox(textObj({ cx: 100, cy: 200, w: 60, h: 30, rot: 0 }));
    expect(box).toEqual([70 + TEXT_PADDING, 185 + TEXT_PADDING, 130 - TEXT_PADDING, 215 - TEXT_PADDING]);
  });

  it("covers the rotated content area", () => {
    const [x0, y0, x1, y1] = textInkBox(textObj({ cx: 100, cy: 200, w: 64, h: 24, rot: 90 }));
    // Content 60 x 20, quarter-turned: 20 wide, 60 tall, same centre.
    expect(x1 - x0).toBeCloseTo(20);
    expect(y1 - y0).toBeCloseTo(60);
    expect((x0 + x1) / 2).toBeCloseTo(100);
    expect((y0 + y1) / 2).toBeCloseTo(200);
  });
});

describe("links of edited text on export", () => {
  async function withLinks(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.drawText("P1", { x: 60, y: 700, size: 24, font });
    page.drawText("Otro", { x: 60, y: 600, size: 24, font });
    const mk = (rect: number[]) =>
      doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: rect,
          QuadPoints: [rect[0], rect[3], rect[2], rect[3], rect[0], rect[1], rect[2], rect[1]],
          A: { S: "URI", URI: "https://example.com" },
        }),
      );
    page.node.set(PDFName.of("Annots"), doc.context.obj([mk([55, 695, 100, 722]), mk([55, 595, 110, 622])]));
    return doc.save();
  }

  it("moves the carried link onto the new text and drops its quad points", async () => {
    const page: PageRef = { id: "a-p0", sourceId: "a", sourceIndex: 0, baseRotation: 0, rotation: 0, view: [0, 0, 595, 842], crop: null };
    const obj = textObj({ cx: 150, cy: 708, w: 164, h: 28, rot: 0 }, { replaces: [[55, 695, 100, 722]], links: [{ rect: [100, 722, 55, 695], start: 0, end: 2 }] });
    const args: ComposeInput = {
      sources: { a: await withLinks() },
      pages: [page],
      objects: [obj],
      asset: () => {
        throw new Error("no assets");
      },
      redact: async (bytes, areas) => redact(bytes, areas),
    };
    const out = await PDFDocument.load(await composeDocument(args));
    const annots = out.getPage(0).node.Annots()!;
    const links: { rect: PdfBox; quads: boolean }[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i, PDFDict);
      const r = a.lookup(PDFName.of("Rect"), PDFArray);
      links.push({ rect: [0, 1, 2, 3].map((k) => r.lookup(k, PDFNumber).asNumber()) as PdfBox, quads: a.has(PDFName.of("QuadPoints")) });
    }
    const moved = linkBoxes(obj)[0].box!;
    expect(links.filter((l) => sameBox(l.rect, moved, 0.01))).toHaveLength(1);
    expect(links.find((l) => sameBox(l.rect, moved, 0.01))!.quads).toBe(false);
    // The link that no replacement carries is untouched.
    const other = links.find((l) => sameBox(l.rect, [55, 595, 110, 622]));
    expect(other?.quads).toBe(true);
    expect(links).toHaveLength(2);
  });

  it("removes the Link annotation when its text is gone", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.drawText("P1", { x: 60, y: 700, size: 24, font });
    const ref = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [55, 695, 100, 722], A: { S: "URI", URI: "https://example.com" } }));
    page.node.set(PDFName.of("Annots"), doc.context.obj([ref]));
    const pg: PageRef = { id: "a-p0", sourceId: "a", sourceIndex: 0, baseRotation: 0, rotation: 0, view: [0, 0, 595, 842], crop: null };
    const obj = textObj({ cx: 150, cy: 708, w: 164, h: 28, rot: 0 }, { replaces: [[55, 695, 100, 722]], links: [{ rect: [55, 695, 100, 722], start: 3, end: 3 }] });
    const out = await PDFDocument.load(
      await composeDocument({
        sources: { a: await doc.save() },
        pages: [pg],
        objects: [obj],
        asset: () => {
          throw new Error("no assets");
        },
        redact: async (bytes, areas) => redact(bytes, areas),
      }),
    );
    expect(out.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  });
});

const L = (start: number, end: number): TextLink => ({ rect: [0, 0, 1, 1], start, end });
const span = (l: TextLink[] | null) => l!.map((x) => [x.start, x.end]);

describe("shiftLinkRanges", () => {
  const old = "alvaroliebana.com, LinkedIn, github";
  const links = [L(0, 17), L(19, 27), L(29, 35)];

  it("grows a link when typing at its end and shifts the ones after it", () => {
    expect(span(shiftLinkRanges(links, old, old.replace(".com,", ".comeeeeee,")))).toEqual([
      [0, 23],
      [25, 33],
      [35, 41],
    ]);
  });

  it("grows a link when typing inside it", () => {
    expect(span(shiftLinkRanges(links, old, "alvaXroliebana.com, LinkedIn, github"))).toEqual([
      [0, 18],
      [20, 28],
      [30, 36],
    ]);
  });

  it("shifts a link when text is inserted exactly at its start or before it", () => {
    expect(span(shiftLinkRanges(links, old, "Zalvaroliebana.com, LinkedIn, github"))).toEqual([
      [1, 18],
      [20, 28],
      [30, 36],
    ]);
    expect(span(shiftLinkRanges(links, old, old.replace(", Linked", ", ZZLinked")))).toEqual([
      [0, 17],
      [21, 29],
      [31, 37],
    ]);
  });

  it("leaves ranges before the edit alone and extends the one typed into at its end", () => {
    expect(span(shiftLinkRanges(links, old, old.replace("github", "gitXub")))).toEqual([
      [0, 17],
      [19, 27],
      [29, 35],
    ]);
    expect(span(shiftLinkRanges(links, old, old + " more"))).toEqual([
      [0, 17],
      [19, 27],
      [29, 40],
    ]);
  });

  it("shrinks on deletion across a boundary and empties a fully deleted link", () => {
    // Delete "com, Lin" (13..21): the first link keeps "alvaroliebana", the second keeps "nkedIn".
    const cut = old.slice(0, 13) + old.slice(21);
    expect(span(shiftLinkRanges(links, old, cut))).toEqual([
      [0, 13],
      [13, 19],
      [21, 27],
    ]);
    // Delete "LinkedIn" (19..27).
    expect(span(shiftLinkRanges(links, old, old.slice(0, 19) + old.slice(27)))).toEqual([
      [0, 17],
      [19, 19],
      [21, 27],
    ]);
  });

  it("keeps an emptied link empty even when typing at its position", () => {
    expect(span(shiftLinkRanges([L(5, 5)], "abcdefgh", "abcdeXfgh"))).toEqual([[6, 6]]);
  });

  it("uses the caret to tell which of several equal characters was typed", () => {
    const abc = [L(0, 3)];
    // "abc" + "exyz": typing "e" right after "c" extends the link, after the existing "e" it does not.
    expect(span(shiftLinkRanges(abc, "abcexyz", "abceexyz", 4))).toEqual([[0, 4]]);
    expect(span(shiftLinkRanges(abc, "abcexyz", "abceexyz", 5))).toEqual([[0, 3]]);
    // Without a caret the first reading wins.
    expect(span(shiftLinkRanges(abc, "abcexyz", "abceexyz"))).toEqual([[0, 3]]);
    // A caret that does not fit the change is ignored.
    expect(span(shiftLinkRanges(abc, "abcexyz", "abceexyz", 7))).toEqual([[0, 3]]);
  });

  it("handles replacing all the text and empty strings", () => {
    expect(span(shiftLinkRanges([L(0, 5)], "hello", "bye"))).toEqual([[0, 3]]);
    expect(span(shiftLinkRanges([L(2, 4)], "hello", "x"))).toEqual([[0, 0]]);
    expect(span(shiftLinkRanges([L(0, 5)], "hello", ""))).toEqual([[0, 0]]);
    expect(span(shiftLinkRanges([L(0, 0)], "", "abc"))).toEqual([[3, 3]]);
    expect(shiftLinkRanges(null, "a", "b")).toBeNull();
    expect(shiftLinkRanges(links, old, old)).toBe(links);
  });
});

describe("linkBoxes", () => {
  const text = "alvaroliebana.com, LinkedIn, github";
  const links = [L(0, 17), L(19, 27), L(29, 35)];
  const prefix = (o: TextObject, n: number) => splitSpans(o.text.slice(0, n), fontChain(o), o.size, 0, o.hScale).width;
  /** A text object whose frame fits its layout, centred at (300, 400). */
  const fitted = (extra: Partial<TextObject>): TextObject => {
    const probe = textObj({ cx: 0, cy: 0, w: 1, h: 1, rot: 0 }, extra);
    const lay = layoutText(probe);
    return { ...probe, frame: { cx: 300, cy: 400, w: lay.width, h: lay.height, rot: extra.frame?.rot ?? 0 } };
  };

  it("gives disjoint boxes in order that match the layout widths", () => {
    const obj = fitted({ text, links });
    const boxes = linkBoxes(obj).map((b) => b.box!);
    const left = 300 - obj.frame.w / 2 + TEXT_PADDING;
    expect(boxes[0][0]).toBeCloseTo(left);
    expect(boxes[0][2]).toBeCloseTo(left + prefix(obj, 17));
    expect(boxes[1][0]).toBeCloseTo(left + prefix(obj, 19));
    expect(boxes[1][2]).toBeCloseTo(left + prefix(obj, 27));
    expect(boxes[2][2]).toBeCloseTo(left + prefix(obj, 35));
    expect(boxes[0][2]).toBeLessThan(boxes[1][0]);
    expect(boxes[1][2]).toBeLessThan(boxes[2][0]);
    // Vertical extent is the line box.
    expect(boxes[0][3] - boxes[0][1]).toBeCloseTo(obj.size * obj.lineHeight);
  });

  it("scales with hScale, rotates with the frame and reports empty ranges as null", () => {
    const flat = linkBoxes(fitted({ text, links }))[1].box!;
    const squeezed = linkBoxes(fitted({ text, links, hScale: 0.5 }))[1].box!;
    expect(squeezed[2] - squeezed[0]).toBeCloseTo((flat[2] - flat[0]) / 2);
    const turned = linkBoxes(fitted({ text, links, frame: { cx: 0, cy: 0, w: 1, h: 1, rot: 90 } }))[1].box!;
    expect(turned[3] - turned[1]).toBeCloseTo(flat[2] - flat[0]);
    expect(turned[2] - turned[0]).toBeCloseTo(flat[3] - flat[1]);
    expect(linkBoxes(fitted({ text, links: [L(5, 5)] }))[0].box).toBeNull();
  });

  it("moves the later boxes right when a link grows", () => {
    const grown = text.replace(".com,", ".comeeeeee,");
    const o1 = fitted({ text, links });
    const o2 = fitted({ text: grown, links: shiftLinkRanges(links, text, grown)! });
    // Offsets from the left edge of each (auto-fitted) box.
    const before = linkBoxes(o1).map((b) => b.box!.map((v, i) => (i % 2 ? v : v - (300 - o1.frame.w / 2))));
    const after = linkBoxes(o2).map((b) => b.box!.map((v, i) => (i % 2 ? v : v - (300 - o2.frame.w / 2))));
    const added = prefix(o2, 23) - prefix(o1, 17);
    expect(added).toBeGreaterThan(0);
    expect(after[0][2] - before[0][2]).toBeCloseTo(added);
    expect(after[1][0] - before[1][0]).toBeCloseTo(added);
    expect(after[2][0] - before[2][0]).toBeCloseTo(added);
  });
});
