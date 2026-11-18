/// <reference lib="webworker" />
import type { Raster } from "@/pdf/inpaint";
import { detectDocument } from "@/pdf/scan/detect";
import { finishScanPage, flattenScan, type ScanSettings } from "@/pdf/scan/process";
import { scaleQuad, type Quad } from "@/pdf/scan/raster";

/**
 * Web Worker doing the scanner's pixel work, so the screen never freezes on it: reading photos,
 * finding the sheet, the filters and the pages of the PDF. Messages: { id, op, arg } ->
 * { id, ok, result | error }; pixel buffers and byte arrays in results are transferred.
 *
 * The photos stay here (the screen only gets a reduced copy), keyed by the page's id.
 */

declare const self: DedicatedWorkerGlobalScope;

/** Quality of the JPEG kept from a camera frame. */
const PHOTO_QUALITY = 0.92;
/**
 * A still this much more elongated than the frame that was on screen was cut out of a narrower
 * strip of the sensor: it shows less than the camera view did.
 */
const NARROWER = 1.03;
/** Straightened sheets kept around: trying filters and turns on a page only redoes that part. */
const FLAT_CACHE = 8;

interface Photo {
  /** The photo, encoded. A camera frame is still being compressed when the page shows up. */
  bytes: Promise<Uint8Array>;
  /** The copy the screen has (RGBA, upright). Corners are given in its pixels. */
  preview: Raster;
}

const photos = new Map<string, Photo>();
const flats = new Map<string, Raster>();

function canvasOf(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
}

async function blobBytes(canvas: OffscreenCanvas, type: string, quality?: number): Promise<Uint8Array> {
  return new Uint8Array(await (await canvas.convertToBlob({ type, quality })).arrayBuffer());
}

/** The picture as RGBA pixels, its longest side reduced to `maxSide`. */
function pixels(bitmap: ImageBitmap, maxSide: number): Raster {
  const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * k));
  const height = Math.max(1, Math.round(bitmap.height * k));
  const { ctx } = canvasOf(width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height, channels: 4 };
}

/** Compresses a camera frame and lets go of it. */
async function frameToJpeg(frame: ImageBitmap): Promise<Uint8Array> {
  try {
    const { canvas, ctx } = canvasOf(frame.width, frame.height);
    ctx.drawImage(frame, 0, 0);
    return await blobBytes(canvas, "image/jpeg", PHOTO_QUALITY);
  } finally {
    frame.close();
  }
}

function forget(page: string): void {
  photos.delete(page);
  for (const key of [...flats.keys()]) if (key.startsWith(`${page}|`)) flats.delete(key);
}

/** The page's sheet, straightened at `maxSide`; the last few are remembered. */
function flatOf(page: string, photo: Photo, quad: Quad, maxSide: number): Raster {
  const key = `${page}|${maxSide}|${quad.map((p) => `${p.x},${p.y}`).join(";")}`;
  let flat = flats.get(key);
  if (flat) flats.delete(key);
  else flat = flattenScan(photo.preview, quad, maxSide);
  flats.set(key, flat);
  if (flats.size > FLAT_CACHE) flats.delete(flats.keys().next().value!);
  return flat;
}

function photoOf(page: string): Photo {
  const photo = photos.get(page);
  if (!photo) throw new Error("Unknown scan page");
  return photo;
}

