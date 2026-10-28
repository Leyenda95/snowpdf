import { useMemo } from "react";
import { useDocStore } from "@/model/docStore";
import { getAsset } from "@/model/registry";
import type { EraseObject, PageRef, PdfBox } from "@/model/types";
import { boxToFrame } from "@/pdf/objectGeometry";
import { frameStyle } from "../objects";
import type { PageGeometry } from "../viewer/geometry";
import { useErasedPreview } from "./erasedPreview";

/** Magic eraser: the page as it looks once the zone is cleared, or a soft pulse while it is analysed. */
function EraseView({ obj, geom }: { obj: EraseObject; geom: PageGeometry }) {
  if (obj.method === null) {
    return (
      <div
        className="animate-pulse"
        style={{
          ...frameStyle(obj.frame, geom),
          background: "repeating-linear-gradient(45deg, rgb(11 124 245 / 0.16) 0 6px, rgb(11 124 245 / 0.05) 6px 12px)",
        }}
      />
    );
  }
  if (!obj.assetId || !obj.renderBox) return null;
  let url = "";
  try {
    url = getAsset(obj.assetId).url;
  } catch {
    return null;
  }
  return <img src={url} alt="" draggable={false} style={{ ...frameStyle(boxToFrame(obj.renderBox), geom), userSelect: "none" }} />;
}

/**
 * Original text a "edit text" object replaces: the page with those glyphs removed, as export
 * leaves it. Until that is ready (or when it cannot be made) a patch of the sampled colour.
 */
function ReplacedBox({ page, box, background, geom }: { page: PageRef; box: PdfBox; background: string; geom: PageGeometry }) {
  const preview = useErasedPreview(page, box);
  if (preview) return <img src={preview.url} alt="" draggable={false} style={{ ...frameStyle(boxToFrame(preview.box), geom), userSelect: "none" }} />;
  return <div style={{ ...frameStyle(boxToFrame(box), geom), background }} />;
}

/**
 * Painted between the page bitmap and the pdf.js layers, in the same stacking context as the
 * canvas, so highlights can really multiply with the page and replaced text can be covered.
 */
export function Underlay({ page, geom }: { page: PageRef; geom: PageGeometry }) {
  const objects = useDocStore((s) => s.doc.objects);
  const mine = useMemo(() => objects.filter((o) => o.pageId === page.id), [objects, page.id]);
  return (
    <>
      {mine.map((o) => {
        if (o.kind === "highlight") {
          return <div key={o.id} style={{ ...frameStyle(o.frame, geom), background: o.color, opacity: o.opacity, mixBlendMode: "multiply" }} />;
        }
        if (o.kind === "erase") return <EraseView key={o.id} obj={o} geom={geom} />;
        if (o.kind === "text" && o.replaces) {
          return o.replaces.map((box, i) => <ReplacedBox key={`${o.id}-${i}`} page={page} box={box} background={o.background ?? "#ffffff"} geom={geom} />);
        }
        return null;
      })}
    </>
  );
}
