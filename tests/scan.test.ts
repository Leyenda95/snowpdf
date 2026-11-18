import { describe, expect, it } from "vitest";
import type { Raster } from "@/pdf/inpaint";
import { detectDocument } from "@/pdf/scan/detect";
import { enhance } from "@/pdf/scan/enhance";
import { scanToPdf } from "@/pdf/scan/pdf";
import { processScan } from "@/pdf/scan/process";
import { fullQuad, isConvexQuad, rotateRaster, scaleQuad, type Point, type Quad } from "@/pdf/scan/raster";
import { homography, warpQuad, warpSize } from "@/pdf/scan/warp";
import { displaySize, makeJpeg, makePng, pageCountOf } from "./helpers";

type Rgb = [number, number, number];
type Fn = (x: number, y: number) => Rgb;

function raster(width: number, height: number, fn: Fn, channels: 3 | 4 = 4): Raster {
  const data = new Uint8ClampedArray(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      data.set(fn(x, y), i);
      if (channels === 4) data[i + 3] = 255;
    }
  }
  return { data, width, height, channels };
}

function px(img: Raster, x: number, y: number): Rgb {
  const i = (Math.round(y) * img.width + Math.round(x)) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

/** Deterministic noise in [-1, 1]. */
function noiseSource(seed: number): () => number {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2147483648 - 1;
  };
}

function inside(q: Quad, x: number, y: number): boolean {
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false;
  }
  return true;
}

/** Position of a point inside a quad as (u, v) in 0..1, good enough to paint "text lines". */
function uvIn(q: Quad, x: number, y: number): { u: number; v: number } {
  const [tl, tr, , bl] = q;
  const ax = tr.x - tl.x;
  const ay = tr.y - tl.y;
  const bx = bl.x - tl.x;
  const by = bl.y - tl.y;
  const det = ax * by - ay * bx;
  return { u: ((x - tl.x) * by - (y - tl.y) * bx) / det, v: (ax * (y - tl.y) - ay * (x - tl.x)) / det };
}

/** A sheet of paper with lines of "text" photographed on a darker table, with sensor noise. */
function photo(width: number, height: number, sheet: Quad, opts: { table?: number; paper?: number; shade?: (x: number, y: number) => number } = {}): Raster {
  const noise = noiseSource(7);
  const table = opts.table ?? 70;
  const paper = opts.paper ?? 225;
  return raster(width, height, (x, y) => {
    const k = opts.shade ? opts.shade(x, y) : 1;
    let v = table;
    if (inside(sheet, x, y)) {
      const { u, v: vv } = uvIn(sheet, x, y);
      const line = Math.floor(vv * 30);
      const text = u > 0.12 && u < 0.88 && vv > 0.1 && vv < 0.9 && line % 2 === 0 && Math.floor(u * 90) % 3 !== 0;
      v = text ? 40 : paper;
    }
    const n = v * k + noise() * 6;
    return [n, n, n];
  });
}

function expectQuadNear(actual: Quad | null, expected: Quad, tolerance: number): void {
  expect(actual, "a document was expected").not.toBeNull();
  actual!.forEach((p, i) => {
    const d = Math.hypot(p.x - expected[i].x, p.y - expected[i].y);
    expect(d, `corner ${i}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) vs (${expected[i].x}, ${expected[i].y})`).toBeLessThanOrEqual(tolerance);
  });
}

const P = (x: number, y: number): Point => ({ x, y });

