/**
 * Placement maths for the on-screen watermark preview. It mirrors src/pdf/tools/watermark.ts
 * (display space: origin bottom-left, y up, points) so the preview lands where the PDF will.
 */

export interface Pt {
  x: number;
  y: number;
}

function rotate(x: number, y: number, degrees: number): Pt {
  const r = (degrees * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
}

/** Axis-aligned size of a w x h box turned by `degrees`. */
export function rotatedExtent(w: number, h: number, degrees: number): { w: number; h: number } {
  const r = (degrees * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return { w: w * c + h * s, h: w * s + h * c };
}

function place(side: "start" | "middle" | "end", size: number, extent: number, margin: number): number {
  if (side === "middle" || extent + 2 * margin >= size) return size / 2;
  return side === "start" ? margin + extent / 2 : size - margin - extent / 2;
}

/** Centre of a mark at one of the nine positions ("center", "top-left", "middle-right"...). */
export function edgeCenter(position: string, pageW: number, pageH: number, ext: { w: number; h: number }, margin: number): Pt {
  const [vertical, horizontal] = (position === "center" ? "middle-center" : position).split("-");
  return {
    x: place(horizontal === "left" ? "start" : horizontal === "right" ? "end" : "middle", pageW, ext.w, margin),
    y: place(vertical === "bottom" ? "start" : vertical === "top" ? "end" : "middle", pageH, ext.h, margin),
  };
}

/** Centres of the staggered grid used by the "Mosaico" option. */
export function tileCenters(pageW: number, pageH: number, markW: number, markH: number, angle: number, maxTiles = 300): Pt[] {
  const ext = rotatedExtent(markW, markH, angle);
  const along = rotate(1, 0, angle);
  const across = rotate(0, 1, angle);
  const reach = Math.hypot(pageW, pageH) / 2 + Math.hypot(ext.w, ext.h);

  for (let spread = 1; ; spread *= 1.5) {
    const stepU = (markW + Math.max(40, markW * 0.35)) * spread;
    const stepV = (markH + Math.max(50, markH * 1.5)) * spread;
    const nu = Math.ceil(reach / stepU) + 1;
    const nv = Math.ceil(reach / stepV) + 1;
    const out: Pt[] = [];
    for (let j = -nv; j <= nv; j++) {
      const shift = j % 2 !== 0 ? stepU / 2 : 0;
      for (let i = -nu; i <= nu; i++) {
        const du = i * stepU + shift;
        const dv = j * stepV;
        const x = pageW / 2 + du * along.x + dv * across.x;
        const y = pageH / 2 + du * along.y + dv * across.y;
        if (x + ext.w / 2 < 0 || x - ext.w / 2 > pageW || y + ext.h / 2 < 0 || y - ext.h / 2 > pageH) continue;
        out.push({ x, y });
      }
    }
    if (out.length <= maxTiles) return out;
  }
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Width in CSS px of `text` for a CSS font shorthand such as "italic bold 60px Helvetica, Arial". */
export function measureTextWidth(text: string, cssFont: string): number {
  if (measureContext === undefined) measureContext = document.createElement("canvas").getContext("2d");
  if (!measureContext) return text.length * 10;
  measureContext.font = cssFont;
  return measureContext.measureText(text).width;
}
