import { canvasToPng } from "@/render/imageDecode";
import type { SignatureResult } from "./types";

const ALPHA_THRESHOLD = 8;
const PADDING_RATIO = 0.04;
export const MAX_SIDE = 1600;

/** Bounding box of the pixels whose alpha is above the threshold, or null if the canvas is empty. */
function inkBounds(canvas: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || canvas.width === 0 || canvas.height === 0) return null;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Crops a transparent canvas to its ink plus ~4% padding, caps the longest side at 1600 px
 * and encodes it as PNG. Returns null when there is no visible ink.
 */
export async function trimToSignature(source: HTMLCanvasElement): Promise<SignatureResult | null> {
  const box = inkBounds(source);
  if (!box) return null;
  const pad = Math.max(2, Math.round(Math.max(box.w, box.h) * PADDING_RATIO));
  const fullW = box.w + pad * 2;
  const fullH = box.h + pad * 2;
  const scale = Math.min(1, MAX_SIDE / Math.max(fullW, fullH));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(fullW * scale));
  out.height = Math.max(1, Math.round(fullH * scale));
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, box.x, box.y, box.w, box.h, pad * scale, pad * scale, box.w * scale, box.h * scale);
  const png = await canvasToPng(out);
  return { bytes: png.bytes, width: png.width, height: png.height };
}