describe("detectDocument", () => {
  it("finds an upright sheet on a darker table", () => {
    const sheet: Quad = [P(120, 80), P(520, 80), P(520, 600), P(120, 600)];
    expectQuadNear(detectDocument(photo(640, 680, sheet)), sheet, 5);
  });

  it("finds a sheet seen in perspective and slightly turned, corners ordered from the top left clockwise", () => {
    const sheet: Quad = [P(210, 110), P(640, 150), P(700, 640), P(130, 590)];
    expectQuadNear(detectDocument(photo(800, 720, sheet)), sheet, 6);
  });

  it("is not fooled by a shadow across the sheet", () => {
    const sheet: Quad = [P(150, 90), P(650, 70), P(690, 520), P(120, 540)];
    const shade = (x: number, y: number) => (x + y > 700 ? 0.7 : 1);
    expectQuadNear(detectDocument(photo(800, 600, sheet, { shade })), sheet, 6);
  });

  it("works on a large photo (coordinates are in source pixels)", () => {
    const sheet: Quad = [P(500, 400), P(2500, 450), P(2600, 3500), P(420, 3450)];
    expectQuadNear(detectDocument(photo(3000, 4000, sheet)), sheet, 20);
  });

  it("accepts RGB rasters too", () => {
    const sheet: Quad = [P(120, 80), P(520, 80), P(520, 600), P(120, 600)];
    const rgba = photo(640, 680, sheet);
    const rgb = raster(640, 680, (x, y) => px(rgba, x, y), 3);
    expectQuadNear(detectDocument(rgb), sheet, 5);
  });

  describe("photos taken from close", () => {
    /** A sheet that fills the photo, with lines of text and whatever `print` adds (a grey level, or null for none). */
    const page = (print: (x: number, y: number) => number | null) => {
      const noise = noiseSource(13);
      return raster(640, 800, (x, y) => {
        const text = x > 60 && x < 580 && y > 60 && y < 740 && Math.floor(y / 14) % 2 === 0 && Math.floor(x / 6) % 3 !== 0;
        const v = (print(x, y) ?? (text ? 45 : 228)) + noise() * 5;
        return [v, v, v];
      });
    };

    it("does not take a table with filled rows for the sheet (the crop would eat the rest of the page)", () => {
      // A dark heading row, then rows filled alternately: plenty of straight, strong edges.
      const table = (x: number, y: number) => {
        if (x < 90 || x >= 550 || y < 220 || y >= 580) return null;
        const row = Math.floor((y - 220) / 60);
        return row === 0 ? 70 : row % 2 === 1 ? 160 : null;
      };
      expect(detectDocument(page(table))).toBeNull();
    });

    it("does not take a picture or a filled box on the page for the sheet", () => {
      expect(detectDocument(page((x, y) => (x >= 150 && x < 490 && y >= 250 && y < 520 ? 90 : null)))).toBeNull();
      expect(detectDocument(page((x, y) => (x >= 100 && x < 540 && y >= 120 && y < 680 ? 185 : null)))).toBeNull();
    });

    it("does not take the lit part of the page for the sheet when a shadow crosses it", () => {
      const lit = raster(640, 800, (x, y) => {
        const v = 228 * (y > 420 || x > 470 ? 0.62 : 1);
        return [v, v, v];
      });
      expect(detectDocument(lit)).toBeNull();
    });

    it("uses the photo's border as a side when one edge of the sheet is out of the picture", () => {
      // The right edge is cut off; the other three have table beyond them.
      const sheet: Quad = [P(90, 70), P(900, 70), P(900, 620), P(90, 620)];
      expectQuadNear(detectDocument(photo(640, 700, sheet)), [P(90, 70), P(639, 70), P(639, 620), P(90, 620)], 6);
      // The same seen at an angle, with the top edge cut off.
      const tilted: Quad = [P(120, -200), P(560, -180), P(590, 560), P(80, 540)];
      const found = detectDocument(photo(680, 640, tilted));
      expect(found).not.toBeNull();
      expect(found![0].y).toBeLessThanOrEqual(1);
      expect(found![1].y).toBeLessThanOrEqual(1);
      expectQuadNear([found![2], found![3], found![2], found![3]] as Quad, [P(590, 560), P(80, 540), P(590, 560), P(80, 540)], 6);
    });

    it("gives up when two edges of the sheet are out of the picture (too little to go by)", () => {
      const sheet: Quad = [P(-200, 120), P(900, 120), P(900, 560), P(-200, 560)];
      expect(detectDocument(photo(640, 700, sheet))).toBeNull();
    });
  });

  it("returns null when there is no sheet to find", () => {
    const noise = noiseSource(3);
    const flat = raster(400, 300, () => {
      const v = 128 + noise() * 8;
      return [v, v, v];
    });
    expect(detectDocument(flat)).toBeNull();
  });
});

