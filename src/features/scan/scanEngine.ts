import { useEffect, useState } from "react";
import type { Raster } from "@/pdf/inpaint";
import type { ScanSettings } from "@/pdf/scan/process";
import type { ScanWorkerOps } from "./scanWorker";

/**
 * Screen side of the scanner's worker (see scanWorker.ts): `callScan(op, arg)` runs one of its
 * operations. Only types are imported from the worker.
 */

type OpName = keyof ScanWorkerOps;
type OpArg<K extends OpName> = Parameters<ScanWorkerOps[K]>[0];
type OpResult<K extends OpName> = Awaited<ReturnType<ScanWorkerOps[K]>>;

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(reason: string): void {
  for (const p of pending.values()) p.reject(new Error(reason));
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./scanWorker.ts", import.meta.url), { type: "module", name: "scan" });
  w.onmessage = (event: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
    const msg = event.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error ?? "Scan worker error"));
  };
  w.onerror = (event) => {
    // The photos it held are gone with it; the next call starts a fresh one.
    event.preventDefault();
    w.terminate();
    if (worker === w) worker = null;
    failAll(event.message || "Scan worker error");
  };
  worker = w;
  return w;
}

/** Runs a worker operation. `transfer` hands objects over instead of copying them. */
export function callScan<K extends OpName>(op: K, arg: OpArg<K>, transfer: Transferable[] = []): Promise<OpResult<K>> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<OpResult<K>>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    try {
      w.postMessage({ id, op, arg }, transfer);
    } catch (err) {
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** Ends the worker, freeing every photo it holds (the scan is over). */
export function closeScanEngine(): void {
  worker?.terminate();
  worker = null;
  failAll("Scan closed");
}

/**
 * The page as the worker renders it with these settings, at `maxSide`. While a new version is on
 * its way the previous one stays (`pending` tells); null until the first one arrives.
 *
 * The worker renders in the order it is asked. `later` asks a moment afterwards, for the small
 * pictures around the page (filter samples, thumbnails): the page itself goes first.
 */
export function useScanRender(page: string, settings: ScanSettings, maxSide: number, later = false): { raster: Raster | null; pending: boolean } {
  const { quad, filter, turns } = settings;
  const [shown, setShown] = useState<{ page: string; raster: Raster } | null>(null);
  const [pendingNow, setPending] = useState(true);
  useEffect(() => {
    let current = true;
    setPending(true);
    const ask = () => {
      if (!current) return;
      callScan("render", { page, settings: { quad, filter, turns }, maxSide })
        .then((raster) => {
          if (!current) return;
          setShown({ page, raster });
          setPending(false);
        })
        // The page is gone, or the worker stopped: leave what is shown.
        .catch(() => current && setPending(false));
    };
    const timer = later ? window.setTimeout(ask, 0) : 0;
    if (!later) ask();
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [page, quad, filter, turns, maxSide, later]);
  // Never another page's picture.
  return { raster: shown?.page === page ? shown.raster : null, pending: pendingNow };
}
