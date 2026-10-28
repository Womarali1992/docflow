/**
 * The review loop (C2.2): the state machine a whole tax season runs through.
 *
 * Uploads themselves arrive in C2.3, so these tests put versions on documents
 * through `recordNewVersion` — the same function the upload pipeline will call
 * at the end of its transaction, so what is asserted here is what will happen
 * in production, not a test-only shortcut.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool, schema } from '../src/db/client.js';
import { recordNewVersion } from '../src/workflow/versions.js';
import { ensureKeyDir, newStorageKey } from '../src/files/store.js';
import { FIXTURES } from './fixtures.js';
import { PDF_BYTES, app, loginAs, request, seedFixture, type Fixture } from './helpers.js';

/** Puts a new version on a document, exactly as C2.3's publish step will. */
async function submitVersion(documentId: string, uploader: { kind: 'provider' | 'client'; id: string }, filename = 'submission.pdf') {
  const [document] = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId));
  const storageKey = newStorageKey(new Date(), 'pdf');
  fs.writeFileSync(ensureKeyDir(storageKey), PDF_BYTES);
  return recordNewVersion({
    document,
    originalFilename: filename,
    mimeType: 'application/pdf',
    sizeBytes: PDF_BYTES.length,
    sha256: createHash('sha256').update(PDF_BYTES).digest('hex'),
    storageKey,
    uploadedByKind: uploader.kind,
    uploadedById: uploader.id,
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until some backend in this database is blocked on a row lock. A fixed
 * sleep cannot tell "waiting for the lock" from "still on its way there", and
 * on a busy machine the second looks exactly like the first. Asked on a fresh
 * pool connection, because a transaction sees one frozen snapshot of
 * pg_stat_activity.
 */
async function someoneWaitsForALock(timeoutMs = 10_000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'"
    );
    if (rows[0].n > 0) return true;
    await sleep(25);
  }
  return false;
}

async function requestRow(id: string) {
  const [row] = await db.select().from(schema.requests).where(eq(schema.requests.id, id));
  return row;
}

