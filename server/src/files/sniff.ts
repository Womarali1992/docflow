/**
 * Reading the type out of untrusted bytes, without betting the process on it.
 *
 * `file-type` walks a real parser over whatever it is handed, and the 2026-09-07
 * audit's F1 is that this walk can stop coming back: an ASF stream with a
 * self-referential object size sends the reader round in a loop (the advisory
 * covers 13.0.0 – 21.3.0, and 19.6.0 was installed). A synchronous loop inside a
 * request handler is not a slow request — it is the whole server, because the
 * event loop never gets another turn. The async router added in `29814d4`
 * catches rejected promises; it cannot interrupt a loop that never yields.
 *
 * So two defences, and the second is the one that holds:
 *
 * 1. **Only the head.** Every signature that matters lives in the first few KB,
 *    so at most `maxBytes` (4100, `file-type`'s own minimum-document size) is
 *    ever parsed. A 25 MB file costs the same as a 5 KB one.
 * 2. **Somewhere terminable.** The parse runs in a `worker_threads` Worker that
 *    is raced against a timeout. If the timeout wins, `worker.terminate()` ends
 *    the thread — the one thing that cannot be done to the event loop — and the
 *    caller gets `SniffTimeout` instead of a hang. The version upgrade closes
 *    the known loop; this closes the next one too.
 *
 * A Worker per call, deliberately. One CPA's uploads do not justify a pool, and
 * a pool would have to decide what to do with a poisoned thread anyway. The
 * thread costs a few milliseconds against a bounded 2 s worst case.
 *
 * The worker entry is plain JavaScript (`sniff.worker.js`) rather than
 * TypeScript, because it has to be startable by bare `node` from *both* trees:
 * `src/` under tsx and vitest, and `dist/` in production. `allowJs` copies it
 * through the build, so `./sniff.worker.js` resolves next to this module either
 * way, with no loader and no conditional path.
 */
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';

/**
 * `file-type`'s own stated detection window (`reasonableDetectionSizeInBytes`,
 * which it exports from the JS but not from its typings). Every signature this
 * app accepts lives inside it.
 */
export const SNIFF_MAX_BYTES = 4100;

/** Long enough for a cold worker start on a busy laptop, short enough that nobody waits. */
export const SNIFF_TIMEOUT_MS = Number(process.env.SNIFF_TIMEOUT_MS) || 2000;

export interface SniffResult {
  mime: string;
  ext: string;
}

/** Thrown when the parse had to be killed. The caller decides what to tell the user. */
export class SniffTimeout extends Error {
  constructor(readonly timeoutMs: number) {
    super(`File type detection did not finish within ${timeoutMs} ms`);
    this.name = 'SniffTimeout';
  }
}

export interface SniffOptions {
  maxBytes?: number;
  timeoutMs?: number;
  /** Tests point this at a worker that hangs on purpose; nothing else should set it. */
  workerPath?: string | URL;
}

/** Reads at most `maxBytes` from the front of a file. */
export async function readHead(absPath: string, maxBytes = SNIFF_MAX_BYTES): Promise<Buffer> {
  const handle = await fs.promises.open(absPath, 'r');
  try {
    const head = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(head, 0, maxBytes, 0);
    return head.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * The type of the bytes at the front of `input`, or `null` when nothing matched.
 *
 * @throws {SniffTimeout} if the parse had to be terminated.
 */
export async function sniffHead(input: string | Buffer, options: SniffOptions = {}): Promise<SniffResult | null> {
  const maxBytes = options.maxBytes ?? SNIFF_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? SNIFF_TIMEOUT_MS;
  const head = typeof input === 'string' ? await readHead(input, maxBytes) : input.subarray(0, maxBytes);
  if (head.length === 0) return null;
  return sniffBufferInWorker(head, timeoutMs, options.workerPath ?? new URL('./sniff.worker.js', import.meta.url));
}

function sniffBufferInWorker(head: Buffer, timeoutMs: number, workerPath: string | URL): Promise<SniffResult | null> {
  return new Promise((resolve, reject) => {
    // Copied into its own ArrayBuffer: a Buffer from fs.read can be a view into
    // a larger pooled allocation, and structured cloning would carry the pool.
    const bytes = new Uint8Array(head);
    const worker = new Worker(workerPath, { workerData: bytes });
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };

    // Deliberately not unref'd: the Worker already holds the loop open, and an
    // unref'd timer is one more way for the timeout to be the thing that does
    // not happen. This timer is the whole defence.
    const timer = setTimeout(() => finish(() => reject(new SniffTimeout(timeoutMs))), timeoutMs);

    worker.on('message', (message: { ok: true; type: SniffResult | null } | { ok: false; error: string }) => {
      finish(() => (message.ok ? resolve(message.type) : reject(new Error(message.error))));
    });
    worker.on('error', (err) => finish(() => reject(err)));
    worker.on('exit', (code) => {
      // A clean exit always follows a message; this is the "died silently" case.
      finish(() => reject(new Error(`File type detection worker exited with code ${code}`)));
    });
  });
}
