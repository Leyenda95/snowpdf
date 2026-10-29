import {
  BlendMode,
  LineCapStyle,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "@cantoo/pdf-lib";
import type { EditorObject, TextObject } from "@/model/types";
import { embedStandardFont, encodableText } from "./fonts";
import { fontProgram, loadFontkit, loadFontProgram } from "./fontProgram";
import { hexToColor } from "./pageGeometry";
import { rad } from "./objectGeometry";
import { TEXT_PADDING, isSpace, layoutText, lineStartX, textWidth } from "./textLayout";
import { SYMBOL_PATHS, arrowHead } from "./symbols";

export interface BakeAsset {
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
}

/** A document font reused by edited text (see TextObject.sourceFont). */
export interface BakeFont {
  bytes: Uint8Array;
  name: string;
}

/** Substitutions off: the drawn width must be the sum of the letters, as measured by the layout. */
const NO_FEATURES = { liga: false, clig: false, dlig: false, calt: false, kern: false };

/**
 * Draws editor objects into page content. Every object is painted inside its own local
 * coordinate system (origin at the frame centre, x along the object, y up), so rotation is a
 * single `cm` and every kind of object shares the same placement code.
 */
export class Baker {
  private images = new Map<string, Promise<PDFImage>>();
  private fonts = new Map<string, Promise<PDFFont | null>>();
  private fontkitReady: Promise<void> | null = null;

  constructor(
    private readonly doc: PDFDocument,
    private readonly asset: (id: string) => BakeAsset,
    private readonly font: (id: string) => BakeFont | null = () => null,
  ) {}

  /** Embed a document font once; null when it is not available (the text uses its fallback). */
  private sourceFont(id: string): Promise<PDFFont | null> {
    let font = this.fonts.get(id);
    if (!font) {
      font = (async () => {
        const f = this.font(id);
        if (!f) return null;
        await loadFontProgram(id, f.bytes);
        this.fontkitReady ??= loadFontkit().then((fk) => this.doc.registerFontkit(fk as unknown as Parameters<PDFDocument["registerFontkit"]>[0]));
        await this.fontkitReady;
        // Already a subset of the original: embedding it whole avoids re-subsetting it.
        return this.doc.embedFont(f.bytes, { subset: false, customName: f.name, features: NO_FEATURES });
      })().catch(() => null);
      this.fonts.set(id, font);
    }
    return font;
  }

  /** The fonts of `obj`'s chain (see fontChain), plus the object as it will be laid out. */
  private async textFonts(obj: TextObject): Promise<{ text: TextObject; fonts: PDFFont[] }> {
    const standard = await embedStandardFont(this.doc, obj.font, obj.bold, obj.italic);
    const source = obj.useSourceFont && obj.sourceFont ? await this.sourceFont(obj.sourceFont) : null;
    if (source && fontProgram(obj.sourceFont)) return { text: obj, fonts: [source, standard] };
    // Measure and draw with the fallback alike, so they never disagree.
    return { text: { ...obj, useSourceFont: false }, fonts: [standard] };
  }

  private image(id: string): Promise<PDFImage> {
    let img = this.images.get(id);
    if (!img) {
      const a = this.asset(id);
      img = a.mime === "image/png" ? this.doc.embedPng(a.bytes) : this.doc.embedJpg(a.bytes);
      this.images.set(id, img);
    }
    return img;
  }

  async draw(page: PDFPage, obj: EditorObject): Promise<void> {
    const { cx, cy, w, h, rot } = obj.frame;
    const c = Math.cos(rad(rot));
    const s = Math.sin(rad(rot));
    // Resolve async resources first so the q ... Q block below stays contiguous.
    const text = obj.kind === "text" ? await this.textFonts(obj) : null;
    const image = obj.kind === "image" ? await this.image(obj.assetId) : null;
    // Only a reconstructed patch is drawn: for the other methods the real background is already there.
    const patch = obj.kind === "erase" && obj.method === "pixels" && obj.assetId && obj.renderBox ? await this.image(obj.assetId) : null;

    if (obj.kind === "erase") {
      // The patch covers an axis-aligned box in user space (not the possibly rotated frame).
      if (patch && obj.renderBox) {
        const [x0, y0, x1, y1] = obj.renderBox;
        page.pushOperators(pushGraphicsState());
        try {
          page.drawImage(patch, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
        } finally {
          page.pushOperators(popGraphicsState());
        }
      }
      return;
    }

    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(c, s, -s, c, cx, cy));
    try {
      const opacity = obj.opacity;
      switch (obj.kind) {
        case "text": {
          const { text: o, fonts } = text!;
          const layout = layoutText(o);
          const standard = fonts[fonts.length - 1];
          // For replaced text the original glyphs are removed for real; `background` is only
          // the colour used on screen to cover them, so no box is painted.
          if (obj.background && !obj.replaces) {
            page.drawRectangle({ x: -w / 2, y: -h / 2, width: w, height: h, color: hexToColor(obj.background), opacity });
          }
          // Horizontal scale: draw in a squeezed coordinate system; layout widths are already
          // scaled, so x positions are divided by it.
          const hs = o.hScale ?? 1;
          if (hs !== 1) page.pushOperators(pushGraphicsState(), concatTransformationMatrix(hs, 0, 0, 1, 0, 0));
          layout.lines.forEach((line, i) => {
            // The standard font cannot encode everything ("?" instead): re-measure those spans.
            const pieces = line.spans.map((span) => {
              if (fonts[span.font] !== standard) return { text: span.text, font: fonts[span.font], width: span.width };
              const encoded = encodableText(standard, span.text);
              return { text: encoded, font: standard, width: textWidth(encoded, { ...o, useSourceFont: false }, o.size) * hs };
            });
            const spacing = (t: string) => [...t].filter(isSpace).length * layout.wordSpacing;
            const lw = pieces.reduce((sum, p) => sum + p.width + spacing(p.text), 0);
            let x = lineStartX(obj.align, w, lw);
            const y = h / 2 - TEXT_PADDING - i * layout.lineHeight - layout.baseline;
            for (const p of pieces) {
              if (p.text.trim()) page.drawText(p.text, { x: x / hs, y, size: obj.size, font: p.font, color: hexToColor(obj.color), opacity });
              x += p.width + spacing(p.text);
            }
          });
          if (hs !== 1) page.pushOperators(popGraphicsState());
          break;
        }
        case "image":
          page.drawImage(image!, { x: -w / 2, y: -h / 2, width: w, height: h, opacity });
          break;
        case "rect":
          if (!obj.fill && !obj.stroke) break;
          page.drawRectangle({
            x: -w / 2,
            y: -h / 2,
            width: w,
            height: h,
            color: obj.fill ? hexToColor(obj.fill) : undefined,
            borderColor: obj.stroke ? hexToColor(obj.stroke) : undefined,
            borderWidth: obj.stroke ? obj.strokeWidth : 0,
            opacity,
            borderOpacity: opacity,
          });
          break;
        case "ellipse":
          if (!obj.fill && !obj.stroke) break;
          page.drawEllipse({
            x: 0,
            y: 0,
            xScale: w / 2,
            yScale: h / 2,
            color: obj.fill ? hexToColor(obj.fill) : undefined,
            borderColor: obj.stroke ? hexToColor(obj.stroke) : undefined,
            borderWidth: obj.stroke ? obj.strokeWidth : 0,
            opacity,
            borderOpacity: opacity,
          });
          break;
        case "line":
        case "arrow": {
          const color = hexToColor(obj.stroke);
          const head = obj.kind === "arrow" ? arrowHead(obj.strokeWidth, w) : null;
          page.drawLine({
            start: { x: -w / 2, y: 0 },
            end: { x: head ? w / 2 - head.length * 0.6 : w / 2, y: 0 },
            thickness: obj.strokeWidth,
            color,
            opacity,
            lineCap: obj.dashed ? LineCapStyle.Butt : LineCapStyle.Round,
            dashArray: obj.dashed ? [obj.strokeWidth * 3, obj.strokeWidth * 2] : undefined,
          });
          if (head) {
            const x0 = w / 2 - head.length;
            page.drawSvgPath(`M ${w / 2} 0 L ${x0} ${-head.width / 2} L ${x0} ${head.width / 2} Z`, { x: 0, y: 0, color, opacity });
          }
          break;
        }
        case "ink": {
          const d = obj.strokes
            .filter((st) => st.length >= 2)
            .map((st) => {
              let path = `M ${st[0] * w} ${st[1] * h}`;
              for (let i = 2; i < st.length; i += 2) path += ` L ${st[i] * w} ${st[i + 1] * h}`;
              if (st.length === 2) path += ` L ${st[0] * w + 0.01} ${st[1] * h}`;
              return path;
            })
            .join(" ");
          if (d) {
            page.drawSvgPath(d, {
              x: -w / 2,
              y: h / 2,
              borderColor: hexToColor(obj.color),
              borderWidth: obj.strokeWidth,
              borderOpacity: opacity,
              borderLineCap: LineCapStyle.Round,
            });
          }
          break;
        }
        case "highlight":
          page.drawRectangle({ x: -w / 2, y: -h / 2, width: w, height: h, color: hexToColor(obj.color), opacity, blendMode: BlendMode.Multiply });
          break;
        case "whiteout":
        case "redact":
          page.drawRectangle({ x: -w / 2, y: -h / 2, width: w, height: h, color: hexToColor(obj.color), opacity: 1 });
          break;
        case "symbol": {
          const sym = SYMBOL_PATHS[obj.symbol];
          const scale = Math.min(w, h) / 24;
          const color = hexToColor(obj.color);
          page.drawSvgPath(sym.d, {
            x: -12 * scale,
            y: 12 * scale,
            scale,
            ...(sym.mode === "fill"
              ? { color, opacity }
              : { borderColor: color, borderWidth: sym.strokeWidth, borderOpacity: opacity, borderLineCap: LineCapStyle.Round }),
          });
          break;
        }
      }
    } finally {
      page.pushOperators(popGraphicsState());
    }
  }
}