describe('request lifecycle', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('runs requested → submitted → needs_correction → submitted → accepted', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const requestId = fx.client1a.request;
    const documentId = fx.client1a.request; // the document and its request share an id

    expect((await requestRow(requestId)).status).toBe('requested');

    // 1. The client answers.
    const first = await submitVersion(documentId, { kind: 'client', id: fx.client1a.id }, 'policy.pdf');
    expect((await requestRow(requestId)).status).toBe('submitted');

    // 2. The advisor sends it back, and has to say why.
    const bare = await request(app).post(`/api/requests/${requestId}/request-correction`).set('Cookie', advisor).send({});
    expect(bare.status).toBe(400);
    expect(bare.body.code).toBe('note_required');

    const correction = await request(app)
      .post(`/api/requests/${requestId}/request-correction`)
      .set('Cookie', advisor)
      .send({ versionId: first.version.id, note: 'This is last year’s policy — please send the current one.' });
    expect(correction.status).toBe(200);
    expect(correction.body.status).toBe('needs_correction');

    // 3. The client tries again.
    const second = await submitVersion(documentId, { kind: 'client', id: fx.client1a.id }, 'policy-2026.pdf');
    expect(second.version.versionNo).toBe(2);
    expect((await requestRow(requestId)).status).toBe('submitted');

    // 4. The advisor accepts.
    const accepted = await request(app)
      .post(`/api/requests/${requestId}/accept`)
      .set('Cookie', advisor)
      .send({ versionId: second.version.id });
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('accepted');

    // Both decisions are on file, against the version each was about.
    const reviews = await db.select().from(schema.reviews).where(eq(schema.reviews.documentId, documentId));
    expect(reviews).toHaveLength(2);
    expect(reviews.map((r) => r.decision).sort()).toEqual(['accepted', 'needs_correction']);
  });

  /** 2026-10-28 audit: the note was stored on the review and nobody ever read it back out. */
  it('puts the correction note in front of the client, on the line and in its thread', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const client = await loginAs(fx, 'client1a');
    const requestId = fx.client1a.request;
    const note = 'This is the December statement rather than the annual 1098.';

    const first = await submitVersion(requestId, { kind: 'client', id: fx.client1a.id }, 'statement.pdf');
    const sent = await request(app)
      .post(`/api/requests/${requestId}/request-correction`)
      .set('Cookie', advisor)
      .send({ versionId: first.version.id, note });
    expect(sent.status).toBe(200);
    expect(sent.body.correction).toMatchObject({ note });

    // The client's engagement tree — the portal's source — carries it on the line.
    const engagementId = (await requestRow(requestId)).engagementId;
    const tree = await request(app).get(`/api/engagements/${engagementId}`).set('Cookie', client);
    expect(tree.status).toBe(200);
    const line = tree.body.requests.find((r: { id: string }) => r.id === requestId);
    expect(line.status).toBe('needs_correction');
    expect(line.correction.note).toBe(note);

    // And it is a message on the item's thread, from the advisor, that the client can answer.
    const thread = await request(app).get(`/api/messages?documentId=${first.document.id}`).set('Cookie', client);
    expect(thread.status).toBe(200);
    expect(thread.body).toHaveLength(1);
    expect(thread.body[0]).toMatchObject({ senderKind: 'provider', documentId: first.document.id });
    expect(thread.body[0].content).toContain(note);

    // Once a corrected copy arrives the open note is gone from the line; the thread keeps it.
    await submitVersion(requestId, { kind: 'client', id: fx.client1a.id }, 'form-1098.pdf');
    const after = await request(app).get(`/api/requests/${requestId}`).set('Cookie', client);
    expect(after.body.status).toBe('submitted');
    expect(after.body.correction).toBeNull();
  });

  it('will not accept or correct a request nothing has been submitted against', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const id = fx.client1a.request;

    const accept = await request(app).post(`/api/requests/${id}/accept`).set('Cookie', advisor).send({});
    expect(accept.status).toBe(400);
    expect(accept.body.code).toBe('nothing_submitted');

    const correct = await request(app).post(`/api/requests/${id}/request-correction`).set('Cookie', advisor).send({ note: 'x' });
    expect(correct.status).toBe(400);
    expect(correct.body.code).toBe('nothing_submitted');
  });

  it('refuses to waive without a reason, and keeps the reason on the file', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const id = fx.client1a.request;

    const bare = await request(app).post(`/api/requests/${id}/waive`).set('Cookie', advisor).send({});
    expect(bare.status).toBe(400);
    expect(bare.body.code).toBe('reason_required');

    const empty = await request(app).post(`/api/requests/${id}/waive`).set('Cookie', advisor).send({ reason: '' });
    expect(empty.status).toBe(400);

    const waived = await request(app).post(`/api/requests/${id}/waive`).set('Cookie', advisor).send({ reason: 'No rental property this year' });
    expect(waived.status).toBe(200);
    expect(waived.body).toMatchObject({ status: 'waived', waivedReason: 'No rental property this year' });

    const row = await requestRow(id);
    expect(row.waivedAt).not.toBeNull();
    expect(row.waivedById).toBe(fx.provider1.id);
  });

  it('reopens a decided request, back to submitted when an answer is already on file', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const id = fx.client1a.request;

    // Waived with nothing submitted → reopening puts it back on the client's list.
    await request(app).post(`/api/requests/${id}/waive`).set('Cookie', advisor).send({ reason: 'not needed' });
    const reopened = await request(app).post(`/api/requests/${id}/reopen`).set('Cookie', advisor);
    expect(reopened.body).toMatchObject({ status: 'requested', waivedReason: null, waivedAt: null });

    // With an answer on file, reopening puts it back in front of the advisor.
    const answer = await submitVersion(id, { kind: 'client', id: fx.client1a.id });
    await request(app).post(`/api/requests/${id}/accept`).set('Cookie', advisor).send({ versionId: answer.version.id });
    const again = await request(app).post(`/api/requests/${id}/reopen`).set('Cookie', advisor);
    expect(again.body.status).toBe('submitted');
  });

  it('records the client’s "I don’t have this" without taking it off the advisor’s list', async () => {
    const client = await loginAs(fx, 'client1a');
    const advisor = await loginAs(fx, 'provider1');
    const id = fx.client1a.request;

    const responded = await request(app)
      .post(`/api/requests/${id}/respond`)
      .set('Cookie', client)
      .send({ kind: 'not_applicable', note: 'I do not have a mortgage' });
    expect(responded.status).toBe(200);
    // Recorded, but the advisor still has to decide.
    expect(responded.body.status).toBe('requested');

    const dash = await request(app).get('/api/dashboard').set('Cookie', advisor);
    expect(dash.body.needsDecision.count).toBe(1);
    expect(dash.body.needsDecision.ids).toContain(id);

    // Waiving it is the decision, and it leaves "needs decision".
    await request(app).post(`/api/requests/${id}/waive`).set('Cookie', advisor).send({ reason: 'Client rents' });
    const after = await request(app).get('/api/dashboard').set('Cookie', advisor);
    expect(after.body.needsDecision.count).toBe(0);
  });

  it('rejects a decision about a version belonging to another request', async () => {
    const advisor = await loginAs(fx, 'provider1');
    await submitVersion(fx.client1a.request, { kind: 'client', id: fx.client1a.id });

    const res = await request(app)
      .post(`/api/requests/${fx.client1a.request}/accept`)
      .set('Cookie', advisor)
      // A real version, but it belongs to the client's ad-hoc upload.
      .send({ versionId: fx.client1a.uploadVersion });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('version_mismatch');
  });
});