const ops = {
  /**
   * Takes in a photo for a new page: an encoded image (a file, or the camera's still) or a
   * camera frame. `backup` is the frame that was on screen when a still was taken: it is used
   * if the still cannot be read, turns out smaller than the frame or shows less than it (the
   * page must hold everything the user saw). Answers as soon as the screen copy is ready; a
   * camera frame is compressed afterwards.
   */
  async add(arg: { page: string; source: ImageBitmap | Uint8Array; backup?: ImageBitmap | null; previewSide: number }): Promise<{ preview: Raster; auto: Quad | null }> {
    const { page, previewSide } = arg;
    let source = arg.source;
    const backup = arg.backup ?? null;
    let preview: Raster | null = null;
    let bytes: Promise<Uint8Array> | null = null;
    if (source instanceof Uint8Array) {
      try {
        // Decoding applies the EXIF orientation.
        const bitmap = await createImageBitmap(new Blob([source as Uint8Array<ArrayBuffer>]));
        try {
          const shape = (b: ImageBitmap) => Math.max(b.width, b.height) / Math.min(b.width, b.height);
          if (!backup || (bitmap.width * bitmap.height >= backup.width * backup.height && shape(bitmap) <= shape(backup) * NARROWER)) {
            preview = pixels(bitmap, previewSide);
            bytes = Promise.resolve(source);
          }
        } finally {
          bitmap.close();
        }
      } catch (err) {
        if (!backup) throw err;
      }
      if (preview) backup?.close();
      else if (backup) source = backup;
    }
    if (!preview || !bytes) {
      const frame = source as ImageBitmap;
      preview = pixels(frame, previewSide);
      bytes = frameToJpeg(frame);
      // A failure is reported when the page is made, if it is still there by then.
      bytes.catch(() => undefined);
    }
    forget(page);
    photos.set(page, { bytes, preview });
    // The worker keeps its copy of the pixels: the answer carries another.
    return { preview: { ...preview, data: new Uint8ClampedArray(preview.data) }, auto: detectDocument(preview) };
  },

  /** The page as it will look, from the screen copy: for the review screen. */
  render(arg: { page: string; settings: ScanSettings; maxSide: number }): Raster {
    const { page, settings, maxSide } = arg;
    const flat = flatOf(page, photoOf(page), settings.quad, maxSide);
    const out = finishScanPage(flat, settings.filter, settings.turns);
    return out === flat ? { ...flat, data: new Uint8ClampedArray(flat.data) } : out;
  },

  /**
   * The page for the PDF, from the photo at full quality (`settings.quad` is in screen-copy
   * pixels). Two-level pages compress far better, and stay crisp, without JPEG.
   */
  async encode(arg: {
    page: string;
    settings: ScanSettings;
    sourceSide: number;
    pageSide: number;
    quality: number;
  }): Promise<{ bytes: Uint8Array; mime: "image/png" | "image/jpeg" }> {
    const { page, settings, sourceSide, pageSide, quality } = arg;
    const photo = photoOf(page);
    const bitmap = await createImageBitmap(new Blob([(await photo.bytes) as Uint8Array<ArrayBuffer>]));
    let full: Raster;
    try {
      full = pixels(bitmap, sourceSide);
    } finally {
      bitmap.close();
    }
    const quad = scaleQuad(settings.quad, full.width / photo.preview.width);
    const result = finishScanPage(flattenScan(full, quad, pageSide), settings.filter, settings.turns);
    const { canvas, ctx } = canvasOf(result.width, result.height);
    ctx.putImageData(new ImageData(result.data as Uint8ClampedArray<ArrayBuffer>, result.width, result.height), 0, 0);
    return settings.filter === "bw"
      ? { bytes: await blobBytes(canvas, "image/png"), mime: "image/png" }
      : { bytes: await blobBytes(canvas, "image/jpeg", quality), mime: "image/jpeg" };
  },

  /** Lets go of pages that are gone. */
  drop(arg: { pages: string[] }): void {
    for (const page of arg.pages) forget(page);
  },
};

export type ScanWorkerOps = typeof ops;

interface Request {
  id: number;
  op: keyof ScanWorkerOps;
  arg: unknown;
}

function transferables(result: unknown): Transferable[] {
  if (result === null || typeof result !== "object") return [];
  // A raster (`data`) or bytes, as the result itself or one level down; each buffer only once.
  const out = new Set<Transferable>();
  for (const value of [result, ...Object.values(result)]) {
    const data: unknown = value !== null && typeof value === "object" && "data" in value ? value.data : value;
    if ((data instanceof Uint8Array || data instanceof Uint8ClampedArray) && data.buffer instanceof ArrayBuffer) out.add(data.buffer);
  }
  return [...out];
}

/** One request at a time, in order: a later one may count on what an earlier one left. */
let queue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, op, arg } = event.data;
  queue = queue.then(async () => {
    try {
      const result = await (ops[op] as (a: unknown) => unknown)(arg);
      self.postMessage({ id, ok: true, result }, transferables(result));
    } catch (err) {
      self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
};
