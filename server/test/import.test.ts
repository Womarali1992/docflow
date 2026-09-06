/**
 * The legacy → workflow-model import (C2.1) and the append-only audit log.
 *
 * This script rewrites every existing row on the firm's real database exactly
 * once, so the things worth pinning down are: it refuses to run without a fresh
 * way back, it keeps the ids people already have links to, the bytes it copies
 * are provably the same bytes, a missing file costs one document rather than
 * the whole run, and running it twice changes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { ImportError, importLegacy, itemsFromBins, readManifest } from '../src/db/migrate-legacy.js';
import { absPathForKey } from '../src/files/store.js';
import { PDF_BYTES, seedLegacyFixture, type Fixture } from './helpers.js';

const scratch = path.join(process.env.DATA_ROOT ?? '.', '..', '.import-tmp');

/** A backup manifest of the shape ops/windows/backup.ps1 writes. */
function writeManifest(ageMs = 0, name = 'manifest.json'): string {
  fs.mkdirSync(scratch, { recursive: true });
  const file = path.join(scratch, name);
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      createdAt: new Date(Date.now() - ageMs).toISOString(),
      host: 'TEST',
      database: 'docflow_test',
      dump: { file: 'db.dump', bytes: 1, sha256: 'x' },
      counts: {},
    })
  );
  return file;
}

async function countRows() {
  const [docs, reqs, versions, engagements, reviews, templates] = await Promise.all([
    db.select().from(schema.documents),
    db.select().from(schema.requests),
    db.select().from(schema.documentVersions),
    db.select().from(schema.engagements),
    db.select().from(schema.reviews),
    db.select().from(schema.requestTemplates),
  ]);
  return {
    documents: docs.length,
    requests: reqs.length,
    versions: versions.length,
    engagements: engagements.length,
    reviews: reviews.length,
    templates: templates.length,
  };
}

describe('backup manifest gate', () => {
  it('refuses to run without a manifest', () => {
    expect(() => readManifest('', new Date())).toThrow(ImportError);
    expect(() => readManifest('', new Date())).toThrow(/--backup-manifest is required/);
  });

  it('refuses a manifest that does not exist or is not a manifest', () => {
    expect(() => readManifest(path.join(scratch, 'nope.json'), new Date())).toThrow(/No manifest at/);
    fs.mkdirSync(scratch, { recursive: true });
    const junk = path.join(scratch, 'junk.json');
    fs.writeFileSync(junk, '{"hello":"world"}');
    expect(() => readManifest(junk, new Date())).toThrow(/no createdAt/);
  });

  it('refuses a manifest older than 24 hours', () => {
    const stale = writeManifest(25 * 60 * 60 * 1000, 'stale.json');
    expect(() => readManifest(stale, new Date())).toThrow(/25\.0 h old \(limit 24 h\)/);
  });

  it('refuses a manifest dated in the future, which means the clock is wrong', () => {
    const future = writeManifest(-60 * 60 * 1000, 'future.json');
    expect(() => readManifest(future, new Date())).toThrow(/future/);
  });

  it('accepts a fresh one', () => {
    const m = readManifest(writeManifest(60_000), new Date());
    expect(m.database).toBe('docflow_test');
    expect(m.ageMs).toBeGreaterThan(0);
  });

  it('will not import without one', async () => {
    await expect(importLegacy({ manifestPath: '' })).rejects.toThrow(/--backup-manifest is required/);
  });
});

