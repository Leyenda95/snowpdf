/**
 * Limits concurrent page renders (pdf.js draws on the main thread) and serves the most
 * important ones first: lower `priority` runs earlier (visible pages 0, neighbours 1,
 * thumbnails 10).
 */

interface Job {
  priority: number;
  seq: number;
  run: () => Promise<void>;
  cancelled: boolean;
  resolve: () => void;
  reject: (err: unknown) => void;
}

const MAX_CONCURRENT = 2;
let running = 0;
let seq = 0;
const queue: Job[] = [];

function pump(): void {
  while (running < MAX_CONCURRENT && queue.length) {
    queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    const job = queue.shift()!;
    if (job.cancelled) {
      job.resolve();
      continue;
    }
    running++;
    job
      .run()
      .then(job.resolve, job.reject)
      .finally(() => {
        running--;
        pump();
      });
  }
}

export interface QueuedRender {
  promise: Promise<void>;
  /** Drop the job if it hasn't started (the caller cancels an in-flight pdf.js task itself). */
  cancel(): void;
}

export function enqueueRender(run: () => Promise<void>, priority: number): QueuedRender {
  let job!: Job;
  const promise = new Promise<void>((resolve, reject) => {
    job = { priority, seq: seq++, run, cancelled: false, resolve, reject };
  });
  queue.push(job);
  queueMicrotask(pump);
  return {
    promise,
    cancel: () => {
      job.cancelled = true;
    },
  };
}
