import { describe, expect, it } from "vitest";
import { detectInk, inkMask, inpaint, type Raster } from "@/pdf/inpaint";

type Fn = (x: number, y: number) => [number, number, number];

function raster(width: number, height: number, fn: Fn): Raster {
  const data = new Uint8ClampedArray(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(fn(x, y), (y * width + x) * 3);
  }
  return { data, width, height, channels: 3 };
}

/** Deterministic gaussian noise so the fixtures never change between runs. */
function noiseSource(seed: number): () => number {
  let s = seed;
  const uniform = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

/** Letter-like strokes: 3 px wide verticals, a horizontal bar and a diagonal. */
function isStroke(x: number, y: number): boolean {
  if (y < 30 || y > 70) return false;
  for (const x0 of [40, 60, 80, 120, 150]) if (x >= x0 && x < x0 + 3) return true;
  if (y >= 48 && y < 51 && x >= 40 && x < 100) return true;
  return Math.abs(x - 120 - (y - 30)) < 2 && x > 120 && x < 160;
}

function nearStroke(x: number, y: number, d: number): boolean {
  for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) if (isStroke(x + dx, y + dy)) return true;
  return false;
}

function stddev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

const region = { x0: 10, y0: 10, x1: 190, y1: 90 };

describe("inkMask", () => {
  it("finds dark strokes over a gradient", () => {
    const grad = (x: number): number => 100 + (x / 200) * 120;
    const img = raster(200, 100, (x, y) => (isStroke(x, y) ? [10, 10, 10] : [grad(x), grad(x) * 0.9, grad(x) * 0.8]));
    const res = detectInk(img, { region });
    expect(res.polarity).toBe("dark");
    let strokes = 0;
    let covered = 0;
    let falsePositives = 0;
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 200; x++) {
        if (isStroke(x, y)) {
          strokes++;
          covered += res.mask[y * 200 + x];
        } else if (res.mask[y * 200 + x] && !nearStroke(x, y, 2)) {
          falsePositives++;
        }
      }
    }
    expect(covered / strokes).toBeGreaterThan(0.98);
    // The mask is only the strokes plus a thin halo.
    expect(falsePositives).toBe(0);
  });

  it("works for light text on a dark background", () => {
    const img = raster(200, 100, (x, y) => (isStroke(x, y) ? [235, 235, 235] : [40, 45, 60]));
    const res = detectInk(img, { region });
    expect(res.polarity).toBe("light");
    expect(res.mask[50 * 200 + 41]).toBe(1);
    expect(res.mask[20 * 200 + 20]).toBe(0);
  });

  it("does not take a rule that crosses the whole zone for ink", () => {
    const img = raster(200, 100, (x, y) => (isStroke(x, y) || (y >= 80 && y < 82) ? [0, 0, 0] : [255, 255, 255]));
    const mask = inkMask(img, { region });
    expect(mask[50 * 200 + 41]).toBe(1);
    // Far from any letter, in the middle of the rule.
    expect(mask[80 * 200 + 20]).toBe(0);
    expect(mask[81 * 200 + 180]).toBe(0);
  });

  it("reports no ink on a clean background", () => {
    const img = raster(200, 100, () => [250, 250, 250]);
    expect(detectInk(img, { region }).count).toBe(0);
  });
});