describe("warpQuad", () => {
  // Four coloured quadrants inside a tilted quad: after the warp each one fills a corner.
  const quad: Quad = [P(100, 60), P(420, 100), P(380, 380), P(60, 300)];
  const colours: Rgb[] = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
  ];
  const src = raster(480, 420, (x, y) => {
    if (!inside(quad, x, y)) return [0, 0, 0];
    const { u, v } = uvIn(quad, x, y);
    return colours[(v < 0.5 ? 0 : 2) + (u < 0.5 ? 0 : 1)];
  });

  it("sizes the output like the sheet's sides", () => {
    const { width, height } = warpSize(quad, 4000);
    // The longer of each pair of opposite sides (bottom and right here).
    expect(Math.abs(width - Math.hypot(320, 80))).toBeLessThanOrEqual(1.5);
    expect(Math.abs(height - Math.hypot(40, 280))).toBeLessThanOrEqual(1.5);
  });

  it("caps the longest side and keeps the proportions", () => {
    const full = warpSize(quad, 4000);
    const capped = warpSize(quad, 100);
    expect(Math.max(capped.width, capped.height)).toBe(100);
    expect(capped.width / capped.height).toBeCloseTo(full.width / full.height, 1);
  });

  it("straightens the quad: every corner of the output shows the matching part of the sheet", () => {
    const out = warpQuad(src, quad, 4000);
    const { width: w, height: h } = out;
    expect(px(out, 8, 8)).toEqual(colours[0]);
    expect(px(out, w - 9, 8)).toEqual(colours[1]);
    expect(px(out, 8, h - 9)).toEqual(colours[2]);
    expect(px(out, w - 9, h - 9)).toEqual(colours[3]);
    // Nothing from outside the sheet leaks in.
    for (const [x, y] of [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]]) expect(px(out, x, y)).not.toEqual([0, 0, 0]);
  });

  it("copies the picture when the quad is the whole image", () => {
    const out = warpQuad(src, fullQuad(src.width, src.height), 4000);
    expect(out.width).toBe(src.width);
    expect(out.height).toBe(src.height);
    for (const [x, y] of [[0, 0], [200, 200], [479, 419], [150, 100]]) expect(px(out, x, y)).toEqual(px(src, x, y));
  });
});

describe("degenerate input", () => {
  it("a quad squashed into a line has no perspective: null homography, and the warp still returns a picture", () => {
    const line: Quad = [P(10, 10), P(50, 10), P(90, 10), P(30, 10)];
    expect(homography(fullQuad(40, 40), line)).toBeNull();
    const src = raster(100, 100, () => [200, 200, 200]);
    const out = warpQuad(src, line, 4000);
    expect(out.data.length).toBe(out.width * out.height * 4);
  });

  it("maps the corners exactly", () => {
    const from = fullQuad(100, 50);
    const to: Quad = [P(10, 20), P(200, 30), P(180, 160), P(5, 140)];
    const m = homography(from, to)!;
    from.forEach((p, i) => {
      const d = m[6] * p.x + m[7] * p.y + 1;
      expect((m[0] * p.x + m[1] * p.y + m[2]) / d).toBeCloseTo(to[i].x, 6);
      expect((m[3] * p.x + m[4] * p.y + m[5]) / d).toBeCloseTo(to[i].y, 6);
    });
  });

  it("enhances pictures too narrow for more than one cell of light", () => {
    for (const [w, h] of [[2, 60], [60, 2], [1, 1]]) {
      const strip = raster(w, h, (x, y) => ((x + y) % 10 === 0 ? [30, 30, 30] : [180, 175, 160]));
      const out = enhance(strip, "color");
      expect([out.width, out.height]).toEqual([w, h]);
      if (w * h > 1) {
        expect(Math.min(...px(out, w > 1 ? 1 : 0, h > 1 ? 1 : 0))).toBeGreaterThanOrEqual(240);
        expect(Math.max(...px(out, 0, 0))).toBeLessThanOrEqual(90);
      }
    }
  });

  it("does not look for sheets in tiny pictures", () => {
    expect(detectDocument(raster(20, 20, () => [255, 255, 255]))).toBeNull();
  });
});

describe("crop outline helpers", () => {
  const quad: Quad = [P(10, 10), P(90, 20), P(80, 90), P(5, 70)];

  it("accepts a clockwise outline and rejects folded or reversed ones", () => {
    expect(isConvexQuad(quad)).toBe(true);
    // A corner dragged across the opposite side.
    expect(isConvexQuad([quad[0], quad[1], P(20, 15), quad[3]])).toBe(false);
    expect(isConvexQuad([quad[3], quad[2], quad[1], quad[0]])).toBe(false);
  });

  it("maps corners between a preview and the full picture", () => {
    // Preview pixel 0 covers full pixels 0..3: its centre is at 1.5.
    expect(scaleQuad([P(0, 0), P(99, 0), P(99, 49), P(0, 49)], 4)).toEqual([P(1.5, 1.5), P(397.5, 1.5), P(397.5, 197.5), P(1.5, 197.5)]);
    const back = scaleQuad(scaleQuad(quad, 3), 1 / 3);
    back.forEach((p, i) => {
      expect(p.x).toBeCloseTo(quad[i].x, 6);
      expect(p.y).toBeCloseTo(quad[i].y, 6);
    });
  });
});

