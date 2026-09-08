/**
 * The worker loop: claim due jobs, run their handler, mark them done or failed.
 *
 * Runs as its own process (`src/worker.ts` → the `docflow-worker` Windows
 * service in C5.3) so a slow mail server can never hold up an API request, and
 * so restarting the API does not lose queued work — the queue is the database.
 *
 * A handler that throws is retried with backoff until `maxAttempts`; a job type
 * this build does not know is failed with a clear message rather than crashing
 * the loop, so an older queue row cannot take the service down.
 */
import { randomUUID } from 'node:crypto';
import type { Job } from '../db/schema.js';
import { claim, complete, fail } from './queue.js';
import { sendEmailJob } from './handlers/email.js';
import { scanRetryJob } from './handlers/scan_retry.js';
import { sweeperJob } from './handlers/sweeper.js';
import { remindersJob } from './handlers/reminders.js';
import { opsDigestJob } from './handlers/ops_digest.js';
import { ensureScheduledJobs } from './schedule.js';
import { HEARTBEAT_INTERVAL_MS, beat, pruneHeartbeats } from './heartbeat.js';

export type Handler = (job: Job) => Promise<unknown>;

export const handlers: Record<string, Handler> = {
  email: (job) => sendEmailJob(job),
  scan_retry: scanRetryJob,
  sweeper: sweeperJob,
  reminders: remindersJob,
  ops_digest: opsDigestJob,
};

/** How often an idle worker asks for work. Short enough that an invitation email feels immediate. */
export const POLL_INTERVAL_MS = Number.parseInt(process.env.WORKER_POLL_MS || '5000', 10);
/** Jobs taken per tick. One CPA firm's queue is tiny; this is about fairness, not throughput. */
export const BATCH_SIZE = Number.parseInt(process.env.WORKER_BATCH || '5', 10);

/**
 * How often the recurring schedule is re-asserted. The work is idempotent, but
 * it is two writes, and nothing it schedules is finer-grained than an hour —
 * doing it on every five-second poll would be noise in the write-ahead log for
 * no benefit.
 */
export const SCHEDULE_CHECK_MS = 60_000;

/**
 * One pass: claim a batch and run it. Returns how many jobs were processed, so
 * the loop can poll again immediately while there is a backlog. Exported for
 * the tests, which drive it directly instead of starting a timer.
 */
export async function runOnce(workerId: string, registry: Record<string, Handler> = handlers, limit = BATCH_SIZE): Promise<number> {
  const batch = await claim(workerId, limit);
  for (const job of batch) {
    const handler = registry[job.type];
    try {
      if (!handler) throw new Error(`No handler for job type "${job.type}"`);
      await handler(job);
      await complete(job.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const exhausted = job.attempts >= job.maxAttempts;
      console.error(`[worker] job ${job.id} (${job.type}) failed on attempt ${job.attempts}/${job.maxAttempts}: ${message}${exhausted ? ' — giving up' : ''}`);
      await fail(job, err);
    }
  }
  return batch.length;
}

export interface WorkerHandle {
  /** Stops after the pass in flight finishes. */
  stop(): Promise<void>;
  workerId: string;
}

/** Starts the polling loop. Nothing overlaps: the next tick waits for this one. */
export function startWorker(workerId = `${process.pid}-${randomUUID().slice(0, 8)}`): WorkerHandle {
  let stopped = false;
  // Lets stop() cut an idle wait short instead of holding shutdown for a full poll.
  let wake: (() => void) | null = null;

  const idle = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(finish, ms);
      wake = finish;
      function finish() {
        clearTimeout(timer);
        wake = null;
        resolve();
      }
    });

  let lastScheduleCheck = 0;
  let lastBeat = 0;

  const loop = async (): Promise<void> => {
    while (!stopped) {
      let processed = 0;
      try {
        /* Proof of life, before the work rather than after it: a worker that is
           up but wedged on one slow job should still look alive, because it is
           — and the thing an operator needs to tell apart from that is a worker
           that is not running at all (H7). */
        if (Date.now() - lastBeat >= HEARTBEAT_INTERVAL_MS) {
          lastBeat = Date.now();
          await beat(workerId);
        }
        // Recurring work is scheduled from here rather than from cron: the
        // dedupe keys make it idempotent, and a worker that was down all
        // morning still runs the day's reminders when it comes back.
        if (Date.now() - lastScheduleCheck >= SCHEDULE_CHECK_MS) {
          lastScheduleCheck = Date.now();
          await ensureScheduledJobs();
        }
        processed = await runOnce(workerId);
      } catch (err) {
        // A database hiccup must not kill the service; wait a poll and try again.
        console.error('[worker] poll failed:', err instanceof Error ? err.message : err);
      }
      if (stopped) return;
      // Keep going while there is a backlog; otherwise wait for the next poll.
      if (processed === 0) await idle(POLL_INTERVAL_MS);
    }
  };

  /* One beat before the first poll, and a sweep of workers that stopped a week
     ago. Both are best-effort: a worker that cannot write its heartbeat should
     still run jobs, because the jobs are the point and the row is the report. */
  const announced = (async () => {
    try {
      await pruneHeartbeats();
      await beat(workerId);
      lastBeat = Date.now();
    } catch (err) {
      console.error('[worker] could not record the first heartbeat:', err instanceof Error ? err.message : err);
    }
  })();

  const inFlight = announced.then(loop);

  return {
    workerId,
    async stop() {
      stopped = true;
      wake?.();
      await inFlight;
      /* A last beat on the way out. It does not mark the worker stopped — the
         panel judges by silence, and a worker that has stopped is silent from
         here on — but it makes "up until 14:02" true rather than "up until the
         last 30-second tick before 14:02". */
      try {
        await beat(workerId);
      } catch {
        // Shutting down; a missed final beat costs nothing.
      }
    },
  };
}