/* 2026-10-28 audit: a line asked for by mistake could only be waived, with a
   reason the client reads. */
describe('taking a line off the checklist', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  const tree = (cookie: string, engagementId: string) => request(app).get(`/api/engagements/${engagementId}`).set('Cookie', cookie);
  const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

  it('takes an empty line off both screens and the queue, and keeps it for the advisor', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const client = await loginAs(fx, 'client1a');
    const id = fx.client1a.request;

    const removed = await request(app).post(`/api/requests/${id}/remove`).set('Cookie', advisor);
    expect(removed.status).toBe(200);
    expect(removed.body.archivedAt).not.toBeNull();
    // Status is left as it was: removing is not a decision about the line.
    expect(removed.body.status).toBe('requested');

    const forAdvisor = await tree(advisor, fx.client1a.engagement);
    expect(ids(forAdvisor.body.requests)).not.toContain(id);
    expect(ids(forAdvisor.body.removedRequests)).toEqual([id]);

    const forClient = await tree(client, fx.client1a.engagement);
    expect(ids(forClient.body.requests)).not.toContain(id);
    expect(forClient.body).not.toHaveProperty('removedRequests');

    const dash = await request(app).get('/api/dashboard').set('Cookie', advisor);
    expect(ids(dash.body.waitingOnClients.items)).not.toContain(id);

    // Removing twice is the same as removing once.
    const again = await request(app).post(`/api/requests/${id}/remove`).set('Cookie', advisor);
    expect(again.status).toBe(200);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'request.removed'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetId: id, clientId: fx.client1a.id });
  });

  it('puts it back as it was', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const id = fx.client1a.request;
    await request(app).post(`/api/requests/${id}/remove`).set('Cookie', advisor);

    const restored = await request(app).post(`/api/requests/${id}/restore`).set('Cookie', advisor);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ archivedAt: null, status: 'requested' });

    const after = await tree(advisor, fx.client1a.engagement);
    expect(ids(after.body.requests)).toContain(id);
    expect(after.body.removedRequests).toEqual([]);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'request.restored'));
    expect(rows).toHaveLength(1);
  });

  it('refuses once the client has sent a file for it — that line is on the record', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const id = fx.client1a.request;
    await submitVersion(id, { kind: 'client', id: fx.client1a.id });

    const res = await request(app).post(`/api/requests/${id}/remove`).set('Cookie', advisor);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('has_files');
    expect((await requestRow(id)).archivedAt).toBeNull();
  });

  it('is the advisor’s, and not on a closed engagement', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const client = await loginAs(fx, 'client1a');
    const id = fx.client1a.request;

    const byClient = await request(app).post(`/api/requests/${id}/remove`).set('Cookie', client);
    expect(byClient.status).toBe(403);

    await request(app).post(`/api/engagements/${fx.client1a.engagement}/close`).set('Cookie', advisor);
    const onClosed = await request(app).post(`/api/requests/${id}/remove`).set('Cookie', advisor);
    expect(onClosed.status).toBe(400);
    expect(onClosed.body.code).toBe('engagement_closed');
  });

  it('tells a client with the line still open that it is off their list', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const client = await loginAs(fx, 'client1a');
    const id = fx.client1a.request;
    await request(app).post(`/api/requests/${id}/remove`).set('Cookie', advisor);

    const upload = await request(app)
      .post(`/api/requests/${id}/uploads`)
      .set('Cookie', client)
      .attach('file', PDF_BYTES, { filename: 'late.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(400);
    expect(upload.body.code).toBe('request_removed');

    const respond = await request(app).post(`/api/requests/${id}/respond`).set('Cookie', client).send({ kind: 'not_applicable' });
    expect(respond.status).toBe(400);
    expect(respond.body.code).toBe('request_removed');
  });

  /**
   * The race, held still: the client's upload was authorized while the line was
   * on the list, and the advisor removes it while the bytes are on their way.
   * The upload waits for the line's lock, sees the removal, and puts the line
   * back — a file never lands on a line nobody can see.
   */
  it('puts the line back when a file reaches it after all', async () => {
    const client = await loginAs(fx, 'client1a');
    const id = fx.client1a.request;
    const holder = await pool.connect();

    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM requests WHERE id = $1 FOR UPDATE', [id]);

      const pending = request(app)
        .post(`/api/requests/${id}/uploads`)
        .set('Cookie', client)
        .attach('file', Buffer.from(FIXTURES.pdf.bytes), { filename: FIXTURES.pdf.name })
        .then((r) => r);
      // Authorized while the line was on the list, and now parked on its lock.
      expect(await someoneWaitsForALock()).toBe(true);

      // What `POST /requests/:id/remove` writes, landing while the upload waits.
      await holder.query('UPDATE requests SET archived_at = now() WHERE id = $1', [id]);
      await holder.query('COMMIT');

      const res = await pending;
      expect([201, 202]).toContain(res.status);
      expect((await requestRow(id)).archivedAt).toBeNull();
    } finally {
      holder.release();
    }
  });
});

