/** A finished signature: PNG with transparency, already trimmed to its ink. */
export interface SignatureResult {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export type SignatureKind = "firma" | "iniciales";

/**
 * What each creation mode (draw / type / image) reports to the dialog: a function that
 * produces a canvas with the artwork on a transparent background, or null when empty.
 */
export type SignatureSource = () => HTMLCanvasElement | Promise<HTMLCanvasElement>;