describe("rotateRaster", () => {
  const src = raster(3, 2, (x, y) => [x * 10, y * 10, 0]);

  it("turns clockwise by quarter turns", () => {
    const r = rotateRaster(src, 1);
    expect([r.width, r.height]).toEqual([2, 3]);
    // The top-left pixel ends up top-right.
    expect(px(r, 1, 0)).toEqual(px(src, 0, 0));
    expect(px(r, 0, 2)).toEqual(px(src, 2, 1));
  });

  it("three quarter turns are one turn anticlockwise, and negative turns count backwards", () => {
    const r = rotateRaster(src, 3);
    expect([r.width, r.height]).toEqual([2, 3]);
    // The top-left pixel ends up bottom-left.
    expect(px(r, 0, 2)).toEqual(px(src, 0, 0));
    expect(px(r, 1, 0)).toEqual(px(src, 2, 1));
    expect(Array.from(rotateRaster(src, -1).data)).toEqual(Array.from(r.data));
  });

  it("four quarter turns give back the picture", () => {
    let r = src;
    for (let i = 0; i < 4; i++) r = rotateRaster(r, 1);
    expect(Array.from(r.data)).toEqual(Array.from(src.data));
    expect(Array.from(rotateRaster(src, 2).data)).toEqual(Array.from(rotateRaster(rotateRaster(src, 1), 1).data));
  });
});

