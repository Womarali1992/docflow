/**
 * The ops half of H7: is the worker alive, what has given up, and what is
 * actually running here.
 *
 * The audit's third finding was that a stopped worker is invisible — jobs stay
 * pending, which looks exactly like a quiet morning. Everything in this file is
 * about making one of those two states distinguishable from the other, and
 * about the daily email that says so when nobody is looking at the screen.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import {
  HEARTBEAT_KEEP_MS,
  HEARTBEAT_SILENT_MS,
  beat,
  pruneHeartbeats,
  workerStatus,
} from '../src/jobs/heartbeat.js';
import { DEFAULT_MAX_ATTEMPTS, claim, enqueue, fail, failedJobs, queueStats, retryJob } from '../src/jobs/queue.js';
import { collectOpsStatus, journalTags, opsProblems } from '../src/ops/status.js';
import { release } from '../src/ops/release.js';
import { runOpsDigest } from '../src/jobs/handlers/ops_digest.js';
import { render } from '../src/jobs/handlers/email.js';
import { DIGEST_HOUR, DIGEST_MINUTE, ensureScheduledJobs, firmInstant } from '../src/jobs/schedule.js';
import { app, loginAs, request, seedFixture, type Fixture } from './helpers.js';

/** A job that has used up every attempt — what `failed` means in this queue. */
async function exhaustedJob(type: 'email' | 'sweeper' = 'email', error = 'SMTP said no') {
  const job = await enqueue(type, { template: 'new_item', to: 'someone@example.test' });
  await db
    .update(schema.jobs)
    .set({ attempts: DEFAULT_MAX_ATTEMPTS, lastError: error, lockedAt: null, lockedBy: null })
    .where(eq(schema.jobs.id, job!.id));
  return job!.id;
}

describe('worker heartbeat', () => {
  beforeEach(async () => {
    await seedFixture();
  });

  it('says the worker has never reported in when nothing has', async () => {
    const status = await workerStatus();
    expect(status.workerId).toBeNull();
    expect(status.silentSeconds).toBeNull();
    // The distinction the whole feature exists for: "no worker" is a sentence,
    // not an empty row that reads as fine.
    expect(status.note).toMatch(/never reported in/);
  });

  it('records a beat and reports it as running', async () => {
    await beat('worker-1');
    const status = await workerStatus();
    expect(status.workerId).toBe('worker-1');
    expect(status.pid).toBe(process.pid);
    expect(status.host).not.toBeNull();
    expect(status.silentSeconds).toBeLessThan(5);
    expect(status.note).toBeNull();
  });

  it('keeps the start time across beats, so uptime is real', async () => {
    const start = new Date(Date.now() - 90 * 60_000);
    await beat('worker-1', start);
    await beat('worker-1');

    const [row] = await db.select().from(schema.workerHeartbeats);
    expect(row.startedAt.getTime()).toBe(start.getTime());
    expect(row.lastSeenAt.getTime()).toBeGreaterThan(start.getTime());
  });

  it('calls a worker that has gone quiet not answering, and says what that costs', async () => {
    await beat('worker-1', new Date(Date.now() - HEARTBEAT_SILENT_MS - 60_000));
    const status = await workerStatus();
    expect(status.silentSeconds).toBeGreaterThan(HEARTBEAT_SILENT_MS / 1000);
    expect(status.note).toMatch(/not reported in/);
    // Not just "down": what stops happening while it is.
    expect(status.note).toMatch(/reminders|emails|re-scans/);
  });

  it('reports the worker that is actually alive when a dead one is still on file', async () => {
    await beat('worker-old', new Date(Date.now() - 3 * 60 * 60_000));
    await beat('worker-new');
    const status = await workerStatus();
    expect(status.workerId).toBe('worker-new');
    expect(status.note).toBeNull();
  });

  it('forgets workers that stopped a week ago, and only those', async () => {
    await beat('worker-ancient', new Date(Date.now() - HEARTBEAT_KEEP_MS - 60_000));
    await beat('worker-yesterday', new Date(Date.now() - 24 * 60 * 60_000));

    expect(await pruneHeartbeats()).toBe(1);
    const rows = await db.select().from(schema.workerHeartbeats);
    expect(rows.map((r) => r.workerId)).toEqual(['worker-yesterday']);
  });
});

