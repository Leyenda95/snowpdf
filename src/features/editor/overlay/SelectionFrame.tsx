import type { CSSProperties } from "react";
import type { EditorObject } from "@/model/types";
import { frameStyle, segmentEnds } from "../objects";
import type { PageGeometry } from "../viewer/geometry";
import { endpointGesture, resizeGesture, rotateGesture, type HandleDir } from "./gestures";
import { t } from "@/i18n";

const ACCENT = "#0b7cf5";

const HANDLE: CSSProperties = {
  position: "absolute",
  width: 10,
  height: 10,
  transform: "translate(-50%, -50%)",
  background: "white",
  border: `1.5px solid ${ACCENT}`,
  borderRadius: 3,
  pointerEvents: "auto",
  touchAction: "none",
};

const ALL: (HandleDir & { cursor: string })[] = [
  { hx: -1, hy: -1, cursor: "nwse-resize" },
  { hx: 0, hy: -1, cursor: "ns-resize" },
  { hx: 1, hy: -1, cursor: "nesw-resize" },
  { hx: 1, hy: 0, cursor: "ew-resize" },
  { hx: 1, hy: 1, cursor: "nwse-resize" },
  { hx: 0, hy: 1, cursor: "ns-resize" },
  { hx: -1, hy: 1, cursor: "nesw-resize" },
  { hx: -1, hy: 0, cursor: "ew-resize" },
];

function handlesFor(obj: EditorObject) {
  if (obj.kind === "text" || obj.kind === "symbol") return ALL.filter((h) => h.hx !== 0 && h.hy !== 0);
  return ALL;
}

export function SelectionFrame({ obj, geom, overlayEl }: { obj: EditorObject; geom: PageGeometry; overlayEl: HTMLElement | null }) {
  if (obj.kind === "line" || obj.kind === "arrow") {
    const ends = segmentEnds(obj.frame, geom);
    return (
      <>
        {ends.map((p, i) => (
          <div
            key={i}
            data-handle
            style={{ ...HANDLE, left: p.x, top: p.y, borderRadius: 999, cursor: "crosshair" }}
            onPointerDown={(e) => endpointGesture(e, obj, i === 0 ? "start" : "end", geom)}
          />
        ))}
      </>
    );
  }
  const box = frameStyle(obj.frame, geom);
  const w = Number(box.width);
  const h = Number(box.height);
  const rotatable = obj.kind !== "highlight" && obj.kind !== "erase";
  return (
    <div style={{ ...box, pointerEvents: "none", outline: `1.5px solid ${ACCENT}`, outlineOffset: 1 }}>
      {handlesFor(obj).map((d) => (
        <div
          key={`${d.hx}${d.hy}`}
          data-handle
          style={{ ...HANDLE, left: ((d.hx + 1) / 2) * w, top: ((d.hy + 1) / 2) * h, cursor: d.cursor }}
          onPointerDown={(e) => resizeGesture(e, obj, d, geom)}
        />
      ))}
      {rotatable && overlayEl && (
        <>
          <div style={{ position: "absolute", left: w / 2, top: -22, width: 1.5, height: 20, background: ACCENT, transform: "translateX(-50%)" }} />
          <div
            data-handle
            title={t("Girar (Mayús: de 15 en 15°)")}
            style={{ ...HANDLE, left: w / 2, top: -24, width: 12, height: 12, borderRadius: 999, cursor: "grab" }}
            onPointerDown={(e) => rotateGesture(e, obj, geom, overlayEl)}
          />
        </>
      )}
    </div>
  );
}
