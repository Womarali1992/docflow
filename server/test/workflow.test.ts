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
import { db, schema } from '../src/db/client.js';
import { recordNewVersion } from '../src/workflow/versions.js';
import { ensureKeyDir, newStorageKey } from '../src/files/store.js';
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
    await submitVersion(documentId, { kind: 'client', id: fx.client1a.id }, 'policy.pdf');
    expect((await requestRow(requestId)).status).toBe('submitted');

    // 2. The advisor sends it back, and has to say why.
    const bare = await request(app).post(`/api/requests/${requestId}/request-correction`).set('Cookie', advisor).send({});
    expect(bare.status).toBe(400);
    expect(bare.body.code).toBe('note_required');

    const correction = await request(app)
      .post(`/api/requests/${requestId}/request-correction`)
      .set('Cookie', advisor)
      .send({ note: 'This is last year’s policy — please send the current one.' });
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
    await submitVersion(id, { kind: 'client', id: fx.client1a.id });
    await request(app).post(`/api/requests/${id}/accept`).set('Cookie', advisor).send({});
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
      .send({ clientId: fx.client1a.id, name: 'Draft return.pdf', folder: 'Reports' });
    expect(empty.status).toBe(201);
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

  it('will not attach a document to another client’s engagement', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const res = await request(app)
      .patch(`/api/documents/${fx.client1a.upload}`)
      .set('Cookie', advisor)
      .send({ engagementId: fx.client1b.engagement });
    expect(res.status).toBe(404);
  });
});

describe('the advisor dashboard counts live rows', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('moves a request between buckets as it is worked', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const id = fx.client1a.request;

    const start = await request(app).get('/api/dashboard').set('Cookie', advisor);
    expect(start.body.waitingOnClients.count).toBe(2); // one per client of provider1
    expect(start.body.readyToReview.count).toBe(0);

    await submitVersion(id, { kind: 'client', id: fx.client1a.id });
    const submitted = await request(app).get('/api/dashboard').set('Cookie', advisor);
    expect(submitted.body.readyToReview.count).toBe(1);
    expect(submitted.body.readyToReview.ids).toContain(id);
    expect(submitted.body.waitingOnClients.count).toBe(1);

    await request(app).post(`/api/requests/${id}/accept`).set('Cookie', advisor).send({});
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