describe("enhance", () => {
  const W = 600;
  const H = 800;
  const isText = (x: number, y: number) => x > 60 && x < 540 && y > 60 && y < 500 && Math.floor(y / 12) % 2 === 0 && Math.floor(x / 5) % 3 !== 0;
  const isStamp = (x: number, y: number) => x > 380 && x < 460 && y > 600 && y < 660;
  /**
   * Light falling off towards the bottom right and a shadow across the top left. Its edge is a
   * narrow penumbra (about 1 % of the sheet), as cast shadows have in photos.
   */
  const shadow = (x: number, y: number) => 0.72 + 0.28 * Math.min(1, Math.max(0, (x + y - 294) / 12));
  const light = (x: number, y: number) => (1 - 0.45 * ((x + y) / (W + H))) * shadow(x, y);
  const noise = noiseSource(11);
  const page = raster(W, H, (x, y) => {
    const k = light(x, y);
    const base: Rgb = isText(x, y) ? [45, 45, 50] : isStamp(x, y) ? [200, 40, 40] : [235, 228, 205];
    const n = noise() * 5;
    return [base[0] * k + n, base[1] * k + n, base[2] * k + n];
  });
  /** Away from text edges, where pixels are plainly paper or plainly ink. */
  const samples: [number, number][] = [];
  for (let y = 20; y < H - 20; y += 37) for (let x = 20; x < W - 20; x += 31) samples.push([x, y]);
  const paperSamples = samples.filter(([x, y]) => !isText(x, y) && !isStamp(x, y) && (y > 520 || x < 50 || x > 550));
  const textSamples: [number, number][] = [];
  for (let y = 78; y < 500; y += 24) for (let x = 83; x < 540; x += 45) if (isText(x, y) && isText(x - 1, y) && isText(x + 1, y)) textSamples.push([x, y]);

  it("has fixtures worth testing (the paper is unevenly lit)", () => {
    const lum = paperSamples.map(([x, y]) => px(page, x, y)[1]);
    expect(Math.max(...lum) - Math.min(...lum)).toBeGreaterThan(60);
    expect(textSamples.length).toBeGreaterThan(20);
  });

  it("original: returns the picture untouched", () => {
    expect(Array.from(enhance(page, "original").data)).toEqual(Array.from(page.data));
  });

  it("color: whitens the paper everywhere (shadows and lamp tint gone), keeps the ink dark and the colours", () => {
    const out = enhance(page, "color");
    expect([out.width, out.height, out.channels]).toEqual([W, H, 4]);
    for (const [x, y] of paperSamples) {
      const [r, g, b] = px(out, x, y);
      expect(Math.min(r, g, b), `paper at ${x},${y}: ${r},${g},${b}`).toBeGreaterThanOrEqual(240);
    }
    for (const [x, y] of textSamples) expect(Math.max(...px(out, x, y)), `text at ${x},${y}`).toBeLessThanOrEqual(90);
    const [r, g, b] = px(out, 420, 630);
    expect(r).toBeGreaterThan(170);
    expect(r - Math.max(g, b)).toBeGreaterThan(100);
    expect(out.data[3]).toBe(255);
  });

  it("gray: same clean page without colour", () => {
    const out = enhance(page, "gray");
    for (const [x, y] of samples) {
      const [r, g, b] = px(out, x, y);
      expect(r === g && g === b).toBe(true);
    }
    for (const [x, y] of paperSamples) expect(px(out, x, y)[0]).toBeGreaterThanOrEqual(240);
    for (const [x, y] of textSamples) expect(px(out, x, y)[0]).toBeLessThanOrEqual(90);
    // The stamp is still visible, as a mid grey.
    expect(px(out, 420, 630)[0]).toBeLessThan(170);
  });

  it("bw: pure black ink on pure white paper, also under the shadow", () => {
    const out = enhance(page, "bw");
    for (const [x, y] of paperSamples) expect(px(out, x, y)).toEqual([255, 255, 255]);
    for (const [x, y] of textSamples) expect(px(out, x, y)).toEqual([0, 0, 0]);
    expect(px(out, 420, 630)).toEqual([0, 0, 0]);
  });

  it("bw: a blank sheet stays blank (noise is not turned into ink)", () => {
    const n2 = noiseSource(5);
    const blank = raster(300, 400, (x, y) => {
      const v = 215 * light(x * 2, y * 2) + n2() * 6;
      return [v, v, v];
    });
    const out = enhance(blank, "bw");
    let dark = 0;
    for (let i = 0; i < out.data.length; i += 4) if (out.data[i] < 128) dark++;
    expect(dark).toBe(0);
  });

  it("a knife-sharp shadow leaves no line along its edge, and text beside it stays dark", () => {
    const n2 = noiseSource(41);
    const hard = (x: number, y: number) => (x + y < 500 ? 0.7 : 1);
    const stroke = (x: number, y: number) => y >= 100 && y < 400 && Math.floor(y / 8) % 2 === 0 && x >= 60 && x < 480;
    const sheet = raster(W, H, (x, y) => {
      const v = (stroke(x, y) ? 45 : 228) * hard(x, y) + n2() * 4;
      return [v, v, v];
    });
    const bw = enhance(sheet, "bw");
    const gray = enhance(sheet, "gray");
    // Along the edge, away from the strokes: nothing but paper.
    for (let y = 410; y < 495; y += 3) {
      for (let d = -6; d <= 6; d++) {
        const x = 500 - y + d;
        expect(bw.data[(y * W + x) * 4], `bw at ${x},${y}`).toBe(255);
        expect(gray.data[(y * W + x) * 4], `gray at ${x},${y}`).toBeGreaterThanOrEqual(235);
      }
    }
    // The strokes on both sides of it, right up to the edge.
    for (let y = 100; y < 400; y += 16) {
      for (const d of [-14, -8, 8, 14]) {
        const x = 500 - (y + 3) + d;
        if (x >= 62 && x < 478) expect(gray.data[((y + 3) * W + x) * 4], `stroke at ${x},${y + 3}`).toBeLessThanOrEqual(90);
      }
    }
  });

  describe("what makes a scan look good", () => {
    // The same lighting, with things that are neither paper nor black ink: a pale blue box a
    // quarter of the sheet wide, a highlighter stroke, a soft-edged bar and a faint hairline.
    const inBox = (x: number, y: number) => x >= 80 && x < 230 && y >= 540 && y < 740;
    const inMarker = (x: number, y: number) => x >= 60 && x < 400 && y >= 100 && y < 112;
    // A logo: an orange disc on a blue square.
    const inLogo = (x: number, y: number) => x >= 440 && x < 520 && y >= 600 && y < 680;
    const inDisc = (x: number, y: number) => Math.hypot(x - 480, y - 640) < 24;
    /** 0 on paper .. 1 on ink: a bar whose left edge fades in over 6 pixels. */
    const softBar = (x: number, y: number) => (y >= 300 && y < 340 ? Math.min(1, Math.max(0, (x - 300) / 6)) * (x < 420 ? 1 : 0) : 0);
    const n2 = noiseSource(23);
    const sheet = raster(W, H, (x, y) => {
      const k = light(x, y);
      let base: Rgb = [235, 228, 205];
      if (inBox(x, y)) base = [150, 190, 235];
      else if (inDisc(x, y)) base = [224, 128, 42];
      else if (inLogo(x, y)) base = [28, 95, 184];
      else if (inMarker(x, y)) base = [245, 235, 95];
      // A one pixel line at 60 % of the paper level, as a blurry photo leaves thin strokes.
      else if (y === 420 && x > 60 && x < 540) base = [141, 137, 123];
      else if (softBar(x, y) > 0) {
        const t = softBar(x, y);
        base = [235 - 190 * t, 228 - 183 * t, 205 - 155 * t];
      }
      const n = n2() * 4;
      return [base[0] * k + n, base[1] * k + n, base[2] * k + n];
    });

    it("color: a large area of colour stays coloured, and the paper around it still turns white", () => {
      const out = enhance(sheet, "color");
      for (const [x, y] of [[100, 560], [155, 640], [210, 720]]) {
        const [r, , b] = px(out, x, y);
        expect(b - r, `box at ${x},${y}`).toBeGreaterThanOrEqual(60);
        expect(r, `box at ${x},${y}`).toBeLessThan(200);
      }
      const [mr, , mb] = px(out, 200, 106);
      expect(mr - mb).toBeGreaterThan(100);
      for (const [x, y] of [[300, 640], [40, 640], [500, 200], [300, 780]]) expect(Math.min(...px(out, x, y)), `paper at ${x},${y}`).toBeGreaterThanOrEqual(240);
    });

    it("color: a logo keeps its hues (mid-bright colours are not mistaken for shadowed paper)", () => {
      const out = enhance(sheet, "color");
      for (const [x, y] of [[480, 640], [470, 632], [490, 650]]) {
        const [r, g, b] = px(out, x, y);
        expect(r, `disc at ${x},${y}: ${r},${g},${b}`).toBeGreaterThan(200);
        expect(g, `disc at ${x},${y}: ${r},${g},${b}`).toBeLessThan(170);
        expect(g).toBeGreaterThan(60);
        expect(b).toBeLessThan(80);
      }
      for (const [x, y] of [[448, 608], [512, 672], [448, 672]]) {
        const [r, g, b] = px(out, x, y);
        expect(b, `square at ${x},${y}: ${r},${g},${b}`).toBeGreaterThan(150);
        expect(r, `square at ${x},${y}: ${r},${g},${b}`).toBeLessThan(60);
      }
      // In grey the disc is a mid grey, lighter than the square but far from white.
      const gray = enhance(sheet, "gray");
      expect(px(gray, 480, 640)[0]).toBeLessThan(200);
      expect(px(gray, 480, 640)[0]).toBeGreaterThan(px(gray, 448, 608)[0]);
    });

    it("keeps text dark right beside the edge of a shadow", () => {
      // Ink strokes crossing the shadow's edge (x + y = 300), on the lit side of it.
      const n3 = noiseSource(31);
      const crossing = raster(W, H, (x, y) => {
        const stroke = y >= 40 && y < 260 && Math.floor(y / 6) % 2 === 0 && x >= 30 && x < 290;
        const v = (stroke ? 45 : 232) * light(x, y) + n3() * 4;
        return [v, v, v];
      });
      const out = enhance(crossing, "gray");
      for (let y = 50; y < 260; y += 12) {
        for (const dx of [10, 16, 24]) {
          const x = 300 - y + dx;
          if (x >= 30 && x < 289) expect(px(out, x, y)[0], `stroke at ${x},${y}`).toBeLessThanOrEqual(90);
        }
      }
    });

    it("reinforces thin, faint strokes instead of leaving them grey", () => {
      const out = enhance(sheet, "gray");
      for (const x of [100, 300, 500]) expect(px(out, x, 420)[0], `hairline at ${x}`).toBeLessThanOrEqual(110);
    });

    it("bw: edges keep a step of grey (smooth text, not jagged), flat areas stay pure", () => {
      const out = enhance(sheet, "bw");
      const row = Array.from({ length: 16 }, (_, i) => px(out, 296 + i, 320)[0]);
      expect(row[0]).toBe(255);
      expect(row[15]).toBe(0);
      expect(row.some((v) => v > 0 && v < 255), row.join(",")).toBe(true);
      // Still dark to the right of the edge and light to the left: no ringing back and forth.
      expect([...row].sort((a, b) => b - a)).toEqual(row);
    });
  });

  it("works on RGB rasters and leaves the input alone", () => {
    const rgb = raster(W, H, (x, y) => px(page, x, y), 3);
    const before = Array.from(rgb.data.slice(0, 3000));
    const out = enhance(rgb, "color");
    expect(out.channels).toBe(3);
    expect(Array.from(rgb.data.slice(0, 3000))).toEqual(before);
    expect(px(out, 300, 700)).toEqual(px(enhance(page, "color"), 300, 700));
  });
});

