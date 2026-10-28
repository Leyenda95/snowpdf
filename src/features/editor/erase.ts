import { useDocStore } from "@/model/docStore";
import { getSource, putAsset } from "@/model/registry";
import type { DocState, EraseObject, PdfBox } from "@/model/types";
import { frameBBox } from "@/pdf/objectGeometry";
import { callMupdf } from "@/pdf/mupdf/client";
import { toast } from "@/ui";
import { t } from "@/i18n";

/**
 * Background analysis of "magic eraser" objects. An object whose `method` is null is being
 * analysed (or waiting to be): the page zone under it is sent to MuPDF, which picks the lightest
 * way to clear it and renders the result. Everything is driven by the document store, so
 * creating, moving, resizing, undoing and redoing all end up in the same place.
 *
 * - Results never create an undo step (`useDocStore.patch`), and are also written into the
 *   undo/redo snapshots that hold the same object at the same frame.
 * - A result is only used if the object still exists with the frame it was computed for.
 * - Export never analyses: it waits here (`whenErasesSettled`) and uses what was stored.
 */

/** Moving or resizing keeps changing the frame: analyse once it stops. */
const DEBOUNCE_MS = 250;
/** The asset covers the frame's bbox grown by this many points (see EraseObject.renderBox). */
const RENDER_MARGIN = 1;

interface Job {
  token: string;
  timer: ReturnType<typeof setTimeout> | null;
}

const jobs = new Map<string, Job>();
let waiters: (() => void)[] = [];

/** Identifies what a result is for: the page and the exact frame it was computed on. */
function tokenOf(o: EraseObject): string {
  return `${o.pageId}:${JSON.stringify(o.frame)}`;
}

function expectedBox(o: EraseObject): PdfBox {
  const [x0, y0, x1, y1] = frameBBox(o.frame);
  return [x0 - RENDER_MARGIN, y0 - RENDER_MARGIN, x1 + RENDER_MARGIN, y1 + RENDER_MARGIN];
}

/** The stored result belongs to another frame than the one the object has now (it was moved). */
function isStale(o: EraseObject): boolean {
  if (o.method === null) return false;
  if (!o.renderBox) return true;
  const want = expectedBox(o);
  return o.renderBox.some((v, i) => Math.abs(v - want[i]) > 0.01);
}

const needsAnalysis = (o: EraseObject): boolean => o.method === null || isStale(o);

function eraseObjects(doc: DocState): EraseObject[] {
  return doc.objects.filter((o): o is EraseObject => o.kind === "erase");
}

function cancel(id: string): void {
  const job = jobs.get(id);
  if (job?.timer) clearTimeout(job.timer);
  jobs.delete(id);
}

function settleIfIdle(): void {
  if (jobs.size > 0 || waiters.length === 0) return;
  const done = waiters;
  waiters = [];
  for (const resolve of done) resolve();
}

interface Outcome {
  method: EraseObject["method"];
  assetId: string | null;
  renderBox: PdfBox;
}

/** Store a result in the current document and in every snapshot with the same object and frame. */
function commit(id: string, token: string, make: () => Outcome): void {
  const s = useDocStore.getState();
  const matches = (doc: DocState) => eraseObjects(doc).some((o) => o.id === id && tokenOf(o) === token && needsAnalysis(o));
  // Nothing wants it any more (deleted, moved again, another tab): do not even register the image.
  if (![s.doc, ...s.past, ...s.future].some(matches)) return;
  const outcome = make();
  s.patch(
    (d) => {
      const o = d.objects.find((x) => x.id === id);
      if (o && o.kind === "erase" && tokenOf(o as EraseObject) === token && needsAnalysis(o as EraseObject)) Object.assign(o, outcome);
    },
    { history: true },
  );
}

async function analyse(o: EraseObject): Promise<void> {
  const id = o.id;
  const token = tokenOf(o);
  const page = useDocStore.getState().doc.pages.find((p) => p.id === o.pageId);
  const box = frameBBox(o.frame);
  const renderBox = expectedBox(o);
  // A blank page has nothing under the object.
  if (!page || page.sourceId === null) {
    commit(id, token, () => ({ method: "none", assetId: null, renderBox }));
    return;
  }
  try {
    const res = await callMupdf("eraseRegion", { bytes: getSource(page.sourceId).bytes, pageIndex: page.sourceIndex, box });
    commit(id, token, () => ({
      method: res.method,
      // With nothing to erase the page is already right: no picture needed.
      assetId: res.method === "none" ? null : putAsset(res.png, res.mime, res.width, res.height).id,
      renderBox: res.box,
    }));
  } catch (err) {
    // Leave the object as "nothing to erase" so saving is not blocked, and say so.
    commit(id, token, () => ({ method: "none", assetId: null, renderBox }));
    toast.error(t("No se pudo analizar la zona del borrador"), { description: err instanceof Error ? err.message : String(err) });
  }
}

function schedule(o: EraseObject, delay: number): void {
  cancel(o.id);
  const job: Job = { token: tokenOf(o), timer: null };
  job.timer = setTimeout(() => {
    job.timer = null;
    // Re-read: the object may have changed during the wait (a changed frame replaces the job).
    const current = eraseObjects(useDocStore.getState().doc).find((x) => x.id === o.id);
    const run = current && tokenOf(current) === job.token && jobs.get(o.id) === job ? analyse(current) : Promise.resolve();
    void run.finally(() => {
      if (jobs.get(o.id) === job) jobs.delete(o.id);
      sync();
    });
  }, delay);
  jobs.set(o.id, job);
}

let syncing = false;
let again = false;

/** Make the running jobs match the document: one per object that needs an analysis. */
function sync(): void {
  if (syncing) {
    again = true;
    return;
  }
  syncing = true;
  try {
    do {
      again = false;
      const alive = new Set<string>();
      for (const o of eraseObjects(useDocStore.getState().doc)) {
        alive.add(o.id);
        if (!needsAnalysis(o)) {
          cancel(o.id);
          continue;
        }
        const job = jobs.get(o.id);
        if (o.method !== null) {
          // Moved or resized: the old picture shows the wrong place. Forget it (not an editing step).
          schedule(o, DEBOUNCE_MS);
          useDocStore.getState().patch((d) => {
            const x = d.objects.find((y) => y.id === o.id);
            if (x && x.kind === "erase") Object.assign(x, { method: null, assetId: null, renderBox: null });
          });
        } else if (!job || job.token !== tokenOf(o)) {
          // Freshly created: go at once. Frame changed while waiting: it is being dragged.
          schedule(o, job ? DEBOUNCE_MS : 0);
        }
      }
      for (const id of [...jobs.keys()]) if (!alive.has(id)) cancel(id);
    } while (again);
  } finally {
    syncing = false;
  }
  settleIfIdle();
}

useDocStore.subscribe(sync);

/** Resolves when no magic eraser is waiting for or running its analysis (call before exporting). */
export function whenErasesSettled(): Promise<void> {
  sync();
  if (jobs.size === 0) return Promise.resolve();
  return new Promise((resolve) => waiters.push(resolve));
}
