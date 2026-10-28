import { memo, type CSSProperties } from "react";
import { getAsset } from "@/model/registry";
import type { EditorObject } from "@/model/types";
import { SYMBOL_PATHS, arrowHead } from "@/pdf/symbols";
import { TEXT_PADDING } from "@/pdf/textLayout";
import { textFontStyle } from "./textStyle";
import { t } from "@/i18n";

/** Pure visual of an object inside its (already positioned and rotated) box. */
export const ObjectView = memo(function ObjectView({ obj, scale }: { obj: EditorObject; scale: number }) {
  const w = obj.frame.w * scale;
  const h = obj.frame.h * scale;
  const fill: CSSProperties = { position: "absolute", inset: 0, opacity: obj.opacity };

  switch (obj.kind) {
    case "text":
      return (
        <div
          className="snow-text"
          style={{
            ...fill,
            padding: TEXT_PADDING * scale,
            ...textFontStyle(obj, scale),
            fontSize: obj.size * scale,
            lineHeight: obj.lineHeight,
            color: obj.color,
            textAlign: obj.align,
            // Replaced text: the Underlay already covers just the original glyphs; painting the
            // whole box (padding, line height) would also hide what surrounds them.
            background: obj.replaces ? undefined : (obj.background ?? undefined),
            overflow: "visible",
          }}
        >
          {obj.text || "​"}
        </div>
      );
    case "image": {
      let url = "";
      try {
        url = getAsset(obj.assetId).url;
      } catch {
        // Asset missing (should not happen): show an empty box.
      }
      return <img src={url} alt="" draggable={false} style={{ ...fill, width: "100%", height: "100%", userSelect: "none" }} />;
    }
    case "rect":
    case "ellipse": {
      const sw = obj.stroke ? obj.strokeWidth * scale : 0;
      return (
        <svg style={{ ...fill, overflow: "visible" }} width={w} height={h}>
          {obj.kind === "rect" ? (
            <rect x={0} y={0} width={w} height={h} fill={obj.fill ?? "none"} stroke={obj.stroke ?? "none"} strokeWidth={sw} />
          ) : (
            <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} fill={obj.fill ?? "none"} stroke={obj.stroke ?? "none"} strokeWidth={sw} />
          )}
        </svg>
      );
    }
    case "line":
    case "arrow": {
      const sw = obj.strokeWidth * scale;
      const head = obj.kind === "arrow" ? arrowHead(obj.strokeWidth, obj.frame.w) : null;
      const hl = head ? head.length * scale : 0;
      const hw = head ? head.width * scale : 0;
      const y = h / 2;
      return (
        <svg style={{ ...fill, overflow: "visible" }} width={w} height={h}>
          <line
            x1={0}
            y1={y}
            x2={head ? w - hl * 0.6 : w}
            y2={y}
            stroke={obj.stroke}
            strokeWidth={sw}
            strokeLinecap={obj.dashed ? "butt" : "round"}
            strokeDasharray={obj.dashed ? `${sw * 3} ${sw * 2}` : undefined}
          />
          {head && <polygon points={`${w},${y} ${w - hl},${y - hw / 2} ${w - hl},${y + hw / 2}`} fill={obj.stroke} />}
        </svg>
      );
    }
    case "ink": {
      const d = obj.strokes
        .map((s) => {
          let p = `M${s[0] * w} ${s[1] * h}`;
          for (let i = 2; i < s.length; i += 2) p += `L${s[i] * w} ${s[i + 1] * h}`;
          if (s.length === 2) p += `l0.01 0`;
          return p;
        })
        .join("");
      return (
        <svg style={{ ...fill, overflow: "visible" }} width={w} height={h}>
          <path d={d} fill="none" stroke={obj.color} strokeWidth={obj.strokeWidth * scale} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    case "highlight":
      return <div style={{ ...fill, background: obj.color, mixBlendMode: "multiply" }} />;
    case "whiteout":
      return <div style={{ ...fill, background: obj.color }} />;
    case "redact":
      return (
        <div
          title={t("Se eliminará al guardar")}
          style={{
            ...fill,
            opacity: 1,
            border: "2px dashed #dc2626",
            background: "repeating-linear-gradient(45deg, rgb(220 38 38 / 0.28) 0 6px, rgb(220 38 38 / 0.08) 6px 12px)",
          }}
        />
      );
    case "erase":
      // The result is painted under the page layers (Underlay); only the selection outline shows here.
      return <div style={{ ...fill, opacity: 1 }} />;
    case "symbol": {
      const sym = SYMBOL_PATHS[obj.symbol];
      return (
        <svg style={fill} width={w} height={h} viewBox="0 0 24 24">
          <path
            d={sym.d}
            fill={sym.mode === "fill" ? obj.color : "none"}
            stroke={sym.mode === "stroke" ? obj.color : "none"}
            strokeWidth={sym.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    }
  }
});

export function objectLabel(obj: EditorObject): string {
  switch (obj.kind) {
    case "text":
      return obj.replaces ? t("Texto editado") : t("Texto");
    case "image":
      return obj.signature ? t("Firma") : t("Imagen");
    case "rect":
      return t("Rectángulo");
    case "ellipse":
      return t("Elipse");
    case "line":
      return t("Línea");
    case "arrow":
      return t("Flecha");
    case "ink":
      return t("Dibujo");
    case "highlight":
      return t("Resaltado");
    case "whiteout":
      return t("Corrector");
    case "redact":
      return t("Redacción");
    case "erase":
      return t("Borrado");
    case "symbol":
      return t("Símbolo");
  }
}
