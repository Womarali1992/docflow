/**
 * The background job queue (plan: Data model → jobs).
 *
 * One Postgres table, claimed with `FOR UPDATE SKIP LOCKED`, so the API process
 * and the worker service (and a second worker, later) can share it without a
 * broker. A job is *pending* while `doneAt IS NULL AND attempts < maxAttempts`;
 * once the attempts are spent it is *failed* and stays in the table for the ops
 * panel to report — nothing is deleted behind the operator's back.
 *
 * Claiming increments `attempts` up front, so a worker that dies mid-handler
 * costs one attempt rather than looping forever. A lock older than
 * `STUCK_LOCK_MS` is considered abandoned and can be re-claimed.
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { Job } from '../db/schema.js';

/** Job types this build knows about. The worker refuses anything else. */
export const JOB_TYPES = ['email', 'scan_retry', 'sweeper', 'reminders'] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** A lock this old belonged to a worker that is gone; the job may be claimed again. */
export const STUCK_LOCK_MS = 5 * 60 * 1000;

export const DEFAULT_MAX_ATTEMPTS = 5;

export interface EnqueueOptions {
  /** Earliest time the job may run (default: now). */
  runAt?: Date;
  /** Collapses duplicates: a second enqueue with the same key is a no-op. */
  dedupeKey?: string;
  maxAttempts?: number;
}

/**
 * Adds a job. Returns the row, or `null` when `dedupeKey` already exists —
 * callers treat that as success (the work is already scheduled).
 */
export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: EnqueueOptions = {}): Promise<Job | null> {
  const [row] = await db
    .insert(schema.jobs)
    .values({
      type,
      payload,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      dedupeKey: opts.dedupeKey ?? null,
    })
    .onConflictDoNothing({ target: schema.jobs.dedupeKey })
    .returning();
  return row ?? null;
}

/**
 * Takes up to `limit` due jobs for this worker. Rows another worker holds are
 * skipped rather than waited on, so two workers never process the same job.
 */
export async function claim(workerId: string, limit = 1, now = new Date()): Promise<Job[]> {
  const stuckBefore = new Date(now.getTime() - STUCK_LOCK_MS);
  const result = await db.execute(sql`
    UPDATE ${schema.jobs} AS j
       SET locked_at = ${now}, locked_by = ${workerId}, attempts = j.attempts + 1
     WHERE j.id IN (
       SELECT c.id FROM ${schema.jobs} AS c
        WHERE c.done_at IS NULL
          AND c.attempts < c.max_attempts
          AND c.run_at <= ${now}
          AND (c.locked_at IS NULL OR c.locked_at < ${stuckBefore})
        ORDER BY c.run_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
     )
     RETURNING j.*
  `);
  return result.rows.map(toJob);
}

/** Marks a job done. Finished jobs are never claimed again. */
export async function complete(id: string, now = new Date()): Promise<void> {
  await db.execute(sql`
    UPDATE ${schema.jobs}
       SET done_at = ${now}, locked_at = NULL, locked_by = NULL, last_error = NULL
     WHERE id = ${id}
  `);
}

/**
 * Records a failure and schedules the retry. The attempt was already counted by
 * `claim`, so a job whose attempts are spent simply stays unlocked and unfinished
 * — that is what "failed" means here, and `queueStats` counts it.
 */
export async function fail(job: Job, error: unknown, now = new Date()): Promise<void> {
  const message = truncate(error instanceof Error ? error.message : String(error), 2000);
  const exhausted = job.attempts >= job.maxAttempts;
  const runAt = exhausted ? job.runAt : new Date(now.getTime() + backoffMs(job.attempts));
  await db.execute(sql`
    UPDATE ${schema.jobs}
       SET last_error = ${message}, locked_at = NULL, locked_by = NULL, run_at = ${runAt}
     WHERE id = ${job.id}
  `);
}

/** 1 min, 5 min, 15 min, 1 h, then hourly — long enough for a mail server to come back. */
export function backoffMs(attempts: number): number {
  const ladder = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
  return ladder[Math.min(Math.max(attempts, 1), ladder.length) - 1];
}

export interface QueueStats {
  pending: number;
  running: number;
  failed: number;
  done: number;
  oldestPendingAt: string | null;
}

/** Counts for `GET /ops/status` and the C5.2 ops panel. */
export async function queueStats(now = new Date()): Promise<QueueStats> {
  const stuckBefore = new Date(now.getTime() - STUCK_LOCK_MS);
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE done_at IS NULL AND attempts < max_attempts)::int AS pending,
      COUNT(*) FILTER (WHERE done_at IS NULL AND locked_at IS NOT NULL AND locked_at >= ${stuckBefore})::int AS running,
      COUNT(*) FILTER (WHERE done_at IS NULL AND attempts >= max_attempts)::int AS failed,
      COUNT(*) FILTER (WHERE done_at IS NOT NULL)::int AS done,
      -- Formatted in SQL: an aggregate over a raw execute() comes back as a driver
      -- string, not a Date, so the API would otherwise leak Postgres's own format.
      to_char(
        MIN(run_at) FILTER (WHERE done_at IS NULL AND attempts < max_attempts) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS oldest_pending_at
    FROM ${schema.jobs}
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  const oldest = row?.oldest_pending_at;
  return {
    pending: Number(row?.pending ?? 0),
    running: Number(row?.running ?? 0),
    failed: Number(row?.failed ?? 0),
    done: Number(row?.done ?? 0),
    oldestPendingAt: oldest === null || oldest === undefined ? null : String(oldest),
  };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** `db.execute` returns raw snake_case rows; map them onto the Drizzle row type once, here. */
function toJob(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    type: String(row.type),
    payload: (row.payload ?? {}) as Job['payload'],
    runAt: asDate(row.run_at),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    lockedAt: row.locked_at ? asDate(row.locked_at) : null,
    lockedBy: row.locked_by === null || row.locked_by === undefined ? null : String(row.locked_by),
    lastError: row.last_error === null || row.last_error === undefined ? null : String(row.last_error),
    doneAt: row.done_at ? asDate(row.done_at) : null,
    dedupeKey: row.dedupe_key === null || row.dedupe_key === undefined ? null : String(row.dedupe_key),
    createdAt: asDate(row.created_at),
  };
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}
