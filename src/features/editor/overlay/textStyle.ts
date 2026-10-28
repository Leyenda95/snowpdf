import type { CSSProperties } from "react";
import { getFont } from "@/model/registry";
import type { TextObject } from "@/model/types";
import { cssFontFamily } from "@/pdf/fonts";
import { layoutText } from "@/pdf/textLayout";

/**
 * Font properties of a text object on screen (view and in-place editor alike). A document or
 * system font is asked for with its own weight and slant, so its FontFace matches exactly and
 * fallback letters get the nearest real weight of the standard font.
 */
export function textFontStyle(obj: TextObject, scale: number): CSSProperties {
  const font = obj.useSourceFont && obj.sourceFont ? getFont(obj.sourceFont) : null;
  return {
    fontFamily: cssFontFamily(obj),
    fontWeight: font ? font.weight : obj.bold ? 700 : 400,
    fontStyle: (font ? font.italic : obj.italic) ? "italic" : "normal",
    wordSpacing: layoutText(obj).wordSpacing * scale,
  };
}
