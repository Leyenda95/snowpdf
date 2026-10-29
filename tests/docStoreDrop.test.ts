import { beforeEach, describe, expect, it } from "vitest";
import { useDocStore } from "@/model/docStore";
import type { EditorObject } from "@/model/types";

const obj = (id: string) => ({ id, pageId: "p", kind: "whiteout", frame: { cx: 0, cy: 0, w: 1, h: 1, rot: 0 }, opacity: 1, color: "#fff" }) as EditorObject;
const add = (id: string) => useDocStore.getState().apply((d) => void d.objects.push(obj(id)));

describe("dropJustAdded", () => {
  beforeEach(() => useDocStore.getState().load({ title: "t", filePath: null, sources: {}, doc: { pages: [], objects: [] } }));

  it("removes the object and its undo step when it was the last step", () => {
    add("a");
    expect(useDocStore.getState().dropJustAdded("a", false)).toBe(true);
    const s = useDocStore.getState();
    expect(s.doc.objects).toHaveLength(0);
    expect(s.past).toHaveLength(0);
    expect(s.dirty).toBe(false);
  });

  it("does nothing when other steps happened since", () => {
    add("a");
    add("b");
    expect(useDocStore.getState().dropJustAdded("a", false)).toBe(false);
    expect(useDocStore.getState().doc.objects).toHaveLength(2);
  });
});