/* 2026-10-28 audit: a client who sent the wrong file could only send another. */
describe('a client withdrawing a file', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  /** A second file on the client's open line, as a second upload would make it. */
  async function anotherAttachment(requestId: string) {
    const [line] = await db.select().from(schema.requests).where(eq(schema.requests.id, requestId));
    const [doc] = await db
      .insert(schema.documents)
      .values({
        clientId: line.clientId,
        providerId: line.providerId,
        engagementId: line.engagementId,
        requestId,
        kind: 'client_upload',
        name: 'second.pdf',
        displayName: 'second.pdf',
        category: line.category,
      })
      .returning();
    return submitVersion(doc.id, { kind: 'client', id: line.clientId }, 'second.pdf');
  }

  const withdraw = (cookie: string, documentId: string) => request(app).post(`/api/documents/${documentId}/withdraw`).set('Cookie', cookie);

  it('takes back a file nobody has decided on, keeps it on the record, and reopens the line', async () => {
    const client = await loginAs(fx, 'client1a');
    const advisor = await loginAs(fx, 'provider1');
    const sent = await submitVersion(fx.client1a.request, { kind: 'client', id: fx.client1a.id }, 'wrong.pdf');
    expect((await requestRow(fx.client1a.request)).status).toBe('submitted');

    const tree = await request(app).get(`/api/engagements/${fx.client1a.engagement}`).set('Cookie', client);
    const line = tree.body.requests.find((r: { id: string }) => r.id === fx.client1a.request);
    expect(line.attachments[0]).toMatchObject({ documentId: sent.document.id, decided: false });

    const res = await withdraw(client, sent.document.id);
    expect(res.status).toBe(200);
    expect(res.body.archivedAt).not.toBeNull();
    // Nothing else is on the line, so it is the client's to answer again.
    expect((await requestRow(fx.client1a.request)).status).toBe('requested');

    // The bytes and the row are still there, and the advisor can see both.
    const [version] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, sent.version.id));
    expect(version).toBeDefined();
    const seen = await request(app).get(`/api/documents/${sent.document.id}`).set('Cookie', advisor);
    expect(seen.status).toBe(200);

    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'document.withdrawn'));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ targetId: sent.document.id, actorKind: 'client' });
    const told = await db.select().from(schema.notifications).where(eq(schema.notifications.type, 'upload.withdrawn'));
    expect(told).toHaveLength(1);
    expect(told[0].userId).toBe(fx.provider1.id);

    // Twice is once.
    expect((await withdraw(client, sent.document.id)).status).toBe(200);
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'document.withdrawn'))).toHaveLength(1);
  });

  it('refuses once the advisor has ruled on the file', async () => {
    const client = await loginAs(fx, 'client1a');
    const advisor = await loginAs(fx, 'provider1');
    const sent = await submitVersion(fx.client1a.request, { kind: 'client', id: fx.client1a.id });
    await request(app)
      .post(`/api/requests/${fx.client1a.request}/request-correction`)
      .set('Cookie', advisor)
      .send({ versionId: sent.version.id, note: 'Wrong year' });

    const res = await withdraw(client, sent.document.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('decided');
    expect((await requestRow(fx.client1a.request)).status).toBe('needs_correction');

    // A replacement starts undecided again, and can be withdrawn.
    const replaced = await submitVersion(sent.document.id, { kind: 'client', id: fx.client1a.id }, 'still-wrong.pdf');
    expect(replaced.version.versionNo).toBe(2);
    expect((await withdraw(client, sent.document.id)).status).toBe(200);
  });

  it('puts an accepted line back to accepted when the stray file is withdrawn', async () => {
    const client = await loginAs(fx, 'client1a');
    const advisor = await loginAs(fx, 'provider1');
    const first = await submitVersion(fx.client1a.request, { kind: 'client', id: fx.client1a.id });
    await request(app).post(`/api/requests/${fx.client1a.request}/accept`).set('Cookie', advisor).send({ versionId: first.version.id });

    const stray = await anotherAttachment(fx.client1a.request);
    expect((await requestRow(fx.client1a.request)).status).toBe('submitted');

    expect((await withdraw(client, stray.document.id)).status).toBe(200);
    expect((await requestRow(fx.client1a.request)).status).toBe('accepted');
  });

  it('hands the line back to the advisor when they un-archive a withdrawn file', async () => {
    const client = await loginAs(fx, 'client1a');
    const advisor = await loginAs(fx, 'provider1');
    const sent = await submitVersion(fx.client1a.request, { kind: 'client', id: fx.client1a.id });
    await withdraw(client, sent.document.id);
    expect((await requestRow(fx.client1a.request)).status).toBe('requested');

    const back = await request(app).post(`/api/documents/${sent.document.id}/unarchive`).set('Cookie', advisor);
    expect(back.status).toBe(200);
    expect((await requestRow(fx.client1a.request)).status).toBe('submitted');
  });

  it('is the client’s own verb, for checklist files only', async () => {
    const client = await loginAs(fx, 'client1a');
    const advisor = await loginAs(fx, 'provider1');
    const other = await loginAs(fx, 'client1b');
    const sent = await submitVersion(fx.client1a.request, { kind: 'client', id: fx.client1a.id });

    expect((await withdraw(advisor, sent.document.id)).status).toBe(403);
    expect((await withdraw(other, sent.document.id)).status).toBe(404);

    // An ad-hoc upload is not on the checklist, so there is no line to take it off.
    const adHoc = await withdraw(client, fx.client1a.upload);
    expect(adHoc.status).toBe(400);
    expect(adHoc.body.code).toBe('not_withdrawable');
  });
});

