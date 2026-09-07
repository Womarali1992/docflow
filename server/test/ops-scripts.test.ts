/**
 * The Node helpers behind ops/windows/backup.ps1 and restore.ps1: row counts,
 * stored-file integrity, and the scratch-database guard.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { countAll, TABLES } from '../scripts/count.mjs';
import { checkIntegrity } from '../scripts/integrity.mjs';
import { checkRedundancy } from '../scripts/legacy-redundancy.mjs';
import { buildManifest } from '../scripts/manifest.mjs';
import { recordBackup } from '../scripts/record-backup.mjs';
import { ensureDatabase } from '../scripts/create-db.mjs';
import { seedFixture, type Fixture } from './helpers.js';

const url = () => process.env.DATABASE_URL!;
/** Storage keys start with `files/`, so DATA_ROOT is the root they hang off. */
const dataRoot = () => process.env.DATA_ROOT!;
const check = () => checkIntegrity({ url: url(), dataRoot: dataRoot() });

describe('ops scripts', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('counts every table, files on record and migrations', async () => {
    const c = await countAll(url());
    expect(c.database).toBe('docflow_test');
    expect(Object.keys(c.tables).sort()).toEqual([...TABLES].sort());
    expect(c.tables).toEqual({
      providers: 2,
      clients: 3,
      documents: 9,
      messages: 2,
      activities: 5,
      sessions: 0,
      mfa_totp: 5,
      recovery_codes: 0,
      invitations: 0,
      password_resets: 0,
      jobs: 0,
      engagements: 3,
      requests: 3,
      document_versions: 6,
      reviews: 0,
      request_templates: 0,
      notifications: 0,
      audit_log: 0,
      backup_runs: 0,
    });
    expect(c.documentsWithFile).toBe(6);
    expect(c.migrations).toBeGreaterThanOrEqual(3);
  });

  it('skips the legacy pass on a contracted database, even when pointed at an uploads dir', async () => {
    // integrity.mjs still walks `documents.storage_path` when a database has
    // that column, because the restore drill runs it against restored pre-C5.4
    // sets. This schema is post-0008, so the legacy pass must find nothing to
    // do rather than throwing on a column that is not there.
    const r = await checkIntegrity({
      url: url(),
      dataRoot: dataRoot(),
      uploadsDir: path.join(dataRoot(), 'no-such-uploads'),
    });
    expect(r.ok).toBe(true);
    expect(r.legacyDocuments).toBe(0);
    expect(r.checkedUploads).toBe(0);
    expect(r.checkedVersions).toBeGreaterThan(0);
  });

  it('passes integrity when every version is where the database says', async () => {
    const r = await check();
    expect(r.ok).toBe(true);
    // One tree since C5.4: versions under DATA_ROOT/files. The legacy
    // server/uploads tree went with `documents.storage_path`.
    expect(r.checkedVersions).toBe(6);
    expect(r.missing).toEqual([]);
    expect(r.mismatched).toEqual([]);
  });

  it('fails when a published version is gone from DATA_ROOT', async () => {
    const [version] = await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, fx.client1a.uploadVersion));
    fs.unlinkSync(path.join(dataRoot(), version.storageKey));

    const r = await check();
    expect(r.ok).toBe(false);
    // A servable version missing is fatal: that is data the app promises to serve.
    expect(r.fatal.map((f: { id: string }) => f.id)).toContain(fx.client1a.uploadVersion);
  });

  it('fails when a version no longer hashes as recorded', async () => {
    const [version] = await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, fx.client1b.uploadVersion));
    // Files are immutable by design, so a changed byte is corruption, not an edit.
    fs.appendFileSync(path.join(dataRoot(), version.storageKey), 'tampered');

    const r = await check();
    expect(r.ok).toBe(false);
    expect(
      r.mismatched.some((m: { id: string; reason: string }) => m.id === fx.client1b.uploadVersion && /sha256/.test(m.reason))
    ).toBe(true);
  });

  it('reports a version whose bytes disagree with the manifest', async () => {
    const [version] = await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, fx.client2a.deliverableVersion));
    // The bytes match the database but not the backup set they were copied
    // from: the restore drill is the caller that has to notice this.
    const manifest = {
      files: { entries: [{ path: version.storageKey, sha256: '0'.repeat(64) }] },
    };
    const tampered = await checkIntegrity({ url: url(), dataRoot: dataRoot(), manifest });
    expect(tampered.ok).toBe(false);
    expect(tampered.mismatched.map((m: { id: string }) => m.id)).toContain(fx.client2a.deliverableVersion);
  });

  it('reports the legacy-redundancy question as moot once the database is contracted', async () => {
    // This schema is post-0008: there is no `documents.storage_path` to compare
    // against. The script has to say so rather than throw (restore.ps1 and the
    // runbook both call it on databases in either shape) and rather than report
    // a clean PASS, which would read as "the tree was checked and is redundant"
    // when nothing was checked at all.
    const r = await checkRedundancy({
      url: url(),
      dataRoot: dataRoot(),
      uploadsDir: path.join(dataRoot(), 'no-such-uploads'),
    });
    expect(r.contracted).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.legacyFiles).toBe(0);
    expect(r.note).toMatch(/already run/);
  });

  it('writes a manifest that describes the set, and records the run', async () => {
    const setDir = path.join(dataRoot(), 'backup-set');
    fs.mkdirSync(setDir, { recursive: true });
    fs.writeFileSync(path.join(setDir, 'db.dump'), 'not a real dump, but it hashes');
    // A backup set is a copy: the manifest verifies what was copied, not the live tree.
    fs.cpSync(path.join(dataRoot(), 'files'), path.join(setDir, 'files'), { recursive: true });

    const result = await buildManifest({ setDir, url: url() });
    expect(result.ok).toBe(true);
    expect(result.fileCount).toBe(6);

    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    expect(manifest.version).toBe(2);
    expect(manifest.counts.tables.document_versions).toBe(6);
    expect(manifest.files.entries).toHaveLength(6);
    expect(manifest.files.entries.every((e: { sha256: string }) => /^[0-9a-f]{64}$/.test(e.sha256))).toBe(true);
    // Contracted schema: no legacy tree to carry, but the key is still present
    // and empty. restore.ps1 reads `manifest.uploads` on sets from both sides of
    // the contraction, and an absent key under StrictMode is an error, not a zero.
    expect(manifest.uploads).toEqual([]);
    expect(manifest.uploadCount).toBe(0);
    expect(manifest.legacyMissing).toEqual([]);

    const run = await recordBackup({
      url: url(),
      startedAt: new Date(),
      ok: true,
      manifestPath: result.manifestPath,
      dumpBytes: manifest.dump.bytes,
      fileCount: manifest.files.count,
    });
    expect(run.ok).toBe(true);
    const [row] = await db.select().from(schema.backupRuns);
    expect(row.fileCount).toBe(6);
    expect(row.manifestPath).toBe(result.manifestPath);
  });

  it('refuses a set that is missing a servable file', async () => {
    const setDir = path.join(dataRoot(), 'broken-set');
    fs.mkdirSync(path.join(setDir, 'files'), { recursive: true });
    fs.writeFileSync(path.join(setDir, 'db.dump'), 'dump');
    // Every version copied except one: the manifest must say so rather than
    // describing a set that cannot restore the system.
    const [version] = await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, fx.client1a.uploadVersion));
    for (const v of await db.select().from(schema.documentVersions)) {
      if (v.id === version.id) continue;
      // The key already begins with `files/`, so it hangs off the set root.
      const dest = path.join(setDir, v.storageKey);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(dataRoot(), v.storageKey), dest);
    }

    const result = await buildManifest({ setDir, url: url() });
    expect(result.ok).toBe(false);
    expect(result.fatal).toHaveLength(1);
    expect(result.fatal[0].storageKey).toBe(version.storageKey);
  });

  it('refuses to create anything but a docflow_test / docflow_restore* database', async () => {
    await expect(ensureDatabase({ name: 'docflow', owner: 'docflow', adminUrl: url() })).rejects.toThrow(/Refusing/);
    await expect(ensureDatabase({ name: 'postgres', owner: 'docflow', adminUrl: url() })).rejects.toThrow(/Refusing/);
    await expect(ensureDatabase({ name: 'docflow_restore', owner: 'docflow; drop', adminUrl: url() })).rejects.toThrow(/role/);
  });
});
