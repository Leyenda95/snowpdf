/**
 * Browser-side image normalisation: every picture that enters a PDF becomes PNG or JPEG
 * (the formats PDF can embed directly) with its EXIF orientation applied.
 */

export interface NormalizedImage {
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

function isJpeg(b: Uint8Array): boolean {
  return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function isPng(b: Uint8Array): boolean {
  return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

/** EXIF orientation tag (1 = normal) of a JPEG, read from its APP1 segment. */
export function jpegOrientation(b: Uint8Array): number {
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const tiff = i + 10;
      const little = b[tiff] === 0x49;
      const u16 = (o: number) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const u32 = (o: number) => (little ? u16(o) | (u16(o + 2) << 16) : (u16(o) << 16) | u16(o + 2));
      const ifd = tiff + u32(tiff + 4);
      const count = u16(ifd);
      for (let e = 0; e < count; e++) {
        const entry = ifd + 2 + e * 12;
        if (entry + 10 > b.length) break;
        if (u16(entry) === 0x0112) return u16(entry + 8) || 1;
      }
      return 1;
    }
    if (marker === 0xda) break; // start of scan: no more metadata
    i += 2 + len;
  }
  return 1;
}

async function reencode(bitmap: ImageBitmap, mime: "image/png" | "image/jpeg"): Promise<NormalizedImage> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  if (mime === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, bitmap.width, bitmap.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: mime, quality: 0.92 });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, width: bitmap.width, height: bitmap.height };
}

export async function normalizeImage(bytes: Uint8Array): Promise<NormalizedImage> {
  // createImageBitmap applies EXIF orientation, so its size is the size as seen.
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  try {
    if (isPng(bytes)) return { bytes, mime: "image/png", width: bitmap.width, height: bitmap.height };
    if (isJpeg(bytes)) {
      if (jpegOrientation(bytes) === 1) return { bytes, mime: "image/jpeg", width: bitmap.width, height: bitmap.height };
      return await reencode(bitmap, "image/jpeg");
    }
    return await reencode(bitmap, "image/png");
  } finally {
    bitmap.close();
  }
}

/** Decode any data URL / blob produced by a canvas into a NormalizedImage (PNG). */
export async function canvasToPng(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<NormalizedImage> {
  const blob =
    canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: "image/png" })
      : await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: "image/png", width: canvas.width, height: canvas.height };
}
