/**
 * Per-version delivery (C2.4).
 *
 * These are the routes that actually hand a client's tax documents to a browser,
 * so the tests are about exactly two things: **who gets bytes** and **what the
 * browser is told to do with them**.
 *
 * The headers are asserted literally rather than loosely, because each one is
 * load-bearing: `nosniff` stops a browser second-guessing the type, `sandbox`
 * stops an inline PDF doing anything, `no-store` keeps a client's return out of
 * a shared machine's disk cache, and `attachment` vs `inline` is the difference
 * between saving a file and running a renderer on it.
 */
import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { absPathForKey } from '../src/files/store.js';
import { FIXTURES } from './fixtures.js';
import { PDF_BYTES, app, binaryParser, loginAs, request, seedFixture, type Fixture } from './helpers.js';

const dl = (doc: string, v: string) => `/api/documents/${doc}/versions/${v}/download`;
const pv = (doc: string, v: string) => `/api/documents/${doc}/versions/${v}/preview`;

describe('downloading a version', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('sends the bytes as an attachment, with the headers a browser needs', async () => {
    const client = await loginAs(fx, 'client1a');
    const res = await request(app)
      .get(dl(fx.client1a.upload, fx.client1a.uploadVersion))
      .set('Cookie', client)
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-length']).toBe(String(PDF_BYTES.length));
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="1A Bank Statement\.pdf"/);
    expect(res.headers['content-disposition']).toMatch(/filename\*=UTF-8''1A%20Bank%20Statement\.pdf$/);
    expect(Buffer.from(res.body as Buffer).equals(PDF_BYTES)).toBe(true);
  });

  it('lets the advisor download their client’s submission', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const res = await request(app).get(dl(fx.client1a.upload, fx.client1a.uploadVersion)).set('Cookie', advisor);
    expect(res.status).toBe(200);
  });

  it('is 404 for another firm’s version and another client’s version', async () => {
    for (const actor of ['provider2', 'client1b', 'client2a'] as const) {
      const cookie = await loginAs(fx, actor);
      const res = await request(app).get(dl(fx.client1a.upload, fx.client1a.uploadVersion)).set('Cookie', cookie);
      expect(res.status, actor).toBe(404);
    }
  });

  it('is 401 for an anonymous caller', async () => {
    const res = await request(app).get(dl(fx.client1a.upload, fx.client1a.uploadVersion));
    expect(res.status).toBe(401);
  });

  it('is 404 for a version that belongs to a different document', async () => {
    const client = await loginAs(fx, 'client1a');
    // A real version id, but under the wrong document.
    const res = await request(app).get(dl(fx.client1a.upload, fx.client1a.deliverableVersion)).set('Cookie', client);
    expect(res.status).toBe(404);
  });

  it('is 404, not 403, for a deliverable the client cannot see yet', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const client = await loginAs(fx, 'client1a');

    await request(app).post(`/api/documents/${fx.client1a.deliverable}/unshare`).set('Cookie', advisor);

    const hidden = await request(app).get(dl(fx.client1a.deliverable, fx.client1a.deliverableVersion)).set('Cookie', client);
    expect(hidden.status).toBe(404);
    // The advisor can still fetch it the whole time.
    const theirs = await request(app).get(dl(fx.client1a.deliverable, fx.client1a.deliverableVersion)).set('Cookie', advisor);
    expect(theirs.status).toBe(200);
  });

  it('answers 404 when the row is fine but the bytes are gone', async () => {
    const client = await loginAs(fx, 'client1a');
    const [version] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, fx.client1a.uploadVersion));
    fs.rmSync(absPathForKey(version.storageKey));

    const res = await request(app).get(dl(fx.client1a.upload, fx.client1a.uploadVersion)).set('Cookie', client);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/missing/i);
  });
});

describe('a version that has not passed a scan', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('says it is still being checked rather than pretending it is missing', async () => {
    const client = await loginAs(fx, 'client1a');
    await db
      .update(schema.documentVersions)
      .set({ scanStatus: 'pending', publishedAt: null })
      .where(eq(schema.documentVersions.id, fx.client1a.uploadVersion));

    for (const url of [dl, pv]) {
      const res = await request(app).get(url(fx.client1a.upload, fx.client1a.uploadVersion)).set('Cookie', client);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('not_available_yet');
    }
  });

  it('says plainly when a file failed the virus check', async () => {
    const client = await loginAs(fx, 'client1a');
    await db
      .update(schema.documentVersions)
      .set({ scanStatus: 'infected', publishedAt: null })
      .where(eq(schema.documentVersions.id, fx.client1a.uploadVersion));

    const res = await request(app).get(dl(fx.client1a.upload, fx.client1a.uploadVersion)).set('Cookie', client);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('infected');
    expect(res.body.error).toMatch(/virus check/);
  });

  it('refuses a version the scanner errored on, even though the bytes are there', async () => {
    const client = await loginAs(fx, 'client1a');
    await db
      .update(schema.documentVersions)
      .set({ scanStatus: 'error', publishedAt: null })
      .where(eq(schema.documentVersions.id, fx.client1a.uploadVersion));

    const res = await request(app).get(dl(fx.client1a.upload, fx.client1a.uploadVersion)).set('Cookie', client);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('not_available_yet');
  });
});

