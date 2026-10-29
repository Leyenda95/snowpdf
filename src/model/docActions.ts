import { useDocStore } from "./docStore";
import { newId } from "./registry";
import type { EditorObject, PageRef, PdfBox, Rotation } from "./types";

/** Undoable editing commands shared by the editor and the organizer. */

const apply = (...args: Parameters<ReturnType<typeof useDocStore.getState>["apply"]>) =>
  useDocStore.getState().apply(...args);

// ------------------------------------------------------------------ objects

export function addObjects(objects: EditorObject[]): void {
  apply((d) => {
    d.objects.push(...objects);
  });
}

export function updateObject(id: string, patch: Partial<EditorObject>, coalesce?: string): void {
  apply(
    (d) => {
      const o = d.objects.find((x) => x.id === id);
      if (o) Object.assign(o, patch);
    },
    { coalesce },
  );
}

export function updateObjects(ids: string[], fn: (o: EditorObject) => void, coalesce?: string): void {
  const set = new Set(ids);
  apply(
    (d) => {
      for (const o of d.objects) if (set.has(o.id)) fn(o as EditorObject);
    },
    { coalesce },
  );
}

export function deleteObjects(ids: string[]): void {
  const set = new Set(ids);
  apply((d) => {
    d.objects = d.objects.filter((o) => !set.has(o.id));
  });
}

export function duplicateObjects(ids: string[], offset = 12): string[] {
  const set = new Set(ids);
  const created: string[] = [];
  apply((d) => {
    for (const o of d.objects.filter((x) => set.has(x.id))) {
      const copy = structuredClone(o) as EditorObject;
      copy.id = newId("obj");
      // A link follows one replacement only.
      if (copy.kind === "text") copy.links = null;
      copy.frame.cx += offset;
      copy.frame.cy -= offset;
      created.push(copy.id);
      d.objects.push(copy);
    }
  });
  return created;
}

export function reorderObjects(ids: string[], where: "front" | "back" | "forward" | "backward"): void {
  const set = new Set(ids);
  apply((d) => {
    if (where === "forward" || where === "backward") {
      // One step among the objects of the same page; a multi-selection keeps its relative order.
      const arr = d.objects;
      const order = where === "forward" ? arr.map((_, i) => arr.length - 1 - i) : arr.map((_, i) => i);
      const dir = where === "forward" ? 1 : -1;
      for (const i of order) {
        if (!set.has(arr[i].id)) continue;
        let j = i + dir;
        while (j >= 0 && j < arr.length && arr[j].pageId !== arr[i].pageId) j += dir;
        if (j < 0 || j >= arr.length || set.has(arr[j].id)) continue;
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return;
    }
    const moving = d.objects.filter((o) => set.has(o.id));
    const rest = d.objects.filter((o) => !set.has(o.id));
    d.objects = where === "front" ? [...rest, ...moving] : [...moving, ...rest];
  });
}

// ------------------------------------------------------------------ pages

export function rotatePages(pageIds: string[], delta: 90 | 180 | 270): void {
  const set = new Set(pageIds);
  apply((d) => {
    for (const p of d.pages) if (set.has(p.id)) p.rotation = ((p.rotation + delta) % 360) as Rotation;
  });
}

export function deletePages(pageIds: string[]): void {
  const set = new Set(pageIds);
  apply((d) => {
    d.pages = d.pages.filter((p) => !set.has(p.id));
    d.objects = d.objects.filter((o) => !set.has(o.pageId));
  });
}

/** Put the given pages (in their current relative order) before index `to` of the remaining list. */
export function movePages(pageIds: string[], to: number): void {
  const set = new Set(pageIds);
  apply((d) => {
    const moving = d.pages.filter((p) => set.has(p.id));
    const before = d.pages.slice(0, to).filter((p) => !set.has(p.id)).length;
    const rest = d.pages.filter((p) => !set.has(p.id));
    rest.splice(before, 0, ...moving);
    d.pages = rest;
  });
}

export function setPageOrder(pageIds: string[]): void {
  apply((d) => {
    const byId = new Map(d.pages.map((p) => [p.id, p]));
    d.pages = pageIds.map((id) => byId.get(id)!).filter(Boolean);
  });
}

/** Duplicate pages (and their objects) right after each original. Returns the new ids. */
export function duplicatePages(pageIds: string[]): string[] {
  const set = new Set(pageIds);
  const created: string[] = [];
  apply((d) => {
    const pages: PageRef[] = [];
    const objects: EditorObject[] = [];
    for (const p of d.pages) {
      pages.push(p as PageRef);
      if (!set.has(p.id)) continue;
      const copy: PageRef = { ...(p as PageRef), id: newId("pg") };
      created.push(copy.id);
      pages.push(copy);
      for (const o of d.objects) {
        if (o.pageId !== p.id) continue;
        const oc = structuredClone(o) as EditorObject;
        oc.id = newId("obj");
        oc.pageId = copy.id;
        objects.push(oc);
      }
    }
    d.pages = pages;
    d.objects.push(...objects);
  });
  return created;
}

export function insertPages(index: number, pages: PageRef[]): void {
  apply((d) => {
    d.pages.splice(Math.max(0, Math.min(index, d.pages.length)), 0, ...pages);
  });
}

export function blankPage(width = 595.28, height = 841.89): PageRef {
  return {
    id: newId("pg"),
    sourceId: null,
    sourceIndex: 0,
    baseRotation: 0,
    rotation: 0,
    view: [0, 0, width, height],
    crop: null,
  };
}

export function setPageCrop(pageIds: string[], crop: PdfBox | null): void {
  const set = new Set(pageIds);
  apply((d) => {
    for (const p of d.pages) if (set.has(p.id)) p.crop = crop;
  });
}