describe('a newer version resets acceptance', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('sends an accepted request back to submitted and keeps the old review', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const id = fx.client1a.request;

    const first = await submitVersion(id, { kind: 'client', id: fx.client1a.id }, 'v1.pdf');
    await request(app).post(`/api/requests/${id}/accept`).set('Cookie', advisor).send({ versionId: first.version.id });
    expect((await requestRow(id)).status).toBe('accepted');

    const second = await submitVersion(id, { kind: 'client', id: fx.client1a.id }, 'v2.pdf');

    // The advisor accepted v1. They have not accepted v2.
    expect(second.reopenedRequest).toBe(true);
    expect((await requestRow(id)).status).toBe('submitted');

    // The record of what they decided about v1 is untouched.
    const reviews = await db.select().from(schema.reviews).where(eq(schema.reviews.documentId, id));
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ decision: 'accepted', versionId: first.version.id });

    // Exactly one live version, and it is the new one.
    const versions = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, id));
    expect(versions).toHaveLength(2);
    expect(versions.find((v) => v.id === first.version.id)!.supersededAt).not.toBeNull();
    expect(versions.find((v) => v.id === second.version.id)!.supersededAt).toBeNull();

    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
    expect(doc.currentVersionId).toBe(second.version.id);
  });

  it('leaves a waived request alone — a late upload does not reopen a closed decision', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const id = fx.client1a.request;

    await request(app).post(`/api/requests/${id}/waive`).set('Cookie', advisor).send({ reason: 'not applicable' });
    const result = await submitVersion(id, { kind: 'client', id: fx.client1a.id });

    expect(result.reopenedRequest).toBe(false);
    expect((await requestRow(id)).status).toBe('waived');
  });

  it('does not publish or supersede anything when the version is not clean', async () => {
    const id = fx.client1a.upload;
    const [document] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
    const before = document.currentVersionId;

    const result = await recordNewVersion({
      document,
      originalFilename: 'suspect.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      sha256: 'a'.repeat(64),
      storageKey: newStorageKey(new Date(), 'pdf'),
      uploadedByKind: 'client',
      uploadedById: fx.client1a.id,
      scanStatus: 'pending',
    });

    expect(result.version.publishedAt).toBeNull();
    const [after] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
    // The document still serves the version that was actually checked.
    expect(after.currentVersionId).toBe(before);
  });
});