describe("inpaint", () => {
  it("rebuilds a gradient under the strokes within a few levels", () => {
    const grad = (x: number): number => 100 + (x / 200) * 120;
    const clean = raster(200, 100, (x) => [grad(x), grad(x) * 0.9, grad(x) * 0.8]);
    const img = raster(200, 100, (x, y) => (isStroke(x, y) ? [10, 10, 10] : [grad(x), grad(x) * 0.9, grad(x) * 0.8]));
    const mask = inkMask(img, { region });
    const out = inpaint(img, mask, { grain: false });
    let err = 0;
    let n = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      for (let k = 0; k < 3; k++) err += Math.abs(out.data[i * 3 + k] - clean.data[i * 3 + k]);
      n += 3;
    }
    expect(n).toBeGreaterThan(300);
    expect(err / n).toBeLessThan(6);
  });

  it("gives the filled paper the grain of the surrounding paper", () => {
    const noise = noiseSource(7);
    const paper = (): [number, number, number] => {
      const v = 200 + noise() * 4;
      return [v, v, v];
    };
    const img = raster(200, 100, (x, y) => (isStroke(x, y) ? [10, 10, 10] : paper()));
    const mask = inkMask(img, { region });
    const out = inpaint(img, mask);
    const filled: number[] = [];
    const around: number[] = [];
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) filled.push(out.data[i * 3]);
      else around.push(img.data[i * 3]);
    }
    const ratio = stddev(filled) / stddev(around);
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(1.4);
    // Without grain the fill is clearly smoother than the paper.
    const smooth = inpaint(img, mask, { grain: false });
    const flat: number[] = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) flat.push(smooth.data[i * 3]);
    expect(stddev(flat)).toBeLessThan(stddev(around) * 0.5);
  });

  it("changes only the masked pixels and the guard ring around them", () => {
    const img = raster(200, 100, (x, y) => (isStroke(x, y) ? [10, 10, 10] : [210, 200, 190]));
    const mask = inkMask(img, { region });
    const out = inpaint(img, mask);
    const near = (x: number, y: number, d: number) => {
      for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) if (mask[(y + dy) * 200 + x + dx]) return true;
      return false;
    };
    for (let y = 3; y < 97; y++) {
      for (let x = 3; x < 197; x++) {
        if (near(x, y, 2)) continue;
        const i = y * 200 + x;
        expect([out.data[i * 3], out.data[i * 3 + 1], out.data[i * 3 + 2]]).toEqual([img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]]);
      }
    }
    // Without a guard ring only the mask changes.
    const bare = inpaint(img, mask, { guard: 0 });
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) continue;
      expect([bare.data[i * 3], bare.data[i * 3 + 1], bare.data[i * 3 + 2]]).toEqual([img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]]);
    }
  });

  it("does not smear the soft edge of the ink into the fill", () => {
    // Blurred strokes: a soft halo around each core.
    const soft = (x: number, y: number): number => {
      if (y < 30 || y > 70) return 0;
      let best = 0;
      for (const x0 of [40, 60, 80, 120, 150]) best = Math.max(best, Math.exp(-(((x - (x0 + 1.5)) / 5) ** 2)));
      return best;
    };
    const img = raster(200, 100, (x, y) => {
      const v = 245 - soft(x, y) * 235;
      return [v, v, v];
    });
    const plain = inkMask(img, { region, dpi: 300, dilate: 2 });
    const hyst = inkMask(img, { region, dpi: 300, dilate: 4, hysteresis: true });
    const ghosts = (mask: Uint8Array) => {
      const out = inpaint(img, mask, { grain: false, guard: 0 });
      let n = 0;
      for (let y = 30; y <= 70; y++) for (let x = 30; x < 170; x++) if (Math.abs(out.data[(y * 200 + x) * 3] - 245) > 3) n++;
      return n;
    };
    expect(ghosts(hyst)).toBe(0);
    expect(ghosts(plain)).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const noise = noiseSource(3);
    const img = raster(200, 100, (x, y) => (isStroke(x, y) ? [10, 10, 10] : [180 + noise() * 5, 180 + noise() * 5, 180 + noise() * 5]));
    const mask = inkMask(img, { region });
    const a = inpaint(img, mask);
    const b = inpaint(img, mask);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    const c = inpaint(img, mask, { seed: 99 });
    expect(Array.from(c.data)).not.toEqual(Array.from(a.data));
  });

  it("leaves the image alone when the mask is empty", () => {
    const img = raster(20, 20, () => [1, 2, 3]);
    const out = inpaint(img, new Uint8Array(400));
    expect(Array.from(out.data)).toEqual(Array.from(img.data));
  });
});
