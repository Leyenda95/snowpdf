import { describe, expect, it } from "vitest";
import { useEditorStore } from "@/features/editor/editorStore";
import { commitTab, switchTab } from "@/model/tabs";

const init = { title: "t", filePath: null, sources: {}, doc: { pages: [], objects: [] } };

describe("tab switching", () => {
  it("restores the exact scroll offset of the tab you come back to", () => {
    commitTab("tab-a", init, "editor");
    useEditorStore.getState().setScroll({ top: 1234, left: 56 });

    commitTab("tab-b", init, "editor");
    useEditorStore.getState().setScroll({ top: 7, left: 0 });

    switchTab("tab-a");
    expect(useEditorStore.getState().scroll).toEqual({ top: 1234, left: 56 });

    switchTab("tab-b");
    expect(useEditorStore.getState().scroll).toEqual({ top: 7, left: 0 });
  });

  it("does not carry a pending page request over to the tab you switch to", () => {
    commitTab("tab-c", init, "editor");
    commitTab("tab-d", init, "editor");
    useEditorStore.getState().goToPage(3);

    switchTab("tab-c");
    expect(useEditorStore.getState().scrollRequest).toBeNull();
  });
});
