import { useEffect, useRef } from "react";
import { useDocStore } from "@/model/docStore";
import { deleteObjects, updateObject } from "@/model/docActions";
import { newId } from "@/model/registry";
import type { TextObject } from "@/model/types";
import { TEXT_PADDING } from "@/pdf/textLayout";
import { useEditorStore } from "../editorStore";
import { refitText } from "../objects";
import { textFontStyle } from "./textStyle";

/** In-place editor for a text object; same metrics as ObjectView so nothing jumps. */
export function TextEditor({ obj, scale }: { obj: TextObject; scale: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const session = useRef(newId("edit"));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (obj.replaces || obj.text) el.select();
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    useEditorStore.getState().setEditing(null);
    const cur = useDocStore.getState().doc.objects.find((o) => o.id === obj.id);
    if (cur && cur.kind === "text" && !cur.text.trim() && !cur.replaces) deleteObjects([cur.id]);
  };

  return (
    <textarea
      ref={ref}
      className="snow-text"
      value={obj.text}
      wrap="off"
      spellCheck={false}
      onChange={(e) => {
        const cur = useDocStore.getState().doc.objects.find((o) => o.id === obj.id);
        if (!cur || cur.kind !== "text") return;
        const next = refitText(cur, { text: e.target.value });
        updateObject(obj.id, { text: next.text, frame: next.frame } as Partial<TextObject>, session.current);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
      onBlur={finish}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        margin: 0,
        border: 0,
        padding: TEXT_PADDING * scale,
        outline: "1.5px solid #0b7cf5",
        outlineOffset: 1,
        resize: "none",
        overflow: "hidden",
        background: "transparent",
        ...textFontStyle(obj, scale),
        fontSize: obj.size * scale,
        lineHeight: obj.lineHeight,
        color: obj.color,
        textAlign: obj.align,
        opacity: obj.opacity,
        caretColor: "#0b7cf5",
      }}
    />
  );
}