describe('legacy import', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedLegacyFixture();
  });

  it('converts the seeded legacy database and reports what it did', async () => {
    const report = await importLegacy({ manifestPath: writeManifest(), trustLegacyFiles: true });

    // 3 clients × (one upload, one request, one deliverable); 6 of the 9 carry a file.
    expect(report.clientCount).toBe(3);
    expect(report.documentCount).toBe(9);
    expect(report.requestCount).toBe(3);
    expect(report.versionCount).toBe(6);
    expect(report.engagementsCreated).toBe(3);
    expect(report.presetsConverted).toBe(2);
    expect(report.missingFiles).toEqual([]);
    expect(report.duplicateEmails).toEqual([]);
    expect(report.bytesCopied).toBe(6 * PDF_BYTES.length);

    expect(await countRows()).toEqual({ documents: 9, requests: 3, versions: 6, engagements: 3, reviews: 0, templates: 2 });
  });

  it('gives every client exactly one imported engagement holding their documents', async () => {
    await importLegacy({ manifestPath: writeManifest(), trustLegacyFiles: true });

    const engagements = await db.select().from(schema.engagements).where(eq(schema.engagements.clientId, fx.client1a.id));
    expect(engagements).toHaveLength(1);
    expect(engagements[0]).toMatchObject({ kind: 'imported', title: 'Imported documents', status: 'open' });
    expect(engagements[0].providerId).toBe(fx.client1a.providerId);

    const docs = await db.select().from(schema.documents).where(eq(schema.documents.clientId, fx.client1a.id));
    expect(docs).toHaveLength(3);
    expect(docs.every((d) => d.engagementId === engagements[0].id)).toBe(true);
  });

  it('classifies documents by their legacy folder and shares deliverables that were already visible', async () => {
    await importLegacy({ manifestPath: writeManifest(), trustLegacyFiles: true });

    const [upload] = await db.select().from(schema.documents).where(eq(schema.documents.id, fx.client1a.upload));
    const [deliverable] = await db.select().from(schema.documents).where(eq(schema.documents.id, fx.client1a.deliverable));

    expect(upload.kind).toBe('client_upload');
    expect(upload.category).toBe('Uploads');
    expect(upload.displayName).toBe(upload.name);
    expect(upload.sharedAt).toBeNull();

    expect(deliverable.kind).toBe('deliverable');
    expect(deliverable.category).toBe('Reports');
    // It was visible to the client before the import, so it must stay visible.
    expect(deliverable.sharedAt).not.toBeNull();
    expect(deliverable.sharedById).toBe(fx.client1a.providerId);
  });

  it('keeps the legacy id, so a request answers on the id its document had', async () => {
    await importLegacy({ manifestPath: writeManifest(), trustLegacyFiles: true });

    const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, fx.client1a.request));
    expect(request).toBeDefined();
    expect(request.importedFromDocumentId).toBe(fx.client1a.request);
    expect(request.title).toBe(`1A Insurance Policy`);
    expect(request.instructions).toBe('seeded request');
    // No file was ever uploaded against it, so it is still outstanding.
    expect(request.status).toBe('requested');

    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, fx.client1a.request));
    expect(doc.requestId).toBe(request.id);
  });

  it('writes a version whose recorded sha256 is the sha256 of the bytes on disk', async () => {
    await importLegacy({ manifestPath: writeManifest(), trustLegacyFiles: true });

    const versions = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, fx.client1a.upload));
    expect(versions).toHaveLength(1);
    const v = versions[0];

    expect(v.versionNo).toBe(1);
    expect(v.storageKey).toMatch(/^files\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
    expect(v.sizeBytes).toBe(PDF_BYTES.length);

    const onDisk = fs.readFileSync(absPathForKey(v.storageKey));
    expect(createHash('sha256').update(onDisk).digest('hex')).toBe(v.sha256);
    expect(onDisk.equals(PDF_BYTES)).toBe(true);

    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, fx.client1a.upload));
    expect(doc.currentVersionId).toBe(v.id);
  });

  it('copies files rather than moving them: the legacy tree is left intact', async () => {
    const before = fs.readdirSync(process.env.UPLOADS_DIR!).sort();
    await importLegacy({ manifestPath: writeManifest(), trustLegacyFiles: true });
    expect(fs.readdirSync(process.env.UPLOADS_DIR!).sort()).toEqual(before);
  });

  it('marks versions pending and queues a scan unless the files are explicitly trusted', async () => {
    await importLegacy({ manifestPath: writeManifest() });

    const versions = await db.select().from(schema.documentVersions);
    expect(versions).toHaveLength(6);
    // Never claim clean for something no scanner has looked at (invariant 3).
    expect(versions.every((v) => v.scanStatus === 'pending')).toBe(true);
    expect(versions.every((v) => v.publishedAt === null)).toBe(true);

    const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.type, 'scan_retry'));
    expect(jobs).toHaveLength(6);
  });

  it('marks them clean only when told to, and records that they were not scanned', async () => {
    await importLegacy({ manifestPath: writeManifest(), trustLegacyFiles: true });
    const versions = await db.select().from(schema.documentVersions);
    expect(versions.every((v) => v.scanStatus === 'clean')).toBe(true);
    expect(versions.every((v) => /not scanned/.test(v.scanDetail ?? ''))).toBe(true);
    expect(await db.select().from(schema.jobs)).toHaveLength(0);
  });

  it('reports a missing file without losing the document or failing the run', async () => {
    // Delete one legacy file behind the database's back, as a tired hand might.
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, fx.client1a.upload));
    fs.rmSync(path.join(process.env.UPLOADS_DIR!, doc.storagePath!));

    const report = await importLegacy({ manifestPath: writeManifest(), trustLegacyFiles: true });

    expect(report.missingFiles).toHaveLength(1);
    expect(report.missingFiles[0]).toMatchObject({ documentId: fx.client1a.upload, storagePath: doc.storagePath! });
    expect(report.versionCount).toBe(5);
    // The other eight documents still converted, and this one survived.
    expect(report.documentCount).toBe(9);

    const [kept] = await db.select().from(schema.documents).where(eq(schema.documents.id, fx.client1a.upload));
    expect(kept.kind).toBe('client_upload');
    expect(kept.currentVersionId).toBeNull();
  });

  it('normalizes client emails and names any duplicates for C5.4', async () => {
    await db.update(schema.clients).set({ email: 'C1A@Example.test  ' }).where(eq(schema.clients.id, fx.client1b.id));

    const report = await importLegacy({ manifestPath: writeManifest(), trustLegacyFiles: true });

    const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, fx.client1b.id));
    expect(c.emailNormalized).toBe('c1a@example.test');
    expect(report.duplicateEmails).toHaveLength(1);
    expect(report.duplicateEmails[0].clientIds.sort()).toEqual([fx.client1a.id, fx.client1b.id].sort());
  });

  it('converts presets into templates, one item per preset item', async () => {
    await importLegacy({ manifestPath: writeManifest(), trustLegacyFiles: true });

    const templates = await db.select().from(schema.requestTemplates).where(eq(schema.requestTemplates.providerId, fx.provider1.id));
    expect(templates).toHaveLength(1);
    expect(templates[0].kind).toBe('custom');
    expect(templates[0].items).toEqual([
      { key: 'b1:bank-statement', title: 'Bank Statement', category: 'Monthly', instructions: null, required: true },
    ]);
  });

  it('is idempotent: a second run converts nothing and changes no counts', async () => {
    const first = await importLegacy({ manifestPath: writeManifest(), trustLegacyFiles: true });
    const after = await countRows();

    const second = await importLegacy({ manifestPath: writeManifest(), trustLegacyFiles: true });

    expect(await countRows()).toEqual(after);
    expect(second.documentCount).toBe(first.documentCount);
    expect(second.requestCount).toBe(first.requestCount);
    expect(second.versionCount).toBe(first.versionCount);
    // Everything it found was already there, so it created nothing.
    expect(second.engagementsCreated).toBe(0);
    expect(second.bytesCopied).toBe(0);
    expect(second.alreadyImported).toEqual({ documents: 9, requests: 3, versions: 6, engagements: 3, templates: 2 });
  });

  it('writes nothing at all on a dry run', async () => {
    const before = await countRows();
    const report = await importLegacy({ manifestPath: writeManifest(), dryRun: true, trustLegacyFiles: true });

    expect(report.dryRun).toBe(true);
    expect(report.documentCount).toBe(9);
    expect(report.requestCount).toBe(3);
    expect(report.versionCount).toBe(6);
    expect(await countRows()).toEqual(before);

    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, fx.client1a.upload));
    expect(doc.kind).toBeNull();
  });

  it('records the import in the audit log without naming any content', async () => {
    await importLegacy({ manifestPath: writeManifest(), trustLegacyFiles: true });

    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'legacy.import'));
    expect(rows).toHaveLength(1);
    expect(rows[0].actorKind).toBe('admin');
    expect(rows[0].meta).toMatchObject({ documents: 9, requests: 3, versions: 6, missingFiles: 0 });
    expect(JSON.stringify(rows[0])).not.toContain('Bank Statement');
  });
});