describe("enhance on a poor photo (out of focus, dark, noisy)", () => {
  /** Gaussian blur of one channel. */
  function blur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
    const r = Math.ceil(sigma * 2.5);
    const kernel = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
    const norm = kernel.reduce((a, b) => a + b, 0);
    const pass = (from: Float32Array, step: number, size: number, other: number) => {
      const to = new Float32Array(from.length);
      for (let o = 0; o < other; o++) {
        for (let p = 0; p < size; p++) {
          let sum = 0;
          for (let k = -r; k <= r; k++) sum += kernel[k + r] * from[(step === 1 ? o * w : o) + Math.min(size - 1, Math.max(0, p + k)) * step];
          to[(step === 1 ? o * w : o) + p * step] = sum / norm;
        }
      }
      return to;
    };
    return pass(pass(src, 1, w, h), w, h, w);
  }

  /**
   * A page of small print (lines 10 px tall, strokes 2 px wide) and a heading in thick strokes,
   * as a phone gives it indoors: the page is `scale` times a 600×800 one.
   */
  function poorPhoto(scale: number, sigma: number, gain: number, noiseLevel: number) {
    const w = 600 * scale;
    const h = 800 * scale;
    const isText = (x: number, y: number) => x >= 60 && x < 540 && y >= 140 && y < 700 && (y - 140) % 22 < 10 && x % 6 < 2;
    const isHeading = (x: number, y: number) => x >= 60 && x < 400 && y >= 60 && y < 90 && x % 24 < 9;
    const sharp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) sharp[y * w + x] = isText(x / scale, y / scale) || isHeading(x / scale, y / scale) ? 40 : 230;
    const soft = blur(sharp, w, h, sigma * scale);
    const noise = noiseSource(19);
    const photo = raster(w, h, (x, y) => {
      const v = soft[y * w + x] * gain * (1 - 0.3 * (y / h)) + noise() * noiseLevel;
      return [v, v * 0.97, v * 0.9];
    });
    /** Mean output level over a rectangle given on the 600×800 page. */
    const mean = (img: Raster, x0: number, y0: number, x1: number, y1: number) => {
      let sum = 0;
      let count = 0;
      for (let y = y0 * scale; y < y1 * scale; y++) for (let x = x0 * scale; x < x1 * scale; x++, count++) sum += img.data[(y * w + x) * 4 + 1];
      return sum / count;
    };
    return { photo, mean };
  }

  // The middle of three text lines (top, middle and bottom of the page) and the gaps under them.
  const lines = [140, 404, 668];

  it("has a fixture worth testing: grey smudges on grey paper", () => {
    const { photo, mean } = poorPhoto(1, 2.2, 0.55, 7);
    const paper = mean(photo, 60, 100, 540, 130);
    const text = mean(photo, 60, 142, 540, 148);
    expect(paper).toBeLessThan(130);
    expect(paper - text).toBeLessThan(40);
    expect(paper - text).toBeGreaterThan(15);
  });

  for (const filter of ["color", "gray", "bw"] as const) {
    it(`${filter}: the text is still there, darker than it came, on white paper`, () => {
      const { photo, mean } = poorPhoto(1, 2.2, 0.55, 7);
      const out = enhance(photo, filter);
      for (const y of lines) {
        const text = mean(out, 60, y + 2, 540, y + 8);
        const gap = mean(out, 60, y + 13, 540, y + 19);
        expect(text, `text line at ${y}`).toBeLessThan(175);
        expect(gap - text, `text line at ${y} against the gap under it`).toBeGreaterThan(70);
      }
      expect(mean(out, 60, 64, 400, 86), "heading").toBeLessThan(190);
      // Margins and the space between heading and text: clean paper.
      for (const [x0, y0, x1, y1] of [[10, 10, 590, 50], [10, 100, 590, 130], [10, 710, 590, 790], [550, 140, 590, 700]]) {
        expect(mean(out, x0, y0, x1, y1), `paper at ${x0},${y0}`).toBeGreaterThan(250);
      }
    });
  }

  it("color: the paper has no specks of colour left by the noise", () => {
    const { photo } = poorPhoto(1, 2.2, 0.55, 7);
    // Noise of its own in every channel, as a sensor's.
    const noise = noiseSource(29);
    for (let i = 0; i < photo.data.length; i++) if (i % 4 !== 3) photo.data[i] += noise() * 14;
    const out = enhance(photo, "color");
    let tinted = 0;
    let count = 0;
    for (let y = 100; y < 130; y++) {
      for (let x = 10; x < 590; x++, count++) {
        const [r, g, b] = px(out, x, y);
        if (Math.max(r, g, b) - Math.min(r, g, b) > 12) tinted++;
      }
    }
    expect(tinted / count).toBeLessThan(0.002);
  });

  it("looks the same on the small screen copy and on the full-size page", () => {
    const small = poorPhoto(1, 1.2, 0.8, 3);
    const large = poorPhoto(3, 1.2, 0.8, 3);
    const a = enhance(small.photo, "gray");
    const b = enhance(large.photo, "gray");
    for (const y of lines) {
      expect(Math.abs(small.mean(a, 60, y + 2, 540, y + 8) - large.mean(b, 60, y + 2, 540, y + 8)), `text line at ${y}`).toBeLessThan(25);
      expect(Math.abs(small.mean(a, 60, y + 13, 540, y + 19) - large.mean(b, 60, y + 13, 540, y + 19)), `gap under ${y}`).toBeLessThan(8);
    }
  });
});

