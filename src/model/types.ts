/**
 * Core document model of SnowPDF.
 *
 * Geometry convention (see docs/ARCHITECTURE.md, "Coordinates"):
 * - All object geometry is stored in the page's PDF *user space*: points (1/72 in),
 *   origin at the bottom-left of the MediaBox coordinate system, y pointing up,
 *   ignoring page rotation. Rotating a page therefore rotates its objects with it.
 * - `Frame.rot` is the object's rotation in user space, counter-clockwise, in degrees.
 *   An object created on a page displayed with rotation R gets rot = R so it looks upright.
 */

export type Rotation = 0 | 90 | 180 | 270;

/** [x0, y0, x1, y1] in PDF user space. */
export type PdfBox = [number, number, number, number];

/** Hex colour "#rrggbb". */
export type HexColor = string;

export interface Frame {
  /** Centre in user space. */
  cx: number;
  cy: number;
  /** Size in points, measured along the object's own (rotated) axes. */
  w: number;
  h: number;
  /** Counter-clockwise rotation in user space, degrees. */
  rot: number;
}

export type FontFamily = "helvetica" | "times" | "courier";

export type ObjectKind =
  | "text"
  | "image"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "ink"
  | "highlight"
  | "whiteout"
  | "redact"
  | "erase"
  | "symbol";

interface ObjectBase {
  id: string;
  pageId: string;
  kind: ObjectKind;
  frame: Frame;
  /** 0..1 */
  opacity: number;
}

export interface TextObject extends ObjectBase {
  kind: "text";
  text: string;
  font: FontFamily;
  bold: boolean;
  italic: boolean;
  /** Font size in points. */
  size: number;
  color: HexColor;
  align: "left" | "center" | "right";
  /** Line height as a multiple of `size`. */
  lineHeight: number;
  /** Optional opaque fill painted behind the text box (used when editing existing text). */
  background: HexColor | null;
  /**
   * Areas (user space) of the original page content this text replaces. On export the
   * original content inside them is removed for real (MuPDF redaction without black boxes).
   */
  replaces: PdfBox[] | null;
  /**
   * Font program this text uses (a FontAsset id: a font of the original PDF or one installed
   * on this computer). Characters it lacks fall back to `font`/`bold`/`italic`.
   */
  sourceFont: string | null;
  /** Whether `sourceFont` is used; false = standard `font` only (kept so the UI can switch back). */
  useSourceFont: boolean;
  /** The original PDF's font for this line ("edit text"), so the UI can always go back to it. */
  documentFont?: string | null;
  /**
   * Content width (points) a single-line text is stretched to with extra word spacing, so an
   * edited line of a justified paragraph stays as wide as the original. Null = natural width.
   */
  justifyWidth: number | null;
}

export interface ImageObject extends ObjectBase {
  kind: "image";
  assetId: string;
  /** True for signatures/initials (only affects UI labels). */
  signature: boolean;
}

export interface ShapeObject extends ObjectBase {
  kind: "rect" | "ellipse";
  stroke: HexColor | null;
  fill: HexColor | null;
  strokeWidth: number;
}

/** A segment along the frame's local x axis, from (-w/2, 0) to (w/2, 0). */
export interface LineObject extends ObjectBase {
  kind: "line" | "arrow";
  stroke: HexColor;
  strokeWidth: number;
  dashed: boolean;
}

export interface InkObject extends ObjectBase {
  kind: "ink";
  /**
   * Each stroke is a flat list [x0, y0, x1, y1, ...] normalised to 0..1 inside the frame,
   * x to the right and y DOWN in the object's upright orientation.
   */
  strokes: number[][];
  color: HexColor;
  strokeWidth: number;
}

export interface HighlightObject extends ObjectBase {
  kind: "highlight";
  color: HexColor;
}

/** Opaque box that visually hides content (content stays in the file). */
export interface WhiteoutObject extends ObjectBase {
  kind: "whiteout";
  color: HexColor;
}

/** Real redaction: content under it is removed on export, then the box is painted. */
export interface RedactObject extends ObjectBase {
  kind: "redact";
  color: HexColor;
}

export type EraseMethod = "text" | "vector" | "pixels" | "none";

/** Magic eraser: removes the content inside the frame and shows the real background. */
export interface EraseObject extends ObjectBase {
  kind: "erase";
  /** Chosen by analysis; null while it is being analysed. "none" = nothing to erase. */
  method: EraseMethod | null;
  /**
   * Render of `renderBox` after erasing (ImageAsset id). Shown on screen for every method;
   * exported only for "pixels" (the reconstructed patch).
   */
  assetId: string | null;
  /** User-space box the asset covers: the frame's bbox grown by 1 pt. */
  renderBox: PdfBox | null;
}

export type SymbolName = "check" | "cross" | "dot" | "circle";

export interface SymbolObject extends ObjectBase {
  kind: "symbol";
  symbol: SymbolName;
  color: HexColor;
}

export type EditorObject =
  | TextObject
  | ImageObject
  | ShapeObject
  | LineObject
  | InkObject
  | HighlightObject
  | WhiteoutObject
  | RedactObject
  | EraseObject
  | SymbolObject;

export interface PageRef {
  id: string;
  /** Source document id, or null for a blank page created in SnowPDF. */
  sourceId: string | null;
  /** 0-based page index inside the source. */
  sourceIndex: number;
  /** Intrinsic /Rotate of the source page. */
  baseRotation: Rotation;
  /** Extra clockwise rotation applied by the user. */
  rotation: Rotation;
  /** Visible box of the source page (pdf.js `page.view`, i.e. the CropBox) in user space. */
  view: PdfBox;
  /** User-defined crop (user space). Replaces `view` when set. */
  crop: PdfBox | null;
}

/** Undoable document state. */
export interface DocState {
  pages: PageRef[];
  /** Painting order = array order. */
  objects: EditorObject[];
}

export interface SourceInfo {
  id: string;
  name: string;
  /** Absolute path on disk when known (desktop). */
  path: string | null;
  size: number;
  pageCount: number;
  /** True when the original file was encrypted and was decrypted on open. */
  wasEncrypted: boolean;
  hasForm: boolean;
}

export interface ImageAsset {
  id: string;
  mime: "image/png" | "image/jpeg";
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Object URL for on-screen display. */
  url: string;
}

/** Font program taken from an opened PDF (pdf.js' OpenType conversion of the embedded font). */
export interface FontAsset {
  id: string;
  /** PDF font name without the subset tag, e.g. "Calibri-Bold". */
  name: string;
  /** Family shown in the UI, e.g. "Calibri". */
  family: string;
  bytes: Uint8Array;
  /** CSS weight, 100 (thin) … 900 (black). */
  weight: number;
  bold: boolean;
  italic: boolean;
  /** Embedded in the opened PDF, or installed on this computer. */
  origin: "document" | "system";
}

/** Total clockwise rotation used to display a page. */
export function displayRotation(page: PageRef): Rotation {
  return ((page.baseRotation + page.rotation) % 360) as Rotation;
}

/** The box actually shown/exported for a page. */
export function pageBox(page: PageRef): PdfBox {
  return page.crop ?? page.view;
}
