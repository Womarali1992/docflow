/**
 * The season-end export (H8).
 *
 * The archive is a claim about the engagement: *this* is what was accepted,
 * *this* is what we sent back, and here is a sheet tying each file to the
 * decision that put it there. Everything below is about that claim being true —
 * that nothing unaccepted sneaks in, that an unshared draft stays the firm's
 * own, that a file which could not be included says so rather than going
 * quietly missing, and that the bytes come through the same guard a download
 * does.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { manifestCsv, planExport, safeName } from '../src/workflow/export.js';
import { newStorageKey, ensureKeyDir } from '../src/files/store.js';
import { app, loginAs, request, seedFixture, type Fixture } from './helpers.js';

const PDF = Buffer.from('%PDF-1.4 exported bytes\n');

/**
 * An engagement whose entire contents this file put there.
 *
 * The seeded fixture's engagement already holds a shared deliverable, which is
 * correct for every other suite and useless here: half of these tests are about
 * exact counts and about an engagement with nothing exportable in it.
 */
async function freshEngagement(fx: Fixture) {
  const [row] = await db
    .insert(schema.engagements)
    .values({
      firmId: fx.provider1.firmId,
      clientId: fx.client1a.id,
      title: '2026 Individual Tax Return',
      kind: 'individual_tax',
    })
    .returning();
  return row;
}

