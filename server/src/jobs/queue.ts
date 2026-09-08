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
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { Job } from '../db/schema.js';

/** Job types this build knows about. The worker refuses anything else. */
export const JOB_TYPES = ['email', 'scan_retry', 'sweeper', 'reminders', 'ops_digest'] as const;
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

/** The shared connection, or a transaction when the job must land with the change. */
type Executor = Pick<typeof db, 'insert'>;

/** The same, for the reads and writes a retry needs. */
type RetryExecutor = Pick<typeof db, 'select' | 'update'>;

/**
 * Adds a job. Returns the row, or `null` when `dedupeKey` already exists —
 * callers treat that as success (the work is already scheduled).
 *
 * Pass `tx` when the job is part of what a transaction promises. The upload
 * pipeline does: a version that needs re-scanning and the job that will re-scan
 * it commit together, so a crash between them cannot leave a stored file that
 * nothing will ever look at again (H3).
 */
export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
  tx?: Executor
): Promise<Job | null> {
  const [row] = await (tx ?? db)
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
  /**
   * How long the oldest job that is *due* has been waiting, in seconds.
   *
   * Not the same as `oldestPendingAt`, and the difference is the whole point:
   * the daily reminder job is scheduled for tomorrow morning and is pending all
   * day, which made "oldest pending" a number that alarms nobody because it is
   * always large. This counts only work that could run right now and has not —
   * which on a healthy box is a second or two, and on a stopped worker grows
   * without bound (H7).
   */
  oldestActionableAgeSeconds: number | null;
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
      ) AS oldest_pending_at,
      -- Due and still waiting: run_at <= now is what makes it actionable.
      EXTRACT(EPOCH FROM (${now}::timestamptz - MIN(run_at) FILTER (
        WHERE done_at IS NULL AND attempts < max_attempts AND run_at <= ${now}
      )))::int AS oldest_actionable_age
    FROM ${schema.jobs}
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  const oldest = row?.oldest_pending_at;
  const actionable = row?.oldest_actionable_age;
  return {
    pending: Number(row?.pending ?? 0),
    running: Number(row?.running ?? 0),
    failed: Number(row?.failed ?? 0),
    done: Number(row?.done ?? 0),
    oldestPendingAt: oldest === null || oldest === undefined ? null : String(oldest),
    oldestActionableAgeSeconds:
      actionable === null || actionable === undefined ? null : Math.max(0, Number(actionable)),
  };
}

export interface FailedJob {
  id: string;
  type: string;
  attempts: number;
  maxAttempts: number;
  /** Truncated hard: this is read on a screen, and the full text is in the row. */
  lastError: string | null;
  runAt: string;
}

/** How much of an error message the ops panel shows. The row keeps the rest. */
export const FAILED_ERROR_CHARS = 200;

/**
 * The jobs that gave up, newest first (H7).
 *
 * Failed jobs were already counted; a count alone tells an operator that
 * something is wrong and nothing about what. These are the firm's own
 * background tasks, so the type and the error are the firm's business — but the
 * message is truncated and no payload is ever included, because a payload can
 * carry an email address.
 */
export async function failedJobs(limit = 20): Promise<FailedJob[]> {
  const rows = await db
    .select({
      id: schema.jobs.id,
      type: schema.jobs.type,
      attempts: schema.jobs.attempts,
      maxAttempts: schema.jobs.maxAttempts,
      lastError: schema.jobs.lastError,
      runAt: schema.jobs.runAt,
    })
    .from(schema.jobs)
    .where(sql`${schema.jobs.doneAt} IS NULL AND ${schema.jobs.attempts} >= ${schema.jobs.maxAttempts}`)
    .orderBy(desc(schema.jobs.runAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    attempts: r.attempts,
    maxAttempts: r.maxAttempts,
    lastError: r.lastError === null ? null : truncate(r.lastError, FAILED_ERROR_CHARS),
    runAt: r.runAt.toISOString(),
  }));
}

export type RetryOutcome = { ok: true; job: FailedJob } | { ok: false; reason: 'not_found' | 'not_failed' };

/**
 * Puts a failed job back in the queue (H7).
 *
 * Only a job whose attempts are spent can be retried: anything else is either
 * already going to run again on its own or is running right now, and resetting
 * it under a worker's feet would double-send whatever it does. `lastError` is
 * deliberately kept — the reason it failed is still the most useful thing on
 * the row, and a retry that erases it makes the second failure look like the
 * first.
 *
 * Takes `tx` so the audit line lands with the reset or not at all.
 */
export async function retryJob(id: string, tx: RetryExecutor = db, now = new Date()): Promise<RetryOutcome> {
  const [existing] = await tx.select().from(schema.jobs).where(eq(schema.jobs.id, id)).limit(1);
  if (!existing) return { ok: false, reason: 'not_found' };
  if (existing.doneAt !== null || existing.attempts < existing.maxAttempts) return { ok: false, reason: 'not_failed' };

  const [row] = await tx
    .update(schema.jobs)
    .set({ attempts: 0, runAt: now, lockedAt: null, lockedBy: null })
    .where(eq(schema.jobs.id, id))
    .returning();

  return {
    ok: true,
    job: {
      id: row.id,
      type: row.type,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      lastError: row.lastError === null ? null : truncate(row.lastError, FAILED_ERROR_CHARS),
      runAt: row.runAt.toISOString(),
    },
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