describe('the queue, seen from the ops panel', () => {
  beforeEach(async () => {
    await seedFixture();
  });

  it('ages only work that is due, not work that is scheduled', async () => {
    // Tomorrow's reminder is pending all day and alarms nobody; that is exactly
    // why `oldestPendingAt` alone could not be the signal.
    await enqueue('reminders', {}, { runAt: new Date(Date.now() + 12 * 60 * 60_000), dedupeKey: 'tomorrow' });
    let stats = await queueStats();
    expect(stats.pending).toBe(1);
    expect(stats.oldestActionableAgeSeconds).toBeNull();

    await enqueue('sweeper', {}, { runAt: new Date(Date.now() - 5 * 60_000), dedupeKey: 'overdue' });
    stats = await queueStats();
    expect(stats.pending).toBe(2);
    expect(stats.oldestActionableAgeSeconds).toBeGreaterThanOrEqual(299);
    expect(stats.oldestActionableAgeSeconds).toBeLessThan(360);
  });

  it('lists the jobs that gave up, with the error trimmed and no payload', async () => {
    const long = 'x'.repeat(500);
    const id = await exhaustedJob('email', long);
    await enqueue('sweeper', {}, { dedupeKey: 'still-fine' });

    const failed = await failedJobs();
    expect(failed.map((f) => f.id)).toEqual([id]);
    expect(failed[0].lastError!.length).toBeLessThanOrEqual(200);
    // The payload carries a recipient address. It never travels to the panel.
    expect(JSON.stringify(failed[0])).not.toMatch(/example\.test/);
  });

  it('puts a failed job back in the queue and keeps the reason it failed', async () => {
    const id = await exhaustedJob();
    const outcome = await retryJob(id);
    expect(outcome.ok).toBe(true);

    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
    expect(row.attempts).toBe(0);
    expect(row.lockedAt).toBeNull();
    expect(row.lockedBy).toBeNull();
    expect(row.runAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    // Kept on purpose: a retry that erases the error makes the second failure
    // look like the first.
    expect(row.lastError).toBe('SMTP said no');
    // And it is claimable again, which is the whole point.
    expect(await claim('worker-x')).toHaveLength(1);
  });

  it('refuses to reset a job that has not actually failed', async () => {
    const live = await enqueue('sweeper', {}, { dedupeKey: 'live' });
    expect(await retryJob(live!.id)).toEqual({ ok: false, reason: 'not_failed' });

    // One failed attempt with retries left is still going to run on its own.
    const [claimed] = await claim('worker-y');
    await fail(claimed, new Error('transient'));
    expect(await retryJob(claimed.id)).toEqual({ ok: false, reason: 'not_failed' });

    expect(await retryJob('00000000-0000-4000-8000-000000000000')).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('POST /ops/jobs/:id/retry', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('lets an advisor retry a failed job, and records who did it', async () => {
    const id = await exhaustedJob();
    const cookie = await loginAs(fx, 'provider1');

    const res = await request(app).post(`/api/ops/jobs/${id}/retry`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.job).toMatchObject({ id, attempts: 0 });

    const [entry] = await db
      .select()
      .from(schema.auditLog)
      .where(sql`${schema.auditLog.action} = 'job.retried'`);
    expect(entry).toBeDefined();
    expect(entry.targetId).toBe(id);
    expect(entry.actorId).toBe(fx.provider1.id);
  });

  it('answers 409 not_failed rather than quietly doing nothing', async () => {
    const live = await enqueue('sweeper', {}, { dedupeKey: 'live' });
    const cookie = await loginAs(fx, 'provider1');

    const res = await request(app).post(`/api/ops/jobs/${live!.id}/retry`).set('Cookie', cookie);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('not_failed');
  });

  it('answers 404 for an unknown id and for one that is not a uuid at all', async () => {
    const cookie = await loginAs(fx, 'provider1');
    for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      const res = await request(app).post(`/api/ops/jobs/${id}/retry`).set('Cookie', cookie);
      // A malformed id is a 404, never the 500 Postgres would give for 22P02.
      expect(res.status).toBe(404);
    }
  });
});

describe('the status the panel and the digest share', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  /** A box where nothing is wrong: fresh backup, live worker, nothing failed. */
  async function healthy() {
    await db.insert(schema.backupRuns).values({ startedAt: new Date(), ok: true, fileCount: 6, dumpBytes: 1024 });
    await beat('worker-1');
  }

  it('finds nothing to report on a healthy box', async () => {
    await healthy();
    const status = await collectOpsStatus(fx.provider1.id);
    expect(opsProblems(status)).toEqual([]);
    // Scanning is off in tests, which is a configuration choice and not a fault.
    expect(status.scanner.required).toBe(false);
    expect(status.scanner.note).toMatch(/switched off/);
  });

  it('names each thing that is wrong, in a sentence, without naming a client', async () => {
    await beat('worker-1', new Date(Date.now() - 30 * 60_000));
    await exhaustedJob();

    const status = await collectOpsStatus(fx.provider1.id);
    const problems = opsProblems(status);

    expect(problems.some((p) => /background job/.test(p))).toBe(true);
    expect(problems.some((p) => /not reported in/.test(p))).toBe(true);
    expect(problems.some((p) => /No successful backup/.test(p))).toBe(true);
    // The digest goes to an inbox. Nothing in it is a client.
    const [client] = await db.select().from(schema.clients).limit(1);
    expect(problems.join(' ')).not.toContain(client.name);
    expect(problems.join(' ')).not.toContain(client.email);
  });

  it('reports the build, the runtime and the migration gap', async () => {
    const status = await collectOpsStatus(fx.provider1.id);
    expect(status.release.node).toBe(process.version);
    // Run from source under vitest: there is no dist/release.json to read, and
    // saying so is better than inventing a commit.
    expect(status.release.commit).toBeNull();
    expect(status.release.note).toMatch(/build/);
    expect(status.release.migrations.applied).toBeGreaterThan(0);
    // docflow_test migrates from empty, so it carries every tag this build has.
    expect(status.release.migrations.pending).toEqual([]);
    expect(journalTags()).toContain('0010_worker_heartbeats');
  });

  it('never reads git at request time — the commit comes from a stamped file', () => {
    const r = release();
    expect(r.commit).toBeNull();
    expect(r.dirty).toBeNull();
    expect(r.node).toBe(process.version);
  });
});

describe('the daily problems digest', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
    // The digest queues mail, and queueEmail is a no-op without a server.
    process.env.SMTP_URL = 'smtp://digest:secret@mail.example.test:587';
  });

  afterEach(() => {
    // test/setup.ts deletes this so nothing in the suite can open a socket.
    delete process.env.SMTP_URL;
  });

  it('sends nothing on a day when nothing is wrong', async () => {
    await db.insert(schema.backupRuns).values({ startedAt: new Date(), ok: true });
    await beat('worker-1');

    const result = await runOpsDigest({ today: '2026-09-08' });
    expect(result.problems).toEqual([]);
    expect(result.emailsQueued).toBe(0);
    // A daily "everything is fine" is how an alert becomes a filter rule.
    expect(await db.select().from(schema.jobs)).toHaveLength(0);
  });

  it('queues one notice per advisor when something is wrong, and only one a day', async () => {
    await beat('worker-1', new Date(Date.now() - 60 * 60_000));

    const first = await runOpsDigest({ today: '2026-09-08' });
    expect(first.problems.length).toBeGreaterThan(0);
    // Two advisors in the fixture; both are on call, neither is deactivated.
    expect(first.recipients).toBe(2);
    expect(first.emailsQueued).toBe(2);

    // A retried digest job must not send a second copy.
    const again = await runOpsDigest({ today: '2026-09-08' });
    expect(again.emailsQueued).toBe(0);
    const mail = await db.select().from(schema.jobs).where(sql`${schema.jobs.type} = 'email'`);
    expect(mail).toHaveLength(2);
  });

  it('leaves a deactivated advisor off the list', async () => {
    await beat('worker-1', new Date(Date.now() - 60 * 60_000));
    await db
      .update(schema.providers)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.providers.id, fx.provider2.id));

    const result = await runOpsDigest({ today: '2026-09-08' });
    expect(result.recipients).toBe(1);
  });

  it('renders a subject that says how many, and a body with no link to sign in for', () => {
    const items = ['3 background jobs have failed and stopped retrying.', 'No successful backup has ever been recorded.'];
    const { subject, text } = render({ template: 'ops_digest', to: 'advisor@example.test', items });
    expect(subject).toBe('DocFlow needs attention (2 items)');
    for (const item of items) expect(text).toContain(item);
    expect(text).toContain('/settings/system');
  });

  it('is scheduled for the firm’s own morning, once a day', async () => {
    await ensureScheduledJobs(new Date('2026-09-08T18:00:00Z'), 'America/Chicago');
    const [digest] = await db.select().from(schema.jobs).where(sql`${schema.jobs.type} = 'ops_digest'`);
    expect(digest).toBeDefined();
    expect(digest.dedupeKey).toBe('ops_digest:2026-09-08');
    expect(digest.runAt.getTime()).toBe(firmInstant('2026-09-08', DIGEST_HOUR, 'America/Chicago', DIGEST_MINUTE).getTime());
    // Half an hour before the reminders, so there is time to act on it.
    expect(DIGEST_MINUTE).toBe(30);

    // Idempotent: a second pass on the same firm-local day adds nothing.
    await ensureScheduledJobs(new Date('2026-09-08T19:00:00Z'), 'America/Chicago');
    expect(await db.select().from(schema.jobs).where(sql`${schema.jobs.type} = 'ops_digest'`)).toHaveLength(1);
  });
});
