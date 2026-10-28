import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EraseObject, PageRef } from "@/model/types";

const mocks = vi.hoisted(() => ({
  callMupdf: vi.fn(),
  putAsset: vi.fn(),
}));

vi.mock("@/pdf/mupdf/client", () => ({ callMupdf: mocks.callMupdf }));
vi.mock("@/ui", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/model/registry", () => ({
  getSource: () => ({ bytes: new Uint8Array([1, 2, 3]) }),
  putAsset: mocks.putAsset,
  newId: (prefix: string) => `${prefix}_x`,
}));

import { useDocStore } from "@/model/docStore";
import { addObjects, updateObject } from "@/model/docActions";
import { whenErasesSettled } from "@/features/editor/erase";

const page: PageRef = { id: "pg", sourceId: "src", sourceIndex: 0, baseRotation: 0, rotation: 0, view: [0, 0, 300, 200], crop: null };

function eraser(id = "e1", cx = 100): EraseObject {
  return { id, pageId: "pg", kind: "erase", frame: { cx, cy: 100, w: 60, h: 20, rot: 0 }, opacity: 1, method: null, assetId: null, renderBox: null };
}

/** What the engine answers for a box: the box grown by 1 pt, like the real one. */
function answer(method: "text" | "pixels" | "none", box: [number, number, number, number]) {
  return { method, png: new Uint8Array([9]), mime: "image/png", width: 10, height: 10, box: [box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1] };
}

const current = (id = "e1") => useDocStore.getState().doc.objects.find((o) => o.id === id) as EraseObject;

let assets = 0;

beforeEach(() => {
  vi.useFakeTimers();
  assets = 0;
  mocks.callMupdf.mockReset();
  mocks.putAsset.mockReset();
  mocks.putAsset.mockImplementation(() => ({ id: `asset${++assets}` }));
  mocks.callMupdf.mockImplementation(async (_op: string, arg: { box: [number, number, number, number] }) => answer("text", arg.box));
  useDocStore.getState().load({ title: "t", filePath: null, sources: {}, doc: { pages: [page], objects: [] } });
});

afterEach(() => {
  useDocStore.getState().close();
  vi.useRealTimers();
});

describe("magic eraser analysis", () => {
  it("analyses a new eraser without adding an undo step", async () => {
    addObjects([eraser()]);
    expect(current().method).toBeNull();
    const settled = whenErasesSettled();
    await vi.advanceTimersByTimeAsync(0);
    await settled;
    expect(mocks.callMupdf).toHaveBeenCalledTimes(1);
    expect(current()).toMatchObject({ method: "text", assetId: "asset1" });
    expect(useDocStore.getState().past).toHaveLength(1); // only the creation
    // Undo and redo bring the object back with its result: nothing is analysed again.
    useDocStore.getState().undo();
    useDocStore.getState().redo();
    await vi.advanceTimersByTimeAsync(1000);
    expect(current().assetId).toBe("asset1");
    expect(mocks.callMupdf).toHaveBeenCalledTimes(1);
  });

  it("forgets the result when moved and analyses again after a pause", async () => {
    addObjects([eraser()]);
    await vi.advanceTimersByTimeAsync(0);
    const first = current();
    expect(first.assetId).toBe("asset1");

    updateObject("e1", { frame: { ...first.frame, cx: 140 } }, "move");
    updateObject("e1", { frame: { ...first.frame, cx: 150 } }, "move");
    expect(current()).toMatchObject({ method: null, assetId: null, renderBox: null });
    await vi.advanceTimersByTimeAsync(200);
    expect(mocks.callMupdf).toHaveBeenCalledTimes(1); // still waiting for the drag to stop
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.callMupdf).toHaveBeenCalledTimes(2);
    expect(current()).toMatchObject({ method: "text", assetId: "asset2" });
    expect(current().renderBox).toEqual([119, 89, 181, 111]);
    // Creation + move; the result added nothing. The snapshot before the move kept its picture.
    const { past } = useDocStore.getState();
    expect(past).toHaveLength(2);
    expect((past[1].objects[0] as EraseObject).assetId).toBe("asset1");
  });

  it("drops a result that arrives after the eraser moved", async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.callMupdf.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    addObjects([eraser()]);
    await vi.advanceTimersByTimeAsync(0);
    const f = current().frame;
    updateObject("e1", { frame: { ...f, cx: 160 } });
    release(answer("pixels", [70, 90, 130, 110])); // computed for the old position
    await vi.advanceTimersByTimeAsync(0);
    // Not applied to the object where it is now...
    expect(current()).toMatchObject({ method: null, assetId: null });
    // ...but the state before the move (same frame as the result) is where undo goes: it gets it.
    expect((useDocStore.getState().past[1].objects[0] as EraseObject)).toMatchObject({ method: "pixels", assetId: "asset1" });
    await vi.advanceTimersByTimeAsync(300);
    expect(current()).toMatchObject({ method: "text", assetId: "asset2" });
    expect(current().renderBox).toEqual([129, 89, 191, 111]);
  });

  it("treats a blank page as nothing to erase and waits for pending work before saving", async () => {
    useDocStore.getState().load({ title: "t", filePath: null, sources: {}, doc: { pages: [{ ...page, sourceId: null }], objects: [] } });
    addObjects([eraser()]);
    let done = false;
    void whenErasesSettled().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(current()).toMatchObject({ method: "none", assetId: null });
    expect(mocks.callMupdf).not.toHaveBeenCalled();
  });

  it("does not keep a picture when there is nothing to erase", async () => {
    mocks.callMupdf.mockImplementation(async (_op: string, arg: { box: [number, number, number, number] }) => answer("none", arg.box));
    addObjects([eraser()]);
    await vi.advanceTimersByTimeAsync(0);
    expect(current()).toMatchObject({ method: "none", assetId: null });
    expect(assets).toBe(0);
  });
});
