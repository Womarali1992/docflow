/**
 * The worker's proof of life (H7).
 *
 * The audit's third finding: a stopped or wedged worker is invisible. Jobs stay
 * pending, which on a one-firm queue looks exactly like a quiet morning — until
 * a week of reminders, scan retries and invitation emails turns out never to
 * have been sent. Nothing in the panel could tell the two apart, because
 * nothing asked the worker anything.
 *
 * So the worker writes a row. Every 30 seconds, not every 5-second poll: the
 * question is "is it alive", and answering it twelve times a minute is noise in
 * the write-ahead log for no extra truth.
 *
 * Read back, the only judgement made here is **silence**. Two minutes is four
 * missed beats — long enough that a slow job or a moment of GC never trips it,
 * short enough that an operator looking at the panel is not looking at
 * yesterday.
 */
import os from 'node:os';
import { desc, lt } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { releaseLabel } from '../ops/release.js';

/** How often a running worker updates its row. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Four missed beats. Past this, the panel says the worker is not answering. */
export const HEARTBEAT_SILENT_MS = 2 * 60_000;

/** Rows this old belong to workers that stopped long ago; start-up sweeps them. */
export const HEARTBEAT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Records that this worker is alive. The insert is an upsert on the worker id,
 * and `startedAt` is deliberately *not* overwritten — how long this process has
 * been up is part of the answer.
 */
export async function beat(workerId: string, now = new Date()): Promise<void> {
  const row = {
    workerId,
    pid: process.pid,
    host: os.hostname(),
    version: releaseLabel(),
  };
  await db
    .insert(schema.workerHeartbeats)
    .values({ ...row, startedAt: now, lastSeenAt: now })
    .onConflictDoUpdate({
      target: schema.workerHeartbeats.workerId,
      set: { ...row, lastSeenAt: now },
    });
}

/** Forgets workers that stopped a week ago. Called once, at start-up. */
export async function pruneHeartbeats(now = new Date()): Promise<number> {
  const result = await db
    .delete(schema.workerHeartbeats)
    .where(lt(schema.workerHeartbeats.lastSeenAt, new Date(now.getTime() - HEARTBEAT_KEEP_MS)))
    .returning({ workerId: schema.workerHeartbeats.workerId });
  return result.length;
}

export interface WorkerStatus {
  workerId: string | null;
  lastSeenAt: string | null;
  startedAt: string | null;
  pid: number | null;
  host: string | null;
  version: string | null;
  /** How long since the last beat, or null when there has never been one. */
  silentSeconds: number | null;
  /** What to do about it, in a sentence, or null when it is fine. */
  note: string | null;
}

/**
 * The most recently heard-from worker. One firm runs one worker, but the row is
 * chosen by `lastSeenAt` rather than assumed, so a box that has run two does not
 * report the dead one.
 */
export async function workerStatus(now = new Date()): Promise<WorkerStatus> {
  const [row] = await db
    .select()
    .from(schema.workerHeartbeats)
    .orderBy(desc(schema.workerHeartbeats.lastSeenAt))
    .limit(1);

  if (!row) {
    return {
      workerId: null,
      lastSeenAt: null,
      startedAt: null,
      pid: null,
      host: null,
      version: null,
      silentSeconds: null,
      note: 'The background worker has never reported in. Nothing queued — emails, reminders, re-scans — is being processed. Start it with `npm run worker:start`.',
    };
  }

  const silentMs = now.getTime() - row.lastSeenAt.getTime();
  const silent = silentMs > HEARTBEAT_SILENT_MS;
  return {
    workerId: row.workerId,
    lastSeenAt: row.lastSeenAt.toISOString(),
    startedAt: row.startedAt.toISOString(),
    pid: row.pid,
    host: row.host,
    version: row.version,
    silentSeconds: Math.max(0, Math.round(silentMs / 1000)),
    note: silent
      ? `The background worker has not reported in for ${Math.floor(silentMs / 60_000)} minutes. Queued emails, reminders and re-scans are not being processed. Check that the docflow-worker service is running.`
      : null,
  };
}
