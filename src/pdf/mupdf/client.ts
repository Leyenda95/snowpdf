import type { WorkerOps } from "./ops";
import { t, tDynamic } from "@/i18n";

/**
 * Browser-side client of the MuPDF worker. The 10 MB WASM module is only downloaded the first
 * time an operation needs it. Only types are imported from ./ops, so MuPDF never lands in the
 * main bundle.
 */

export class MupdfPasswordError extends Error {
  readonly code = "WRONG_PASSWORD";
  constructor(message: string) {
    super(message);
    this.name = "MupdfPasswordError";
  }
}

type OpName = keyof WorkerOps;
type OpArg<K extends OpName> = Parameters<WorkerOps[K]>[0];
type OpResult<K extends OpName> = ReturnType<WorkerOps[K]>;

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
  onProgress?: (fraction: number) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(err: Error): void {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "mupdf" });
  w.onmessage = (event: MessageEvent) => {
    const msg = event.data as {
      id: number;
      ok?: boolean;
      progress?: number;
      result?: unknown;
      error?: { name: string; message: string; code?: string };
    };
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.progress !== undefined && msg.ok === undefined) {
      p.onProgress?.(msg.progress);
      return;
    }
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    // The worker has no UI language: its messages are Spanish source text, translated here.
    else if (msg.error?.code === "WRONG_PASSWORD") p.reject(new MupdfPasswordError(tDynamic(msg.error.message)));
    else p.reject(new Error(msg.error?.message ? tDynamic(msg.error.message) : t("Error desconocido en MuPDF")));
  };
  w.onerror = (event) => {
    // A crashed WASM module can't be trusted any more: start a fresh worker next time.
    event.preventDefault();
    w.terminate();
    if (worker === w) worker = null;
    failAll(new Error(t("El motor MuPDF se detuvo: {reason}", { reason: event.message || t("error interno") })));
  };
  worker = w;
  return w;
}

export function callMupdf<K extends OpName>(
  op: K,
  arg: OpArg<K>,
  opts: { onProgress?: (fraction: number) => void } = {},
): Promise<OpResult<K>> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<OpResult<K>>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress: opts.onProgress });
    w.postMessage({ id, op, arg });
  });
}
