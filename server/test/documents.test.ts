import { beforeEach, describe, expect, it } from 'vitest';
import type { Test } from 'supertest';
import { PDF_BYTES, app, binaryParser, loginAs, request, seedFixture, type Fixture } from './helpers.js';

const attachPdf = (t: Test) =>
  t.attach('file', PDF_BYTES, { filename: 'again.pdf', contentType: 'application/pdf' });

/**
 * The same PDF with one more line in it — a *replacement*, which is what these
 * tests are about. Re-sending byte-identical content is a different case
 * entirely: H3 answers it 200 `unchanged` rather than recording a second
 * version of a file nobody changed (hardening.test.ts covers that one).
 */
const REVISED_PDF = Buffer.concat([PDF_BYTES, Buffer.from('\n% revised\n')]);
const attachRevisedPdf = (t: Test) =>
  t.attach('file', REVISED_PDF, { filename: 'again.pdf', contentType: 'application/pdf' });

describe('documents', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('answers 404, not 500, for a malformed id', async () => {
    const cookie = await loginAs(fx, 'provider1');
    for (const path of ['/api/documents/not-a-uuid', '/api/documents/not-a-uuid/download']) {
      const res = await request(app).get(path).set('Cookie', cookie);
      expect(res.status, path).toBe(404);
    }
    const patch = await request(app)
      .patch('/api/documents/not-a-uuid')
      .set('Cookie', cookie)
      .send({ status: 'reviewed' });
    expect(patch.status).toBe(404);
    const del = await request(app).delete('/api/documents/not-a-uuid').set('Cookie', cookie);
    expect(del.status).toBe(404);
  });

  it('serializes hasFile instead of storagePath', async () => {
    const cookie = await loginAs(fx, 'client1a');
    const res = await request(app).get('/api/documents').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const byId = new Map((res.body as { id: string; hasFile: boolean }[]).map((d) => [d.id, d]));
    expect(byId.get(fx.client1a.upload)!.hasFile).toBe(true);
    expect(byId.get(fx.client1a.request)!.hasFile).toBe(false);
    expect(byId.get(fx.client1a.deliverable)!.hasFile).toBe(true);
    for (const d of res.body) expect(d).not.toHaveProperty('storagePath');
  });

  it('lets a client re-upload their own file but never advisor material', async () => {
    const cookie = await loginAs(fx, 'client1a');

    // C5.4 removed POST /documents/:id/file; a new version is how bytes arrive.
    const own = await attachRevisedPdf(
      request(app).post(`/api/documents/${fx.client1a.upload}/versions`).set('Cookie', cookie)
    );
    // 202 = stored and being checked. The document keeps serving the version that
    // WAS checked, so it still has a readable file — the new one is not current yet.
    expect(own.status).toBe(202);
    expect(own.body.document.hasFile).toBe(true);
    expect(own.body.version.versionNo).toBe(2);

    const theirs = await attachPdf(
      request(app).post(`/api/documents/${fx.client1a.deliverable}/versions`).set('Cookie', cookie)
    );
    expect(theirs.status).toBe(403);

    // The deliverable's bytes are untouched.
    const dl = await request(app)
      .get(`/api/documents/${fx.client1a.deliverable}/download`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse(binaryParser);
    expect(dl.status).toBe(200);
    expect(Buffer.from(dl.body as Buffer).equals(PDF_BYTES)).toBe(true);
  });

  it('keeps the advisor review loop working and closed to clients', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const url = `/api/documents/${fx.client1a.upload}`;

    // C3.4: the legacy door into the review columns is closed. A decision is an
    // action with a note and an audit line, never a quiet PATCH of a column.
    const legacy = await request(app).patch(url).set('Cookie', advisor).send({ status: 'reviewed' });
    expect(legacy.status).toBe(400);
    expect(legacy.body.code).toBe('use_review_actions');

    const accepted = await request(app).post(`${url}/accept`).set('Cookie', advisor).send({ versionId: fx.client1a.uploadVersion });
    expect(accepted.status).toBe(200);
    // C5.4 dropped the legacy `status` column the decision used to mirror; the
    // decision itself is the record, and it is read from /reviews.
    expect(accepted.body).not.toHaveProperty('status');

    const correction = await request(app)
      .post(`${url}/request-correction`)
      .set('Cookie', advisor)
      .send({ versionId: fx.client1a.uploadVersion, note: 'Need the full statement' });
    expect(correction.status).toBe(200);

    const history = await request(app).get(`${url}/reviews`).set('Cookie', advisor);
    expect(history.status).toBe(200);
    expect(history.body.map((r: { decision: string }) => r.decision)).toEqual(['needs_correction', 'accepted']);

    // Filing still patches, and only filing.
    const filed = await request(app).patch(url).set('Cookie', advisor).send({ displayName: 'Bank statement (full year)' });
    expect(filed.status).toBe(200);
    expect(filed.body.displayName).toBe('Bank statement (full year)');

    // The client decides nothing...
    const client = await loginAs(fx, 'client1a');
    const clientDecision = await request(app).post(`${url}/accept`).set('Cookie', client).send({});
    expect(clientDecision.status).toBe(403);
    const clientFiling = await request(app).patch(url).set('Cookie', client).send({ displayName: 'mine now' });
    expect(clientFiling.status).toBe(403);

    // ...but re-uploading is theirs to do. C5.4 removed POST /documents/:id/file;
    // a new version is the only way bytes arrive, and it supersedes the last one.
    const again = await attachRevisedPdf(request(app).post(`${url}/versions`).set('Cookie', client));
    expect(again.status).toBe(202);
    expect(again.body.version.versionNo).toBe(2);
    expect(again.body.document).not.toHaveProperty('hasUpdateRequest');
  });

  it("gives a provider the same answer for a foreign client and a missing one", async () => {
    const cookie = await loginAs(fx, 'provider2');
    const foreign = await request(app)
      .post('/api/documents')
      .set('Cookie', cookie)
      .send({ clientId: fx.client1a.id, name: 'x.pdf' });
    const missing = await request(app)
      .post('/api/documents')
      .set('Cookie', cookie)
      .send({ clientId: '00000000-0000-4000-8000-000000000000', name: 'x.pdf' });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });
});
