import type { CSSProperties } from "react";
import { getFont } from "@/model/registry";
import type { TextObject } from "@/model/types";
import { cssFontFamily } from "@/pdf/fonts";
import { TEXT_PADDING, layoutText } from "@/pdf/textLayout";

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
    wordSpacing: (layoutText(obj).wordSpacing * scale) / (obj.hScale || 1),
  };
}

/**
 * Box geometry of a text object's element: padding, plus the horizontal scale (like PDF's Tz)
 * done as a transform of an element that is `1/hScale` wider, so after scaling it fills the
 * frame. Nothing is added for normal text.
 */
export function textBoxStyle(obj: TextObject, scale: number): CSSProperties {
  const hs = obj.hScale || 1;
  const pad = TEXT_PADDING * scale;
  if (hs === 1) return { padding: pad };
  return {
    padding: `${pad}px ${pad / hs}px`,
    width: (obj.frame.w * scale) / hs,
    height: obj.frame.h * scale,
    right: "auto",
    bottom: "auto",
    transform: `scaleX(${hs})`,
    transformOrigin: "0 0",
  };
}