describe('deliverable sharing', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('is invisible to the client until it is shared, and 404 rather than 403', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const client = await loginAs(fx, 'client1a');
    const id = fx.client1a.deliverable;

    // Seeded as shared (that is how the import leaves them).
    expect((await request(app).get(`/api/documents/${id}`).set('Cookie', client)).status).toBe(200);

    const unshared = await request(app).post(`/api/documents/${id}/unshare`).set('Cookie', advisor);
    expect(unshared.status).toBe(200);
    expect(unshared.body.shared).toBe(false);

    // 404, not 403: the client is not told a document exists that they may not see.
    const hidden = await request(app).get(`/api/documents/${id}`).set('Cookie', client);
    expect(hidden.status).toBe(404);

    const versions = await request(app).get(`/api/documents/${id}/versions`).set('Cookie', client);
    expect(versions.status).toBe(404);

    const download = await request(app).get(`/api/documents/${id}/download`).set('Cookie', client);
    expect(download.status).toBe(404);

    // It is gone from the list too, not merely from the detail route.
    const list = await request(app).get('/api/documents').set('Cookie', client);
    expect((list.body as Array<{ id: string }>).map((d) => d.id)).not.toContain(id);

    // And from the engagement tree.
    const tree = await request(app).get(`/api/engagements/${fx.client1a.engagement}`).set('Cookie', client);
    expect((tree.body.documents as Array<{ id: string }>).map((d) => d.id)).not.toContain(id);

    // The advisor still sees it the whole time.
    expect((await request(app).get(`/api/documents/${id}`).set('Cookie', advisor)).status).toBe(200);

    // Sharing it again brings it back.
    await request(app).post(`/api/documents/${id}/share`).set('Cookie', advisor);
    expect((await request(app).get(`/api/documents/${id}`).set('Cookie', client)).status).toBe(200);
  });

  it('refuses to share a deliverable with no file, and refuses to share a client upload', async () => {
    const advisor = await loginAs(fx, 'provider1');

    const empty = await request(app)
      .post('/api/documents')
      .set('Cookie', advisor)
      .send({ clientId: fx.client1a.id, name: 'Draft return.pdf', category: 'Reports' });
    expect(empty.status).toBe(201);
    // C5.4: an advisor's own file is material they are sending. The old rule read
    // the folder name, so renaming a drawer changed what a document was.
    expect(empty.body.kind).toBe('deliverable');

    const noFile = await request(app).post(`/api/documents/${empty.body.id}/share`).set('Cookie', advisor);
    expect(noFile.status).toBe(400);
    expect(noFile.body.code).toBe('no_file');

    const notDeliverable = await request(app).post(`/api/documents/${fx.client1a.upload}/share`).set('Cookie', advisor);
    expect(notDeliverable.status).toBe(400);
    expect(notDeliverable.body.code).toBe('not_a_deliverable');
  });

  it('will not let an advisor review their own deliverable', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const res = await request(app).post(`/api/documents/${fx.client1a.deliverable}/accept`).set('Cookie', advisor).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('not_reviewable');
  });
});

describe('archiving replaces deletion', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('keeps the row and its versions, and takes it out of the lists', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const id = fx.client1a.upload;

    const deleted = await request(app).delete(`/api/documents/${id}`).set('Cookie', advisor);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ ok: true, archived: true });

    // Nothing was destroyed.
    const [row] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
    expect(row).toBeDefined();
    expect(row.archivedAt).not.toBeNull();
    const versions = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, id));
    expect(versions).toHaveLength(1);

    // Out of the default list, back with includeArchived.
    const list = await request(app).get('/api/documents').set('Cookie', advisor);
    expect((list.body as Array<{ id: string }>).map((d) => d.id)).not.toContain(id);
    const withArchived = await request(app).get('/api/documents?includeArchived=true').set('Cookie', advisor);
    expect((withArchived.body as Array<{ id: string }>).map((d) => d.id)).toContain(id);
  });
});

