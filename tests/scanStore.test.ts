import { beforeEach, describe, expect, it } from "vitest";
import { useScanStore, type ScanPage } from "@/features/scan/scanStore";

const page = (id: string): ScanPage => ({
  id,
  preview: { data: new Uint8ClampedArray(4), width: 1, height: 1, channels: 4 },
  quad: [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ],
  auto: null,
  filter: "color",
  turns: 0,
});

const state = () => useScanStore.getState();

describe("scan session", () => {
  beforeEach(() => state().reset());

  it("starts on the camera, with nothing to retake", () => {
    expect(state().step).toBe("camera");
    expect(state().retakeId).toBeNull();
  });

  it("a new photo goes to cropping", () => {
    state().add([page("a"), page("b")]);
    expect(state().pages.map((p) => p.id)).toEqual(["a", "b"]);
    expect(state().currentId).toBe("a");
    expect(state().step).toBe("crop");
  });

  it("a retake replaces its page in place and forgets the retake", () => {
    state().add([page("a"), page("b")]);
    state().camera("a");
    expect(state().step).toBe("camera");
    expect(state().retakeId).toBe("a");
    state().replace("a", page("c"));
    expect(state().pages.map((p) => p.id)).toEqual(["c", "b"]);
    expect(state().currentId).toBe("c");
    expect(state().step).toBe("crop");
    expect(state().retakeId).toBeNull();
  });

  it("the camera for one more page does not remember an older retake", () => {
    state().add([page("a")]);
    state().camera("a");
    state().camera();
    expect(state().retakeId).toBeNull();
    state().add([page("b")]);
    expect(state().pages.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("leaving the camera returns to the page it came from", () => {
    state().add([page("a"), page("b")]);
    state().show("b", "review");
    state().camera("b");
    state().show("b", "review");
    expect(state().step).toBe("review");
    expect(state().retakeId).toBeNull();
  });

  it("remembers whether going back from the corners leaves the scan, only while on the corners", () => {
    state().add([page("a")]);
    // Right after a photo, back returns to the review.
    expect(state().backLeaves).toBe(false);
    state().show("a", "review");
    // Reached by going back from the review: back again leaves.
    state().show("a", "crop", true);
    expect(state().step).toBe("crop");
    expect(state().backLeaves).toBe(true);
    // Continuing to the review, or opening the corners from its button, forgets it.
    state().show("a", "review", true);
    expect(state().backLeaves).toBe(false);
    state().show("a", "crop");
    expect(state().backLeaves).toBe(false);
    // So does a retake.
    state().show("a", "crop", true);
    state().camera("a");
    state().replace("a", page("b"));
    expect(state().backLeaves).toBe(false);
  });

  it("removing a page shows its neighbour; removing the last one returns to the camera", () => {
    state().add([page("a"), page("b")]);
    state().show("b", "review");
    state().remove("b");
    expect(state().currentId).toBe("a");
    expect(state().step).toBe("review");
    state().remove("a");
    expect(state().pages).toEqual([]);
    expect(state().currentId).toBeNull();
    expect(state().step).toBe("camera");
  });
});
