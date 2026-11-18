import type { Raster } from "@/pdf/inpaint";

/* Screen side of the scanner's pictures. Reading and writing photos is the scan worker's job. */

/** Draws an RGBA raster on a canvas, resizing the canvas to it. */
export function paintRaster(canvas: HTMLCanvasElement | OffscreenCanvas, img: Raster): void {
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
}
