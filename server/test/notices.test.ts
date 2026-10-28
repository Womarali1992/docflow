/**
 * Event emails (2026-10-28 audit, blocking defect 2).
 *
 * Before this, the only mail DocFlow ever queued was invitations, resets, the
 * daily reminder and the ops digest. A client was never told a checklist
 * existed, a file had been sent back or a return was ready; the advisor was
 * never told anything had arrived. `notify()` now queues the email beside the
 * in-app notice, and these tests pin the two properties that keep it from
 * becoming noise: one email per recipient per window, and nothing but a
 * "something is waiting" in it.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, like } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { NOTICE_WINDOW_MS, noticeEmailKey, noticeWindow } from '../src/notify.js';
import { render } from '../src/jobs/handlers/email.js';
import type { MailJobPayload } from '../src/jobs/mail.js';
import { recordNewVersion } from '../src/workflow/versions.js';
import { ensureKeyDir, newStorageKey } from '../src/files/store.js';
import { PDF_BYTES, app, loginAs, request, seedFixture, type Fixture } from './helpers.js';

/** A client's answer on a request's document, through the same path the upload pipeline ends in. */
async function submitVersion(documentId: string, clientId: string) {
  const [document] = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId));
  const storageKey = newStorageKey(new Date(), 'pdf');
  fs.writeFileSync(ensureKeyDir(storageKey), PDF_BYTES);
  return recordNewVersion({
    document,
    originalFilename: 'statement.pdf',
    mimeType: 'application/pdf',
    sizeBytes: PDF_BYTES.length,
    sha256: createHash('sha256').update(PDF_BYTES).digest('hex'),
    storageKey,
    uploadedByKind: 'client',
    uploadedById: clientId,
  });
}

async function noticeJobs(kind: 'client' | 'provider', userId: string) {
  return db.select().from(schema.jobs).where(like(schema.jobs.dedupeKey, `notice:${kind}:${userId}:%`));
}

/** How many windows the instants between `before` and `after` touch: the honest number of emails. */
function windowsBetween(kind: 'client' | 'provider', before: Date, after: Date) {
  return noticeWindow(kind, before).getTime() === noticeWindow(kind, after).getTime() ? 1 : 2;
}

describe('event emails', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
    process.env.SMTP_URL = 'smtp://user:pass@localhost:1025';
  });

  afterEach(() => {
    delete process.env.SMTP_URL;
  });

  it('emails the client once for a new checklist and a message in the same window', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const before = new Date();

    const added = await request(app)
      .post(`/api/engagements/${fx.client1a.engagement}/requests`)
      .set('Cookie', advisor)
      .send({ items: [{ title: 'W-2' }, { title: '1099-INT' }, { title: '1098' }] });
    expect(added.status).toBe(201);
    const sent = await request(app)
      .post('/api/messages')
      .set('Cookie', advisor)
      .send({ clientId: fx.client1a.id, content: 'The 1098 is the one from your mortgage lender.' });
    expect(sent.status).toBe(201);

    const after = new Date();
    const jobs = await noticeJobs('client', fx.client1a.id);
    expect(jobs).toHaveLength(windowsBetween('client', before, after));

    const [job] = jobs;
    expect(job.type).toBe('email');
    const payload = job.payload as MailJobPayload;
    expect(payload.template).toBe('new_item');
    expect(payload.to).toBe(fx.client1a.email);
    // Sent when the window closes, so whatever else lands in it rides along.
    expect(job.runAt.getTime()).toBe(noticeWindow('client', before).getTime() + NOTICE_WINDOW_MS.client);
    // And it says nothing about what arrived.
    const { text } = render(payload);
    expect(text).not.toContain('W-2');
    expect(text).not.toContain('mortgage');
    expect(text).toContain('/portal');
  });

  it('tells the client a file needs another look', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const before = new Date();
    const answer = await submitVersion(fx.client1a.request, fx.client1a.id);
    const res = await request(app)
      .post(`/api/requests/${fx.client1a.request}/request-correction`)
      .set('Cookie', advisor)
      .send({ versionId: answer.version.id, note: 'Please send the whole statement, all pages.' });
    expect(res.status).toBe(200);

    const jobs = await noticeJobs('client', fx.client1a.id);
    expect(jobs).toHaveLength(1);
    const payload = jobs[0].payload as MailJobPayload;
    expect([noticeEmailKey('client', fx.client1a.id, before), noticeEmailKey('client', fx.client1a.id, new Date())]).toContain(
      jobs[0].dedupeKey
    );
    expect(payload.template).toBe('needs_attention');
    expect(render(payload).text).not.toContain('all pages');
  });

  it('tells the advisor a client uploaded something', async () => {
    const client = await loginAs(fx, 'client1a');
    const upload = await request(app)
      .post(`/api/requests/${fx.client1a.request}/uploads`)
      .set('Cookie', client)
      .attach('file', PDF_BYTES, { filename: 'statement.pdf' });
    expect([201, 202]).toContain(upload.status);

    const jobs = await noticeJobs('provider', fx.provider1.id);
    expect(jobs).toHaveLength(1);
    const payload = jobs[0].payload as MailJobPayload;
    expect(payload.template).toBe('advisor_activity');
    expect(payload.to).toBe(fx.provider1.email);
    expect(render(payload).text).not.toContain('statement.pdf');
  });

  it('emails the advisor once an hour, however many clients write', async () => {
    const before = new Date();
    for (const who of ['client1a', 'client1b'] as const) {
      const cookie = await loginAs(fx, who);
      const res = await request(app).post('/api/messages').set('Cookie', cookie).send({ content: 'A question about my return.' });
      expect(res.status).toBe(201);
    }
    const after = new Date();

    const jobs = await noticeJobs('provider', fx.provider1.id);
    expect(jobs).toHaveLength(windowsBetween('provider', before, after));
    const payload = jobs[0].payload as MailJobPayload;
    expect(payload.template).toBe('advisor_activity');
    const { subject, text } = render(payload);
    // A firm inbox is forwarded and read on phones: no client names in it.
    expect(`${subject} ${text}`).not.toContain('Client 1A');
    expect(`${subject} ${text}`).not.toContain('Client 1B');
    expect(text).toContain('/work');
  });

  it('does not email a client who cannot sign in', async () => {
    const advisor = await loginAs(fx, 'provider1');

    // Invitation not accepted yet: no password.
    await db.update(schema.clients).set({ passwordHash: null }).where(eq(schema.clients.id, fx.client1a.id));
    // Deactivated.
    await db.update(schema.clients).set({ deactivatedAt: new Date() }).where(eq(schema.clients.id, fx.client1b.id));

    for (const client of [fx.client1a, fx.client1b]) {
      const res = await request(app)
        .post(`/api/engagements/${client.engagement}/requests`)
        .set('Cookie', advisor)
        .send({ items: [{ title: 'W-2' }] });
      expect(res.status).toBe(201);
      expect(await noticeJobs('client', client.id)).toHaveLength(0);
    }

    // The in-app notice is still written: it is waiting for them when they can sign in.
    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, fx.client1a.id));
    expect(notes.some((n) => n.type === 'request.created')).toBe(true);
  });

  it('queues nothing while SMTP is unset', async () => {
    delete process.env.SMTP_URL;
    const advisor = await loginAs(fx, 'provider1');
    const res = await request(app)
      .post(`/api/engagements/${fx.client1a.engagement}/requests`)
      .set('Cookie', advisor)
      .send({ items: [{ title: 'W-2' }] });
    expect(res.status).toBe(201);
    expect(await db.select().from(schema.jobs)).toHaveLength(0);
  });
});
