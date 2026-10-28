/// <reference lib="webworker" />
import type { workerOps as WorkerOpsValue } from "./ops";

/**
 * Web Worker hosting MuPDF. Messages: { id, op, arg } -> { id, ok, result | error } plus
 * intermediate { id, progress } events. Results' byte arrays are transferred, not copied.
 *
 * The handler is registered synchronously and MuPDF (which initialises its WASM with a
 * top-level await) is imported dynamically: messages that arrive while it loads are not lost.
 */

declare const self: DedicatedWorkerGlobalScope;

const opsModule = import("./ops");

interface Request {
  id: number;
  op: keyof typeof WorkerOpsValue;
  arg: unknown;
}

function transferables(value: unknown, out: Transferable[] = [], depth = 0): Transferable[] {
  if (depth > 4 || value === null || typeof value !== "object") return out;
  if (value instanceof Uint8Array) {
    if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength && value.buffer instanceof ArrayBuffer) {
      out.push(value.buffer);
    }
    return out;
  }
  for (const v of Array.isArray(value) ? value : Object.values(value)) transferables(v, out, depth + 1);
  return out;
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, op, arg } = event.data;
  try {
    const { workerOps } = await opsModule;
    const fn = workerOps[op] as (a: unknown, p?: (f: number) => void) => unknown;
    const result = fn(arg, (progress) => self.postMessage({ id, progress }));
    self.postMessage({ id, ok: true, result }, transferables(result));
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: {
        name: err instanceof Error ? err.name : "Error",
        message: err instanceof Error ? err.message : String(err),
        code: (err as { code?: string } | null)?.code === "WRONG_PASSWORD" ? "WRONG_PASSWORD" : undefined,
      },
    });
  }
};
