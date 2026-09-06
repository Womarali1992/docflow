/**
 * The background queue, the worker loop and the mailer (C1.4).
 *
 * The properties worth protecting: two workers never run the same job, a
 * failure is retried with backoff and then stops for good, a dedupe key
 * collapses duplicates, and an email body never carries anything confidential.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { DEFAULT_MAX_ATTEMPTS, backoffMs, claim, complete, enqueue, fail, queueStats } from '../src/jobs/queue.js';
import { runOnce, type Handler } from '../src/jobs/worker.js';
import { MAIL_TEMPLATES, enqueueEmail, isMailConfigured, mailFrom } from '../src/jobs/mail.js';
import { parsePayload, render, sendEmailJob, type Envelope, type MailTransport } from '../src/jobs/handlers/email.js';
import type { Job } from '../src/db/schema.js';
import { app, loginAs, request, seedFixture, type Fixture } from './helpers.js';

/** Collects what would have been sent, so no test opens a socket. */
function stubTransport(): MailTransport & { sent: Envelope[] } {
  const sent: Envelope[] = [];
  return {
    sent,
    async sendMail(message: Envelope) {
      sent.push(message);
      return { messageId: 'stub' };
    },
  };
}

async function jobRow(id: string): Promise<Job> {
  const [row] = await db.select().from(schema.jobs).where(sql`${schema.jobs.id} = ${id}`);
  return row;
}

describe('job queue', () => {
  it('claims a due job exactly once, and only one worker gets it', async () => {
    const job = await enqueue('sweeper', {});
    expect(job).not.toBeNull();

    const [a, b] = await Promise.all([claim('worker-a'), claim('worker-b')]);
    const claimed = [...a, ...b];
    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe(job!.id);
    expect(claimed[0].attempts).toBe(1);
    expect(['worker-a', 'worker-b']).toContain(claimed[0].lockedBy);

    // And nothing is left to claim.
    expect(await claim('worker-c')).toHaveLength(0);
  });

  it('skips a row another transaction holds instead of waiting for it', async () => {
    const job = await enqueue('sweeper', {});
    // Without FOR UPDATE SKIP LOCKED this claim would block until the transaction
    // commits and the test would time out rather than fail.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${schema.jobs} WHERE id = ${job!.id} FOR UPDATE`);
      expect(await claim('worker-b')).toHaveLength(0);
    });
    // Once the lock is gone the job is claimable again.
    expect(await claim('worker-b')).toHaveLength(1);
  });

  it('does not claim a job before its runAt', async () => {
    const later = new Date(Date.now() + 60_000);
    await enqueue('sweeper', {}, { runAt: later });
    expect(await claim('worker-a')).toHaveLength(0);
    expect(await claim('worker-a', 1, new Date(Date.now() + 61_000))).toHaveLength(1);
  });

  it('retries a failure with growing backoff, then gives up for good', async () => {
    const created = await enqueue('sweeper', {}, { maxAttempts: 2 });
    const now = new Date();

    const [first] = await claim('worker-a', 1, now);
    await fail(first, new Error('smtp unreachable'), now);

    let row = await jobRow(created!.id);
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('smtp unreachable');
    expect(row.lockedBy).toBeNull();
    expect(row.doneAt).toBeNull();
    // Pushed out by the first rung of the ladder, so it is not retried immediately.
    expect(row.runAt.getTime()).toBeGreaterThanOrEqual(now.getTime() + backoffMs(1) - 1000);
    expect(await claim('worker-a', 1, now)).toHaveLength(0);

    const afterBackoff = new Date(now.getTime() + backoffMs(1) + 1000);
    const [second] = await claim('worker-a', 1, afterBackoff);
    expect(second.attempts).toBe(2);
    await fail(second, new Error('smtp unreachable'), afterBackoff);

    row = await jobRow(created!.id);
    expect(row.attempts).toBe(2);
    expect(row.doneAt).toBeNull();
    // Attempts are spent: never claimed again, however far into the future.
    expect(await claim('worker-a', 1, new Date(afterBackoff.getTime() + 86_400_000))).toHaveLength(0);

    const stats = await queueStats();
    expect(stats.failed).toBe(1);
    expect(stats.pending).toBe(0);
  });

  it('reclaims a job whose worker died mid-handler', async () => {
    const created = await enqueue('sweeper', {});
    const now = new Date();
    await claim('worker-that-crashed', 1, now);
    expect(await claim('worker-b', 1, now)).toHaveLength(0);

    // Six minutes later the lock is considered abandoned (STUCK_LOCK_MS = 5 min).
    const [reclaimed] = await claim('worker-b', 1, new Date(now.getTime() + 6 * 60_000));
    expect(reclaimed.id).toBe(created!.id);
    expect(reclaimed.attempts).toBe(2);
  });

  it('collapses duplicates on dedupeKey', async () => {
    const first = await enqueue('sweeper', { n: 1 }, { dedupeKey: 'sweep:2026-09-06' });
    const second = await enqueue('sweeper', { n: 2 }, { dedupeKey: 'sweep:2026-09-06' });
    expect(first).not.toBeNull();
    expect(second).toBeNull();

    const rows = await db.select().from(schema.jobs);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ n: 1 });

    // A different key is a different job.
    expect(await enqueue('sweeper', {}, { dedupeKey: 'sweep:2026-09-07' })).not.toBeNull();
  });

  it('defaults to five attempts and counts pending work', async () => {
    const job = await enqueue('sweeper', {});
    expect(job!.maxAttempts).toBe(DEFAULT_MAX_ATTEMPTS);

    const stats = await queueStats();
    expect(stats).toMatchObject({ pending: 1, failed: 0, done: 0 });
    expect(stats.oldestPendingAt).not.toBeNull();

    await complete(job!.id);
    expect(await queueStats()).toMatchObject({ pending: 0, failed: 0, done: 1, oldestPendingAt: null });
  });
});