describe('previewing a version', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('renders a PDF inline, sandboxed and uncached', async () => {
    const client = await loginAs(fx, 'client1a');
    const res = await request(app)
      .get(pv(fx.client1a.upload, fx.client1a.uploadVersion))
      .set('Cookie', client)
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^inline;/);
    expect(res.headers['content-security-policy']).toBe('sandbox');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.from(res.body as Buffer).equals(PDF_BYTES)).toBe(true);
  });

  it('refuses to render an Office file in the browser', async () => {
    const client = await loginAs(fx, 'client1a');

    // Put a real xlsx (a ZIP, as far as the bytes go) on the engagement.
    const up = await request(app)
      .post(`/api/engagements/${fx.client1a.engagement}/uploads`)
      .set('Cookie', client)
      .attach('file', Buffer.from(FIXTURES.xlsx.bytes), { filename: FIXTURES.xlsx.name });
    expect(up.status).toBe(202);

    // Publish it so delivery is reachable — the scan itself is C2.3's business.
    await db
      .update(schema.documentVersions)
      .set({ scanStatus: 'clean', publishedAt: new Date() })
      .where(eq(schema.documentVersions.id, up.body.version.id));
    await db
      .update(schema.documents)
      .set({ currentVersionId: up.body.version.id })
      .where(eq(schema.documents.id, up.body.document.id));

    const preview = await request(app).get(pv(up.body.document.id, up.body.version.id)).set('Cookie', client);
    expect(preview.status).toBe(415);
    expect(preview.body.code).toBe('not_previewable');

    // But downloading it is fine.
    const download = await request(app).get(dl(up.body.document.id, up.body.version.id)).set('Cookie', client);
    expect(download.status).toBe(200);
    expect(download.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('takes the content type from the bytes, not from the stored row', async () => {
    const client = await loginAs(fx, 'client1a');
    // A row that lies: the file on disk is a PDF, the row says it is a spreadsheet.
    await db
      .update(schema.documentVersions)
      .set({ mimeType: 'application/vnd.ms-excel' })
      .where(eq(schema.documentVersions.id, fx.client1a.uploadVersion));

    const res = await request(app).get(dl(fx.client1a.upload, fx.client1a.uploadVersion)).set('Cookie', client);
    expect(res.status).toBe(200);
    // The browser is told what the bytes actually are.
    expect(res.headers['content-type']).toBe('application/pdf');
  });
});

describe('every read is on the record', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('audits a download and a preview, naming the version but no content', async () => {
    const client = await loginAs(fx, 'client1a');

    await request(app).get(dl(fx.client1a.upload, fx.client1a.uploadVersion)).set('Cookie', client);
    await request(app).get(pv(fx.client1a.upload, fx.client1a.uploadVersion)).set('Cookie', client);

    const rows = await db.select().from(schema.auditLog);
    const downloaded = rows.filter((r) => r.action === 'document.downloaded');
    const previewed = rows.filter((r) => r.action === 'document.previewed');

    expect(downloaded).toHaveLength(1);
    expect(previewed).toHaveLength(1);
    expect(downloaded[0]).toMatchObject({ actorKind: 'client', actorId: fx.client1a.id, clientId: fx.client1a.id });
    expect(downloaded[0].targetId).toBe(fx.client1a.uploadVersion);
    expect(downloaded[0].meta).toMatchObject({ documentId: fx.client1a.upload, versionNo: 1 });
    // The log records that a file was read, never what was in it.
    expect(JSON.stringify(rows)).not.toMatch(/storageKey|sha256|%PDF/);
  });

  it('records nothing for a read that was refused', async () => {
    const intruder = await loginAs(fx, 'client2a');
    await request(app).get(dl(fx.client1a.upload, fx.client1a.uploadVersion)).set('Cookie', intruder);

    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'document.downloaded'));
    expect(rows).toEqual([]);
  });
});

describe('the legacy download still works', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('resolves the current version and keeps Document.url pointing at it', async () => {
    const client = await loginAs(fx, 'client1a');
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, fx.client1a.upload));

    const res = await request(app)
      .get(`/api/documents/${fx.client1a.upload}/download`)
      .set('Cookie', client)
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(Buffer.from(res.body as Buffer).equals(PDF_BYTES)).toBe(true);
    // The url column the current frontend follows is unchanged.
    expect(doc.url).toBe(`/api/documents/${fx.client1a.upload}/download`);
  });
});