describe('engagements and templates', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('builds a checklist from a starter template', async () => {
    const advisor = await loginAs(fx, 'provider1');

    const templates = await request(app).get('/api/templates').set('Cookie', advisor);
    const individual = (templates.body as Array<{ id: string; kind: string; items: unknown[] }>).find((t) => t.kind === 'individual_tax')!;
    expect(individual.items).toHaveLength(10);

    const created = await request(app)
      .post(`/api/engagements/${fx.client1a.engagement}/requests`)
      .set('Cookie', advisor)
      .send({ templateId: individual.id });

    expect(created.status).toBe(201);
    expect(created.body).toHaveLength(10);
    expect((created.body as Array<{ status: string }>).every((r) => r.status === 'requested')).toBe(true);
    // Appended after the line that was already there.
    expect((created.body as Array<{ sortOrder: number }>).map((r) => r.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const tree = await request(app).get(`/api/engagements/${fx.client1a.engagement}`).set('Cookie', advisor);
    expect(tree.body.requests).toHaveLength(11);
  });

  it('seeds the starters once and never argues with an advisor who cleared them', async () => {
    const advisor = await loginAs(fx, 'provider1');

    const first = await request(app).get('/api/templates').set('Cookie', advisor);
    expect(first.body).toHaveLength(2);

    // Archive both, then read again: nothing comes back.
    for (const t of first.body as Array<{ id: string }>) {
      await request(app).delete(`/api/templates/${t.id}`).set('Cookie', advisor);
    }
    const second = await request(app).get('/api/templates').set('Cookie', advisor);
    expect(second.body).toEqual([]);
  });

  it('refuses to add requests to a closed engagement', async () => {
    const advisor = await loginAs(fx, 'provider1');
    await request(app).post(`/api/engagements/${fx.client1a.engagement}/close`).set('Cookie', advisor);

    const res = await request(app)
      .post(`/api/engagements/${fx.client1a.engagement}/requests`)
      .set('Cookie', advisor)
      .send({ items: [{ title: 'Late addition' }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('engagement_closed');
  });

  it('answers the engagement list with the checklist counts behind each progress bar', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const engagementId = fx.client1a.engagement;

    // The fixture's engagement has one request, already answered by an upload.
    const before = await request(app).get(`/api/engagements?clientId=${fx.client1a.id}`).set('Cookie', advisor);
    expect(before.status).toBe(200);
    const start = (before.body as Array<{ id: string; requestCounts: Record<string, number> }>).find((e) => e.id === engagementId)!;
    expect(start.requestCounts.total).toBe(1);

    // Two more lines: one plain, one already a day late.
    const added = await request(app)
      .post(`/api/engagements/${engagementId}/requests`)
      .set('Cookie', advisor)
      .send({
        items: [{ title: 'Counted item' }, { title: 'Late item' }],
        dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      });
    expect(added.status).toBe(201);

    // The seeded line is still outstanding; answer it, then accept the answer.
    const answer = await submitVersion(fx.client1a.request, { kind: 'client', id: fx.client1a.id });
    const accepted = await request(app)
      .post(`/api/requests/${fx.client1a.request}/accept`)
      .set('Cookie', advisor)
      .send({ versionId: answer.version.id });
    expect(accepted.status).toBe(200);

    const after = await request(app).get(`/api/engagements?clientId=${fx.client1a.id}`).set('Cookie', advisor);
    const counts = (after.body as Array<{ id: string; requestCounts: Record<string, number> }>).find((e) => e.id === engagementId)!.requestCounts;

    expect(counts.total).toBe(3);
    expect(counts.accepted).toBe(1);
    expect(counts.outstanding).toBe(2);
    // Overdue is a slice of outstanding, not a bucket beside it.
    expect(counts.overdue).toBe(2);
    expect(counts.submitted).toBe(0);
    expect(counts.waived).toBe(0);
  });

  it('counts nothing for an engagement with no checklist, rather than omitting the field', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const created = await request(app)
      .post('/api/engagements')
      .set('Cookie', advisor)
      .send({ clientId: fx.client1a.id, title: 'Empty engagement' });
    expect(created.status).toBe(201);

    const list = await request(app).get(`/api/engagements?clientId=${fx.client1a.id}`).set('Cookie', advisor);
    const row = (list.body as Array<{ id: string; requestCounts: Record<string, number> }>).find((e) => e.id === created.body.id)!;
    expect(row.requestCounts).toEqual({ total: 0, outstanding: 0, submitted: 0, accepted: 0, waived: 0, overdue: 0 });
  });

  it('will not attach a document to another client’s engagement', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const res = await request(app)
      .patch(`/api/documents/${fx.client1a.upload}`)
      .set('Cookie', advisor)
      .send({ engagementId: fx.client1b.engagement });
    expect(res.status).toBe(404);
  });
});

/* 2026-10-28 audit: every `update` row's "View" went to /documents/<request id>. */
describe('the activity feed links where the work is', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('sends a checklist decision to its engagement and a message to the client', async () => {
    const advisor = await loginAs(fx, 'provider1');
    await request(app).post(`/api/requests/${fx.client1a.request}/waive`).set('Cookie', advisor).send({ reason: 'Not needed' });
    await request(app).post('/api/messages').set('Cookie', advisor).send({ clientId: fx.client1a.id, content: 'Hello' });

    const feed = await request(app).get('/api/activities').set('Cookie', advisor);
    expect(feed.status).toBe(200);
    const waived = feed.body.find((a: { description: string }) => a.description.startsWith('waived:'));
    expect(waived.link).toBe(`/engagements/${fx.client1a.engagement}`);
    const message = feed.body.find((a: { type: string; actorKind: string }) => a.type === 'message' && a.actorKind === 'provider');
    expect(message.link).toBe(`/clients/${fx.client1a.id}`);

    // A client's own feed carries no advisor routes.
    const mine = await request(app).get('/api/activities').set('Cookie', await loginAs(fx, 'client1a'));
    expect(mine.body.every((a: { link: string | null }) => a.link === null)).toBe(true);
  });
});