describe('worker loop', () => {
  it('runs a handler and marks the job done', async () => {
    const created = await enqueue('sweeper', { hello: 'world' });
    const seen: Job[] = [];
    const registry: Record<string, Handler> = { sweeper: async (job) => void seen.push(job) };

    expect(await runOnce('worker-a', registry)).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].payload).toEqual({ hello: 'world' });

    const row = await jobRow(created!.id);
    expect(row.doneAt).not.toBeNull();
    expect(row.lastError).toBeNull();
    expect(row.lockedBy).toBeNull();
  });

  it('fails a job whose handler throws, without stopping the batch', async () => {
    await enqueue('sweeper', { n: 1 });
    await enqueue('scan_retry', { n: 2 });
    const registry: Record<string, Handler> = {
      sweeper: async () => {
        throw new Error('boom');
      },
      scan_retry: async () => undefined,
    };

    expect(await runOnce('worker-a', registry, 10)).toBe(2);
    const rows = await db.select().from(schema.jobs);
    const broken = rows.find((r) => r.type === 'sweeper')!;
    const fine = rows.find((r) => r.type === 'scan_retry')!;
    expect(broken.doneAt).toBeNull();
    expect(broken.lastError).toBe('boom');
    expect(fine.doneAt).not.toBeNull();
  });

  it('fails an unknown job type with a clear message instead of crashing', async () => {
    const created = await enqueue('sweeper', {});
    expect(await runOnce('worker-a', {})).toBe(1);
    const row = await jobRow(created!.id);
    expect(row.lastError).toMatch(/No handler for job type "sweeper"/);
    expect(row.doneAt).toBeNull();
  });

  it('processes nothing when the queue is empty', async () => {
    expect(await runOnce('worker-a')).toBe(0);
  });
});

describe('mailer', () => {
  it('queues nothing while SMTP_URL is unset', async () => {
    expect(isMailConfigured()).toBe(false);
    expect(await enqueueEmail({ template: 'invitation', to: 'someone@example.com', link: 'http://x/invite/abc' })).toBe(false);
    expect(await db.select().from(schema.jobs)).toHaveLength(0);
  });

  it('queues an email once a mail server is configured, and never without an address', async () => {
    process.env.SMTP_URL = 'smtp://user:pass@localhost:1025';
    try {
      expect(await enqueueEmail({ template: 'invitation', to: 'client@example.com', link: 'http://x/invite/abc' })).toBe(true);
      expect(await enqueueEmail({ template: 'invitation', to: '', link: 'http://x/invite/abc' })).toBe(false);
      const rows = await db.select().from(schema.jobs);
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('email');
      expect(rows[0].payload).toMatchObject({ template: 'invitation', to: 'client@example.com' });
    } finally {
      delete process.env.SMTP_URL;
    }
  });

  it('sends through the transport and addresses it from MAIL_FROM', async () => {
    const transport = stubTransport();
    const job = { id: 'j1', payload: { template: 'invitation', to: 'client@example.com', link: 'http://localhost:8080/invite/abc', firmName: 'Nolan & Co' } } as unknown as Job;

    expect(await sendEmailJob(job, transport)).toBe('sent');
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].to).toBe('client@example.com');
    expect(transport.sent[0].from).toBe(mailFrom());
    expect(transport.sent[0].text).toContain('http://localhost:8080/invite/abc');
    expect(transport.sent[0].text).toContain('Nolan & Co');
  });

  it('skips (does not fail) when no transport is configured', async () => {
    const job = { id: 'j1', payload: { template: 'new_item', to: 'client@example.com' } } as unknown as Job;
    expect(await sendEmailJob(job, null)).toBe('skipped');
  });

  it('refuses a payload it cannot send rather than sending something wrong', () => {
    expect(() => parsePayload({ template: 'nope', to: 'a@b.com' })).toThrow(/Unknown email template/);
    expect(() => parsePayload({ template: 'invitation', to: 'not-an-address' })).toThrow(/recipient/);
  });

  it('keeps every notice generic — no filenames, amounts or message text', () => {
    const secrets = ['2025-W2-Nolan.pdf', '$14,220', 'Please send the K-1 for the trust'];
    for (const template of MAIL_TEMPLATES) {
      const { subject, text } = render({ template, to: 'client@example.com', link: 'http://localhost:8080/x', firmName: 'Nolan & Co' });
      expect(subject.length).toBeGreaterThan(0);
      for (const secret of secrets) {
        expect(`${subject} ${text}`).not.toContain(secret);
      }
      // Every notice sends the reader to the portal rather than carrying the content.
      expect(text).toContain('http://localhost:8080');
      expect(text).toContain('do not reply');
    }
  });
});