/** An accepted checklist line with one attachment, ready to be exported. */
async function acceptedRequest(
  fx: Fixture,
  engagementId: string,
  opts: { title: string; category?: string | null; scanStatus?: 'clean' | 'pending' | 'infected'; withBytes?: boolean }
) {
  const [request_] = await db
    .insert(schema.requests)
    .values({
      firmId: fx.provider1.firmId,
      clientId: fx.client1a.id,
      engagementId,
      title: opts.title,
      category: opts.category ?? 'Income',
      status: 'accepted',
    })
    .returning();

  const [doc] = await db
    .insert(schema.documents)
    .values({
      firmId: fx.provider1.firmId,
      clientId: fx.client1a.id,
      engagementId,
      requestId: request_.id,
      name: `${opts.title}.pdf`,
      kind: 'client_upload',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
    })
    .returning();

  const storageKey = newStorageKey(new Date(), 'pdf');
  if (opts.withBytes !== false) fs.writeFileSync(ensureKeyDir(storageKey), PDF);
  const scanStatus = opts.scanStatus ?? 'clean';
  const [version] = await db
    .insert(schema.documentVersions)
    .values({
      documentId: doc.id,
      versionNo: 1,
      originalFilename: `${opts.title}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      sha256: createHash('sha256').update(PDF).digest('hex'),
      storageKey,
      scanStatus,
      uploadedByKind: 'client',
      uploadedById: fx.client1a.id,
      publishedAt: scanStatus === 'clean' ? new Date() : null,
    })
    .returning();
  await db.update(schema.documents).set({ currentVersionId: version.id }).where(eq(schema.documents.id, doc.id));

  const [review] = await db
    .insert(schema.reviews)
    .values({
      documentId: doc.id,
      versionId: version.id,
      requestId: request_.id,
      reviewerId: fx.provider1.id,
      decision: 'accepted',
    })
    .returning();

  return { request: request_, document: doc, version, review, storageKey };
}

/** A deliverable the firm produced, shared or not. */
async function deliverable(fx: Fixture, engagementId: string, name: string, shared: boolean) {
  const [doc] = await db
    .insert(schema.documents)
    .values({
      firmId: fx.provider1.firmId,
      clientId: fx.client1a.id,
      engagementId,
      name,
      kind: 'deliverable',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      sharedAt: shared ? new Date() : null,
    })
    .returning();
  const storageKey = newStorageKey(new Date(), 'pdf');
  fs.writeFileSync(ensureKeyDir(storageKey), PDF);
  const [version] = await db
    .insert(schema.documentVersions)
    .values({
      documentId: doc.id,
      versionNo: 1,
      originalFilename: name,
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      sha256: createHash('sha256').update(PDF).digest('hex'),
      storageKey,
      scanStatus: 'clean',
      uploadedByKind: 'provider',
      uploadedById: fx.provider1.id,
      publishedAt: new Date(),
    })
    .returning();
  await db.update(schema.documents).set({ currentVersionId: version.id }).where(eq(schema.documents.id, doc.id));
  return { document: doc, version };
}

describe('what the archive contains', () => {
  let fx: Fixture;
  let engagement: Awaited<ReturnType<typeof freshEngagement>>;

  beforeEach(async () => {
    fx = await seedFixture();
    engagement = await freshEngagement(fx);
  });

  it('takes accepted requests and shared deliverables, and nothing else', async () => {
    await acceptedRequest(fx, engagement.id, { title: 'W-2' });
    await deliverable(fx, engagement.id, 'Return.pdf', true);
    await deliverable(fx, engagement.id, 'Draft.pdf', false);

    // A line the advisor has not accepted is not part of the record yet.
    await db
      .insert(schema.requests)
      .values({
        firmId: fx.provider1.firmId,
        clientId: fx.client1a.id,
        engagementId: engagement.id,
        title: 'Still waiting',
        status: 'submitted',
      });

    const plan = await planExport(engagement);
    const names = plan.entries.map((e) => e.path);
    expect(names).toContain('Income/W-2 — v1.pdf');
    // A deliverable is named after the document, whose name is already a
    // filename — so the extension is not repeated as part of the stem.
    expect(names).toContain('Deliverables/Return — v1.pdf');
    // The unshared draft is the firm's working copy, not the client's record.
    expect(plan.entries.some((e) => e.requestTitle === 'Draft.pdf')).toBe(false);
    expect(plan.entries.some((e) => e.requestTitle === 'Still waiting')).toBe(false);
    expect(plan.included).toBe(2);
    expect(plan.omitted).toBe(0);
  });

  it('carries every attachment of a line, not just the first', async () => {
    // H5 made a checklist line hold several files. An export that took only the
    // current document would silently drop five of six receipts.
    const first = await acceptedRequest(fx, engagement.id, { title: 'Receipts', category: 'Expenses' });
    const [second] = await db
      .insert(schema.documents)
      .values({
        firmId: fx.provider1.firmId,
        clientId: fx.client1a.id,
        engagementId: engagement.id,
        requestId: first.request.id,
        name: 'Receipts.pdf',
        kind: 'client_upload',
        mimeType: 'application/pdf',
        sizeBytes: PDF.length,
      })
      .returning();
    const key = newStorageKey(new Date(), 'pdf');
    fs.writeFileSync(ensureKeyDir(key), PDF);
    const [v] = await db
      .insert(schema.documentVersions)
      .values({
        documentId: second.id,
        versionNo: 1,
        originalFilename: 'Receipts.pdf',
        mimeType: 'application/pdf',
        sizeBytes: PDF.length,
        sha256: createHash('sha256').update(PDF).digest('hex'),
        storageKey: key,
        scanStatus: 'clean',
        uploadedByKind: 'client',
        uploadedById: fx.client1a.id,
        publishedAt: new Date(),
      })
      .returning();
    await db.update(schema.documents).set({ currentVersionId: v.id }).where(eq(schema.documents.id, second.id));

    const plan = await planExport(engagement);
    const receipts = plan.entries.filter((e) => e.requestTitle === 'Receipts');
    expect(receipts).toHaveLength(2);
    // Two files from one line share a name, so the second is disambiguated
    // rather than overwriting the first inside the zip.
    expect(receipts.map((e) => e.path)).toEqual(['Expenses/Receipts — v1.pdf', 'Expenses/Receipts — v1 (2).pdf']);
  });

  it('lists a file it cannot include, with the reason, instead of dropping it', async () => {
    await acceptedRequest(fx, engagement.id, { title: 'Quarantined', scanStatus: 'infected', withBytes: false });
    await acceptedRequest(fx, engagement.id, { title: 'Still scanning', scanStatus: 'pending' });
    await acceptedRequest(fx, engagement.id, { title: 'Fine' });

    const plan = await planExport(engagement);
    expect(plan.included).toBe(1);
    expect(plan.omitted).toBe(2);

    const byTitle = new Map(plan.entries.map((e) => [e.requestTitle, e]));
    // The same guard /download applies — clean and published, or nothing.
    expect(byTitle.get('Quarantined')!.path).toBeNull();
    expect(byTitle.get('Quarantined')!.omitted).toMatch(/quarantined/i);
    expect(byTitle.get('Still scanning')!.path).toBeNull();
    expect(byTitle.get('Still scanning')!.omitted).toMatch(/still being checked/);
    // Silence would be the archive lying by absence, so both are in the sheet.
    expect(manifestCsv(plan.entries)).toMatch(/Quarantined/);
  });

  it('notices bytes that are on record but not on disk', async () => {
    const made = await acceptedRequest(fx, engagement.id, { title: 'Missing' });
    fs.unlinkSync(path.join(process.env.DATA_ROOT!, made.storageKey));

    const plan = await planExport(engagement);
    expect(plan.included).toBe(0);
    expect(plan.entries[0].omitted).toMatch(/missing/);
  });

  it('names each file after the line it answers, in a folder per category', async () => {
    await acceptedRequest(fx, engagement.id, { title: 'Nuñez: 1099-NEC / statements', category: 'Income' });
    const plan = await planExport(engagement);
    // Accents, digits and hyphens survive; only what a filesystem refuses goes.
    expect(plan.entries[0].path).toBe('Income/Nuñez 1099-NEC statements — v1.pdf');
  });

  it('records who accepted it and when, for every file', async () => {
    const made = await acceptedRequest(fx, engagement.id, { title: 'W-2' });
    const plan = await planExport(engagement);
    expect(plan.entries[0].acceptedAt).toBe(made.review.createdAt.toISOString());
    expect(plan.entries[0].reviewer).toBe('Provider One');
    expect(plan.entries[0].sha256).toBe(createHash('sha256').update(PDF).digest('hex'));
  });
});

describe('the manifest sheet', () => {
  it('opens in a spreadsheet: a BOM, CRLF rows, and quoted commas', () => {
    const csv = manifestCsv([
      {
        path: 'Income/W-2 — v1.pdf',
        absPath: null,
        requestTitle: 'W-2, all employers',
        category: 'Income',
        originalFilename: 'w2.pdf',
        versionNo: 1,
        sizeBytes: 24,
        sha256: 'a'.repeat(64),
        acceptedAt: '2026-04-01T10:00:00.000Z',
        reviewer: 'Provider One',
        kind: 'client_upload',
        omitted: null,
      },
    ]);
    // Without the BOM, Excel on Windows mangles the accents and the em dash.
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('\r\n');
    // A comma inside a title must not become a column break.
    expect(csv).toContain('"W-2, all employers"');
    expect(csv).toContain('yes');
  });

  it('quotes a field that carries a quote', () => {
    expect(manifestCsv([])).toContain('Request,Category,File');
    expect(safeName('a"b')).toBe('a b');
  });
});

describe('GET /engagements/:id/export', () => {
  let fx: Fixture;
  let engagement: Awaited<ReturnType<typeof freshEngagement>>;

  beforeEach(async () => {
    fx = await seedFixture();
    engagement = await freshEngagement(fx);
  });

  it('streams a zip that carries the manifest and every included file', async () => {
    await acceptedRequest(fx, engagement.id, { title: 'W-2' });
    await deliverable(fx, engagement.id, 'Return.pdf', true);
    const cookie = await loginAs(fx, 'provider1');

    const res = await request(app)
      .get(`/api/engagements/${engagement.id}/export`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=/);
    expect(res.headers['cache-control']).toBe('no-store');

    /* Zip stores every entry's name uncompressed in its local header, so the
       structure is checkable without unzipping — and without a dependency
       whose only caller would be this assertion. The names are UTF-8 bytes
       (the em dash is three of them), so this compares buffers rather than
       decoding, which is also what proves the encoding is right. */
    const zip = res.body as Buffer;
    expect(zip.subarray(0, 2).toString('latin1')).toBe('PK');
    for (const name of ['manifest.csv', 'Income/W-2 — v1.pdf', 'Deliverables/Return — v1.pdf']) {
      expect(zip.includes(Buffer.from(name, 'utf8'))).toBe(true);
    }
  });

  it('records that a whole engagement left the system', async () => {
    await acceptedRequest(fx, engagement.id, { title: 'W-2' });
    const cookie = await loginAs(fx, 'provider1');
    await request(app).get(`/api/engagements/${engagement.id}/export`).set('Cookie', cookie).buffer(true).parse((r, cb) => {
      r.on('data', () => {});
      r.on('end', () => cb(null, Buffer.alloc(0)));
    });

    const [entry] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'engagement.exported'));
    expect(entry).toBeDefined();
    expect(entry.targetId).toBe(engagement.id);
    expect(entry.clientId).toBe(fx.client1a.id);
    expect(entry.actorId).toBe(fx.provider1.id);
    expect(entry.meta).toMatchObject({ included: 1, omitted: 0 });
  });

  it('refuses an engagement with nothing accepted, before it sets a single header', async () => {
    const cookie = await loginAs(fx, 'provider1');
    const res = await request(app).get(`/api/engagements/${engagement.id}/export`).set('Cookie', cookie);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('nothing_to_export');
    // The 409 has to be decidable before the stream opens: once bytes are out,
    // the only thing an error can do is truncate the archive.
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('says so when everything accepted is still being checked', async () => {
    await acceptedRequest(fx, engagement.id, { title: 'Still scanning', scanStatus: 'pending' });
    const cookie = await loginAs(fx, 'provider1');
    const res = await request(app).get(`/api/engagements/${engagement.id}/export`).set('Cookie', cookie);
    expect(res.status).toBe(409);
    // Different sentence from "nothing accepted": the advisor did accept these.
    expect(res.body.error).toMatch(/still being checked|quarantined/);
  });

  it('answers 404 for another advisor’s engagement', async () => {
    await acceptedRequest(fx, engagement.id, { title: 'W-2' });
    const cookie = await loginAs(fx, 'provider2');
    const res = await request(app).get(`/api/engagements/${engagement.id}/export`).set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});