describe("processScan", () => {
  // A landscape sheet lying on a table, with a red mark in its top-left corner.
  const sheet: Quad = [P(100, 150), P(700, 150), P(700, 450), P(100, 450)];
  const table = photo(800, 600, sheet);
  const marked: Raster = {
    ...table,
    data: raster(800, 600, (x, y) => (x >= 110 && x < 150 && y >= 160 && y < 200 ? [200, 30, 30] : px(table, x, y))).data,
  };

  it("crops to the sheet, cleans it and turns it", () => {
    const quad = detectDocument(marked)!;
    const upright = processScan(marked, { quad, filter: "color", turns: 0 }, 4000);
    expect(Math.abs(upright.width - 601)).toBeLessThanOrEqual(8);
    expect(Math.abs(upright.height - 301)).toBeLessThanOrEqual(8);
    // No table left at the borders: paper is white right up to the edge.
    for (const [x, y] of [[0, 150], [upright.width - 1, 150], [300, 0], [300, upright.height - 1]]) {
      expect(Math.min(...px(upright, x, y)), `at ${x},${y}`).toBeGreaterThanOrEqual(235);
    }
    // In black and white a sliver of table would be a solid line around the page.
    const bw = processScan(marked, { quad, filter: "bw", turns: 0 }, 4000);
    let dark = 0;
    for (let x = 0; x < bw.width; x++) dark += (px(bw, x, 0)[0] < 128 ? 1 : 0) + (px(bw, x, bw.height - 1)[0] < 128 ? 1 : 0);
    for (let y = 0; y < bw.height; y++) dark += (px(bw, 0, y)[0] < 128 ? 1 : 0) + (px(bw, bw.width - 1, y)[0] < 128 ? 1 : 0);
    expect(dark).toBe(0);
    const [r, g] = px(upright, 30, 30);
    expect(r - g).toBeGreaterThan(100);

    // A quarter turn clockwise: portrait, and the mark moves to the top right.
    const turned = processScan(marked, { quad, filter: "color", turns: 1 }, 4000);
    expect([turned.width, turned.height]).toEqual([upright.height, upright.width]);
    const [tr, tg] = px(turned, turned.width - 31, 30);
    expect(tr - tg).toBeGreaterThan(100);
  });

  it("keeps the whole photo when the outline is the whole photo: nothing is trimmed at its borders", () => {
    // A mark in each corner pixel: any trimming would lose them.
    const corners: [number, number][] = [[0, 0], [799, 0], [799, 599], [0, 599]];
    const cornered: Raster = {
      ...table,
      data: raster(800, 600, (x, y) => (corners.some(([cx, cy]) => cx === x && cy === y) ? [255, 0, 255] : px(table, x, y))).data,
    };
    const out = processScan(cornered, { quad: fullQuad(800, 600), filter: "original", turns: 0 }, 4000);
    expect([out.width, out.height]).toEqual([800, 600]);
    for (const [x, y] of corners) expect(px(out, x, y)).toEqual([255, 0, 255]);
    // A side on the border stays there; the sides inside the photo still come in a little.
    const half = processScan(cornered, { quad: [P(0, 0), P(400, 0), P(400, 599), P(0, 599)], filter: "original", turns: 0 }, 4000);
    expect(px(half, 0, 0)).toEqual([255, 0, 255]);
    expect(half.width).toBeLessThan(401);
    expect(half.height).toBe(600);
  });

  it("limits the page size", () => {
    const small = processScan(marked, { quad: sheet, filter: "original", turns: 0 }, 200);
    expect(small.width).toBe(200);
    expect(small.height).toBe(100);
  });
});

describe("scanToPdf", () => {
  it("makes one page per scan, as tall as an A4 sheet, with the picture's proportions", async () => {
    const out = await scanToPdf([
      { bytes: makeJpeg(210, 297), mime: "image/jpeg" },
      { bytes: makePng(400, 200), mime: "image/png" },
    ]);
    expect(pageCountOf(out)).toBe(2);
    const a = displaySize(out, 0);
    expect(a.height).toBeCloseTo(841.89, 0);
    expect(a.width).toBeCloseTo(841.89 * (210 / 297), 0);
    const b = displaySize(out, 1);
    expect(b.width).toBeCloseTo(841.89, 0);
    expect(b.height).toBeCloseTo(841.89 / 2, 0);
  });

  it("refuses an empty scan", async () => {
    await expect(scanToPdf([])).rejects.toThrow();
  });
});