describe('invitation and reset emails', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('returns the copy-link and queues nothing when SMTP is unset', async () => {
    const cookie = await loginAs(fx, 'provider1');
    const res = await request(app).post(`/api/clients/${fx.client1a.id}/invitations`).set('Cookie', cookie);
    expect(res.status).toBe(201);
    expect(res.body.link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(res.body.emailQueued).toBe(false);
    expect(await db.select().from(schema.jobs)).toHaveLength(0);
  });

  it('queues the invitation email — carrying the link, not the client details — when SMTP is set', async () => {
    process.env.SMTP_URL = 'smtp://user:pass@localhost:1025';
    try {
      const cookie = await loginAs(fx, 'provider1');
      const res = await request(app).post(`/api/clients/${fx.client1a.id}/invitations`).set('Cookie', cookie);
      expect(res.status).toBe(201);
      expect(res.body.emailQueued).toBe(true);

      const [job] = await db.select().from(schema.jobs);
      expect(job.type).toBe('email');
      const payload = job.payload as Record<string, unknown>;
      expect(payload.template).toBe('invitation');
      expect(payload.to).toBe(fx.client1a.email);
      expect(payload.link).toBe(res.body.link);

      // The rendered body carries the link and the firm, and never the client's name.
      const [client] = await db.select({ name: schema.clients.name }).from(schema.clients).where(sql`${schema.clients.id} = ${fx.client1a.id}`);
      const transport = stubTransport();
      await sendEmailJob(job, transport);
      expect(transport.sent[0].text).toContain(res.body.link);
      expect(transport.sent[0].text).not.toContain(client.name);
    } finally {
      delete process.env.SMTP_URL;
    }
  });

  it('queues a reset for the self-service form and still answers 202 either way', async () => {
    process.env.SMTP_URL = 'smtp://user:pass@localhost:1025';
    try {
      const known = await request(app).post('/api/auth/password-reset/request').send({ email: fx.provider1.email, kind: 'provider' });
      expect(known.status).toBe(202);
      const unknown = await request(app).post('/api/auth/password-reset/request').send({ email: 'nobody@example.com', kind: 'provider' });
      expect(unknown.status).toBe(202);
      expect(unknown.body).toEqual(known.body);

      const jobs = await db.select().from(schema.jobs);
      expect(jobs).toHaveLength(1);
      expect((jobs[0].payload as Record<string, unknown>).template).toBe('password_reset');
      expect((jobs[0].payload as Record<string, unknown>).to).toBe(fx.provider1.email);
    } finally {
      delete process.env.SMTP_URL;
    }
  });

  it('does not queue anything for a deactivated client', async () => {
    process.env.SMTP_URL = 'smtp://user:pass@localhost:1025';
    try {
      const cookie = await loginAs(fx, 'provider1');
      await request(app).post(`/api/clients/${fx.client1a.id}/deactivate`).set('Cookie', cookie);
      const res = await request(app).post(`/api/clients/${fx.client1a.id}/invitations`).set('Cookie', cookie);
      expect(res.status).toBe(409);
      expect(await db.select().from(schema.jobs)).toHaveLength(0);
    } finally {
      delete process.env.SMTP_URL;
    }
  });
});

describe('GET /api/ops/status', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('reports queue depth and mail configuration to the advisor', async () => {
    await enqueue('sweeper', {});
    await enqueue('sweeper', {}, { maxAttempts: 1, dedupeKey: 'doomed' });
    const [claimed] = await claim('worker-a');
    await fail(claimed, new Error('nope'));

    const cookie = await loginAs(fx, 'provider1');
    const res = await request(app).get('/api/ops/status').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.jobs.pending + res.body.jobs.failed).toBe(2);
    expect(res.body.mail.configured).toBe(false);
    expect(res.body.mail.note).toMatch(/copy-link/);
    expect(typeof res.body.time).toBe('string');
  });

  it('says nothing to a client', async () => {
    const cookie = await loginAs(fx, 'client1a');
    const res = await request(app).get('/api/ops/status').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/jobs|smtp/i);
  });

  it('says nothing to an anonymous caller', async () => {
    const res = await request(app).get('/api/ops/status');
    expect(res.status).toBe(401);
  });
});