describe('preset conversion', () => {
  it('turns bins into items and survives malformed input', () => {
    expect(itemsFromBins([{ id: 'q', label: 'Quarterly', items: [{ name: 'P&L' }, { name: 'Balance Sheet' }] }])).toEqual([
      { key: 'q:p-l', title: 'P&L', category: 'Quarterly', instructions: null, required: true },
      { key: 'q:balance-sheet', title: 'Balance Sheet', category: 'Quarterly', instructions: null, required: true },
    ]);
    expect(itemsFromBins(null)).toEqual([]);
    expect(itemsFromBins([{ label: 'No items' }])).toEqual([]);
    expect(itemsFromBins([{ label: 'Bad items', items: [{}, { name: 42 }] }])).toEqual([]);
  });
});

describe('audit log', () => {
  it('is append-only: the database itself refuses an update or a delete', async () => {
    const [row] = await db
      .insert(schema.auditLog)
      .values({ action: 'client.created', targetType: 'client', meta: { seeded: true } })
      .returning();

    await expect(db.update(schema.auditLog).set({ action: 'auth.logout' }).where(eq(schema.auditLog.id, row.id))).rejects.toThrow(
      /append-only/
    );
    await expect(db.delete(schema.auditLog).where(eq(schema.auditLog.id, row.id))).rejects.toThrow(/append-only/);

    const still = await db.select().from(schema.auditLog).where(eq(schema.auditLog.id, row.id));
    expect(still).toHaveLength(1);
    expect(still[0].action).toBe('client.created');
  });

  it('hashes an email rather than storing it', async () => {
    const { hashedEmail, audit } = await import('../src/db/audit.js');
    const digest = hashedEmail('  Person@Example.COM ');
    expect(digest).toHaveLength(32);
    expect(digest).toBe(hashedEmail('person@example.com'));
    expect(digest).not.toContain('person');

    await audit({ action: 'auth.login_failed', targetType: 'provider', meta: { email: digest } });
    const [row] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'auth.login_failed'));
    expect(JSON.stringify(row.meta)).not.toMatch(/example\.com/i);
  });

  it('never lets an audit failure break the action it was recording', async () => {
    const { audit } = await import('../src/db/audit.js');
    // targetType is NOT NULL, so this insert cannot succeed.
    await expect(audit({ action: 'client.created', targetType: undefined as unknown as string })).resolves.toBeUndefined();
  });
});

