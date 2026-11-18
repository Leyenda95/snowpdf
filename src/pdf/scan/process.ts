import type { Raster } from "@/pdf/inpaint";
import { enhance, type ScanFilter } from "./enhance";
import { rotateRaster, type Quad } from "./raster";
import { warpQuad } from "./warp";

/** What the user decided for one photographed sheet. */
export interface ScanSettings {
  /** The sheet's corners, in pixels of the picture given to `processScan`. */
  quad: Quad;
  filter: ScanFilter;
  /** Clockwise quarter turns applied to the straightened sheet. */
  turns: number;
}

/**
 * How far inside the outline the crop is taken (fraction of the way to the centre). A sheet's edge
 * in a photo is a blurry pixel or two; cutting exactly on it leaves a dark hairline of table
 * around the page, which black and white turns into a solid line.
 */
const CROP_INSET = 0.01;

/**
 * The outline, a little inside itself. A corner on the photo's border stays on it: there is no
 * table beyond to keep out, and "the whole photo" has to mean all of it.
 */
function insetQuad(q: Quad, fraction: number, width: number, height: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const onBorder = (v: number, size: number) => v <= 0.5 || v >= size - 1.5;
  return q.map((p) => ({
    x: onBorder(p.x, width) ? p.x : p.x + (cx - p.x) * fraction,
    y: onBorder(p.y, height) ? p.y : p.y + (cy - p.y) * fraction,
  })) as Quad;
}

/** First half of `processScan`: the sheet cropped and straightened, before filter and turns. */
export function flattenScan(photo: Raster, quad: Quad, maxSide: number): Raster {
  return warpQuad(photo, insetQuad(quad, CROP_INSET, photo.width, photo.height), maxSide);
}

/**
 * Second half: the filter and the turns. May return `flat` itself (original filter, no turns).
 * Callers that try several filters on one sheet keep `flat` and only redo this part.
 */
export function finishScanPage(flat: Raster, filter: ScanFilter, turns: number): Raster {
  const filtered = filter === "original" ? flat : enhance(flat, filter);
  return turns % 4 === 0 ? filtered : rotateRaster(filtered, turns);
}

/** Photo -> page: crop and straighten the sheet, apply the filter, turn it upright. */
export function processScan(photo: Raster, settings: ScanSettings, maxSide: number): Raster {
  return finishScanPage(flattenScan(photo, settings.quad, maxSide), settings.filter, settings.turns);
}