describe('the advisor dashboard counts live rows', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('hands every queue row the engagement it belongs to', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const res = await request(app).get('/api/dashboard').set('Cookie', advisor);
    expect(res.status).toBe(200);

    // Without this the home queue can only offer "here is a client", which is
    // one click short of the checklist line that actually needs doing.
    const waiting = res.body.waitingOnClients.items as Array<{ id: string; engagementId: string }>;
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting.every((r) => typeof r.engagementId === 'string' && r.engagementId.length > 0)).toBe(true);
    expect(waiting.find((r) => r.id === fx.client1a.request)?.engagementId).toBe(fx.client1a.engagement);
  });

  /* 2026-10-28 audit: rows said only title + client, and a closed year's
     leftovers sat in "waiting" forever. */
  it('says enough to read a row without opening it, and leaves closed engagements out', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const answer = await submitVersion(fx.client1a.request, { kind: 'client', id: fx.client1a.id });

    const res = await request(app).get('/api/dashboard').set('Cookie', advisor);
    const [ready] = res.body.readyToReview.items;
    expect(ready).toMatchObject({ id: fx.client1a.request, status: 'submitted', documentId: answer.document.id });
    expect(typeof ready.engagementTitle).toBe('string');
    expect(Number.isNaN(Date.parse(ready.since))).toBe(false);

    await request(app).post(`/api/engagements/${fx.client1b.engagement}/close`).set('Cookie', advisor);
    const after = await request(app).get('/api/dashboard').set('Cookie', advisor);
    expect(after.body.waitingOnClients.items.map((r: { clientId: string }) => r.clientId)).not.toContain(fx.client1b.id);
  });

  it('moves a request between buckets as it is worked', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const id = fx.client1a.request;

    const start = await request(app).get('/api/dashboard').set('Cookie', advisor);
    expect(start.body.waitingOnClients.count).toBe(2); // one per client of provider1
    expect(start.body.readyToReview.count).toBe(0);

    const answer = await submitVersion(id, { kind: 'client', id: fx.client1a.id });
    const submitted = await request(app).get('/api/dashboard').set('Cookie', advisor);
    expect(submitted.body.readyToReview.count).toBe(1);
    expect(submitted.body.readyToReview.ids).toContain(id);
    expect(submitted.body.waitingOnClients.count).toBe(1);

    await request(app).post(`/api/requests/${id}/accept`).set('Cookie', advisor).send({ versionId: answer.version.id });
    const accepted = await request(app).get('/api/dashboard').set('Cookie', advisor);
    expect(accepted.body.readyToReview.count).toBe(0);
    expect(accepted.body.waitingOnClients.count).toBe(1);
  });

  it('counts an overdue request in both waiting and overdue', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const yesterday = new Date(Date.now() - 86_400_000);
    await db.update(schema.requests).set({ dueDate: yesterday }).where(eq(schema.requests.id, fx.client1a.request));

    const res = await request(app).get('/api/dashboard').set('Cookie', advisor);
    expect(res.body.overdue.count).toBe(1);
    expect(res.body.overdue.ids).toContain(fx.client1a.request);
    // Overdue is a slice of waiting, not a separate state.
    expect(res.body.waitingOnClients.ids).toContain(fx.client1a.request);

    const one = await request(app).get(`/api/requests/${fx.client1a.request}`).set('Cookie', advisor);
    expect(one.body.overdue).toBe(true);
  });

  it('stops counting a request as overdue once it has been answered', async () => {
    const advisor = await loginAs(fx, 'provider1');
    await db.update(schema.requests).set({ dueDate: new Date(Date.now() - 86_400_000) }).where(eq(schema.requests.id, fx.client1a.request));
    await submitVersion(fx.client1a.request, { kind: 'client', id: fx.client1a.id });

    const res = await request(app).get('/api/dashboard').set('Cookie', advisor);
    expect(res.body.overdue.count).toBe(0);
    expect(res.body.readyToReview.count).toBe(1);
  });
});

describe('search', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('finds documents and requests, scoped to the caller', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const client = await loginAs(fx, 'client1a');

    const asAdvisor = await request(app).get('/api/search?q=Bank').set('Cookie', advisor);
    // Both of provider1's clients have a bank statement; provider2's does not appear.
    expect(asAdvisor.body.documents.length).toBe(2);

    const asClient = await request(app).get('/api/search?q=Bank').set('Cookie', client);
    expect(asClient.body.documents.length).toBe(1);
    expect(asClient.body.documents[0].clientId).toBe(fx.client1a.id);

    // A clientId param cannot widen a client's search.
    const attempt = await request(app).get(`/api/search?q=Bank&clientId=${fx.client1b.id}`).set('Cookie', client);
    expect(attempt.body.documents.every((d: { clientId: string }) => d.clientId === fx.client1a.id)).toBe(true);
  });

  it('treats wildcards as text rather than as a pattern', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const res = await request(app).get('/api/search?q=%25').set('Cookie', advisor);
    // A bare "%" must not match every document in the firm.
    expect(res.body.documents).toEqual([]);
  });

  it('returns nothing for an empty query rather than the whole file', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const res = await request(app).get('/api/search?q=').set('Cookie', advisor);
    expect(res.body).toMatchObject({ documents: [], requests: [] });
  });

  it('filters by the engagement year', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const hit = await request(app).get('/api/search?q=Bank&year=2026').set('Cookie', advisor);
    expect(hit.body.documents.length).toBe(2);
    const miss = await request(app).get('/api/search?q=Bank&year=1999').set('Cookie', advisor);
    expect(miss.body.documents).toEqual([]);
  });
});