describe('document/version relationship', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedLegacyFixture();
  });

  it('will not accept two versions with the same number for one document', async () => {
    await importLegacy({ manifestPath: writeManifest(), trustLegacyFiles: true });
    const [v] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, fx.client1a.upload));

    await expect(
      db.insert(schema.documentVersions).values({
        documentId: v.documentId,
        versionNo: v.versionNo,
        originalFilename: 'again.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        sha256: 'x'.repeat(64),
        storageKey: 'files/2026/09/duplicate.pdf',
        uploadedByKind: 'client',
        uploadedById: fx.client1a.id,
      })
    ).rejects.toThrow();
  });

  it('will not accept two versions pointing at the same bytes on disk', async () => {
    await importLegacy({ manifestPath: writeManifest(), trustLegacyFiles: true });
    const [v] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, fx.client1a.upload));

    await expect(
      db.insert(schema.documentVersions).values({
        documentId: v.documentId,
        versionNo: 2,
        originalFilename: 'again.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        sha256: 'x'.repeat(64),
        storageKey: v.storageKey, // unique
        uploadedByKind: 'client',
        uploadedById: fx.client1a.id,
      })
    ).rejects.toThrow();
  });

  it('scopes an imported engagement to one client only', async () => {
    await importLegacy({ manifestPath: writeManifest(), trustLegacyFiles: true });
    const rows = await db
      .select()
      .from(schema.engagements)
      .where(and(eq(schema.engagements.clientId, fx.client2a.id), eq(schema.engagements.kind, 'imported')));
    expect(rows).toHaveLength(1);
    expect(rows[0].providerId).toBe(fx.client2a.providerId);
  });
});
