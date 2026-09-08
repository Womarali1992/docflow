/**
 * The Node helpers behind ops/windows/backup.ps1 and restore.ps1: row counts,
 * stored-file integrity, and the scratch-database guard.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool, schema } from '../src/db/client.js';
import { countAll, TABLES } from '../scripts/count.mjs';
import { checkIntegrity } from '../scripts/integrity.mjs';
import { checkRedundancy } from '../scripts/legacy-redundancy.mjs';
import { buildManifest } from '../scripts/manifest.mjs';
import { backupDump, readSnapshotData, resolvePgDump, withExportedSnapshot } from '../scripts/backup-dump.mjs';
import { recordBackup } from '../scripts/record-backup.mjs';
import { ensureDatabase } from '../scripts/create-db.mjs';
import { collectStatus, journalEntries } from '../scripts/status.mjs';
import { deleteOrphans, findOrphans, parseDuration } from '../scripts/orphans.mjs';
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
    expect(manifest.version).toBe(3);
    // No snapshot.json beside the dump: this set was assembled by hand, so the
    // list and the dump come from two different instants and the manifest says
    // so rather than letting a later reader assume otherwise.
    expect(manifest.consistency).toBe('live');
    expect(manifest.snapshotId).toBeNull();
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

  /* --------------------------------------------------------- H3: orphans */

  /**
   * The mirror image of the integrity check. That one asks whether every row's
   * file exists; this asks whether every file has a row. Debris under `files/`
   * is what a transaction that failed after the rename leaves behind, and until
   * H3 nothing looked for it — the hourly sweeper only covers `staging/`.
   */
  it('lists files under files/ that no version row points at, and nothing else', async () => {
    const [version] = await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, fx.client1a.upload));

    // Debris beside a real file, backdated so it is old enough to judge.
    const orphanKey = 'files/2026/01/orphan-abandoned.pdf';
    const orphanAbs = path.join(dataRoot(), orphanKey);
    fs.mkdirSync(path.dirname(orphanAbs), { recursive: true });
    fs.writeFileSync(orphanAbs, 'abandoned bytes');
    const old = new Date(Date.now() - 72 * 60 * 60 * 1000);
    fs.utimesSync(orphanAbs, old, old);

    const report = await findOrphans({ url: url(), dataRoot: dataRoot() });

    expect(report.orphans.map((o) => o.key)).toEqual([orphanKey]);
    expect(report.orphans[0].sizeBytes).toBe('abandoned bytes'.length);
    // The referenced file is not in the list, whatever else is on the volume.
    expect(report.orphans.map((o) => o.key)).not.toContain(version.storageKey);
    expect(report.referencedRows).toBeGreaterThanOrEqual(6);

    const removal = deleteOrphans(report.orphans);
    expect(removal.failed).toEqual([]);
    expect(fs.existsSync(orphanAbs)).toBe(false);
    // The document everyone else is still using is exactly where it was.
    expect(fs.existsSync(path.join(dataRoot(), version.storageKey))).toBe(true);
  });

  /**
   * A file written seconds ago may be a transaction still open on another
   * connection. Counting it is honest; offering to delete it is not.
   */
  it('will not call a file written seconds ago an orphan', async () => {
    const freshKey = 'files/2026/01/just-now.pdf';
    const freshAbs = path.join(dataRoot(), freshKey);
    fs.mkdirSync(path.dirname(freshAbs), { recursive: true });
    fs.writeFileSync(freshAbs, 'mid-transaction, possibly');

    const report = await findOrphans({ url: url(), dataRoot: dataRoot() });

    // Counted so the operator knows the volume has more on it than the report
    // lists, but never offered for deletion. (Earlier tests in this file leave
    // their own fixture bytes behind, which land in the same bucket — DATA_ROOT
    // is wiped once per file, not once per test.)
    expect(report.orphans.map((o) => o.key)).not.toContain(freshKey);
    expect(report.tooRecent).toBeGreaterThanOrEqual(1);
  });

  it('reads --older-than the way an operator would write it', () => {
    expect(parseDuration('7d')).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDuration('90m')).toBe(90 * 60 * 1000);
    expect(parseDuration('12')).toBe(12 * 60 * 60 * 1000);
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });

  it('refuses to create anything but a docflow_test / docflow_restore* database', async () => {
    await expect(ensureDatabase({ name: 'docflow', owner: 'docflow', adminUrl: url() })).rejects.toThrow(/Refusing/);
    await expect(ensureDatabase({ name: 'postgres', owner: 'docflow', adminUrl: url() })).rejects.toThrow(/Refusing/);
    await expect(ensureDatabase({ name: 'docflow_restore', owner: 'docflow; drop', adminUrl: url() })).rejects.toThrow(/role/);
  });
});

/**
 * `npm run status` (H0) — the one command that answers "what exactly is running
 * here". The audit had to reconstruct all of this by hand, so the tests worth
 * having are the two that make it trustworthy: the migration gap is real rather
 * than assumed, and nothing it prints is a secret.
 */
describe('npm run status', () => {
  const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'status.mjs');

  beforeEach(async () => {
    await seedFixture();
  });

  it('describes the checkout, the database and the volume without inventing anything', async () => {
    const s = await collectStatus({ url: url() });

    expect(s.database).toMatchObject({ name: 'docflow_test', reachable: true });
    expect(s.node).toBe(process.version);
    expect(s.env).toBe('test');
    // The test database migrates from empty before every file, so it is current.
    expect(s.migrations!.pending).toEqual([]);
    expect(s.migrations!.last).toBe(journalEntries().at(-1)!.tag);
    expect(s.migrations!.unknown).toBe(0);
    expect(s.work!.documentVersions).toBe(6);
    // DATA_ROOT is server/.data-tmp in tests: inside the checkout, which is the
    // finding this flag exists to make in production rather than a test failure.
    expect(s.storage.insideCheckout).toBe(true);
    expect(s.storage.exists).toBe(true);
    // Whether mail is configured here depends on the developer's server/.env —
    // every ops script loads it (lib.mjs), including this one. What must hold
    // whatever it says is that no credential comes back out.
    expect(Object.keys(s.smtp)).not.toContain('password');
    expect(JSON.stringify(s.smtp)).not.toMatch(/:[^:@/"]+@/);
    // No CI artifact in a local run — null, not a guess.
    expect(s.tests).toBeNull();
  });

  it('names the migrations a database has not taken yet', async () => {
    // The pilot's laptop database is one migration behind (0008_contract is the
    // destructive one, deliberately unapplied). Reproduce that shape by removing
    // the newest row, then put it back: an unnoticed migration gap is exactly
    // what this field exists to catch.
    const last = journalEntries().at(-1)!;
    const { rows } = await pool.query('SELECT hash, created_at FROM drizzle.__drizzle_migrations WHERE created_at = $1', [
      last.when,
    ]);
    expect(rows).toHaveLength(1);
    await pool.query('DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1', [last.when]);
    try {
      const s = await collectStatus({ url: url() });
      expect(s.migrations!.pending).toEqual([last.tag]);
      expect(s.migrations!.appliedCount).toBe(journalEntries().length - 1);
      expect(s.migrations!.last).toBe(journalEntries().at(-2)!.tag);
    } finally {
      await pool.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [
        rows[0].hash,
        rows[0].created_at,
      ]);
    }
  });

  it('runs as a command, prints JSON, and prints no password', () => {
    // A status report is for pasting into an issue, so the credentials in
    // DATABASE_URL and SMTP_URL must not survive the trip. Both are given to the
    // child on purpose, with passwords nothing else in the tree uses.
    const smtpPassword = 'st4tus-should-never-print-this';
    const stdout = execFileSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SMTP_URL: `smtps://status%40example.test:${smtpPassword}@smtp.example.test:465`,
        MAIL_FROM: 'DocFlow <status@example.test>',
      },
    });

    const report = JSON.parse(stdout);
    expect(report.database.name).toBe('docflow_test');
    expect(report.smtp).toMatchObject({ configured: true, host: 'smtp.example.test:465', user: 'status@example.test' });

    const dbPassword = new URL(url()).password;
    expect(dbPassword.length).toBeGreaterThan(0);
    expect(stdout).not.toContain(dbPassword);
    expect(stdout).not.toContain(smtpPassword);
    expect(report.database.url).toContain(':***@');
  });
});

/**
 * H6 — a backup set is one instant.
 *
 * The audit's F8: `backup.ps1` dumped, then copied files, then `manifest.mjs`
 * asked the *live* database what the set should contain. Three instants, so an
 * upload that landed between them was in the manifest but not in the copy, and
 * the backup failed its own check for no reason at all. Postgres can settle it
 * without pausing a single writer: one REPEATABLE READ transaction exports its
 * snapshot, `pg_dump --snapshot` adopts it, and the same transaction writes down
 * what it saw.
 */
describe('backups from one snapshot (H6)', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  const BYTES = Buffer.from('%PDF-1.4 a later version of the same document');

  /** A version row of the caller's choosing, with or without its bytes on disk. */
  async function addVersion(opts: {
    documentId: string;
    versionNo: number;
    scanStatus: 'pending' | 'clean' | 'infected';
    withBytes: boolean;
  }) {
    const storageKey = `files/2026/09/${randomUUID()}.pdf`;
    const abs = path.join(dataRoot(), storageKey);
    if (opts.withBytes) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, BYTES);
    }
    const [v] = await db
      .insert(schema.documentVersions)
      .values({
        documentId: opts.documentId,
        versionNo: opts.versionNo,
        originalFilename: 'later.pdf',
        mimeType: 'application/pdf',
        sizeBytes: BYTES.length,
        sha256: createHash('sha256').update(BYTES).digest('hex'),
        storageKey,
        scanStatus: opts.scanStatus,
        uploadedByKind: 'client',
        uploadedById: fx.client1a.id,
      })
      .returning({ id: schema.documentVersions.id });
    return { id: v.id, storageKey, abs };
  }

  /**
   * A backup set the way backup.ps1 assembles one, minus the real dump: the
   * snapshot's list beside a copy of every file it names. `skip` leaves one
   * version's bytes out, which is what a set that cannot restore looks like.
   */
  async function snapshotSet(name: string, skip: string[] = []) {
    const setDir = path.join(dataRoot(), name);
    fs.mkdirSync(setDir, { recursive: true });
    fs.writeFileSync(path.join(setDir, 'db.dump'), `not a real dump (${name}), but it hashes`);
    const snapshot = await withExportedSnapshot(url(), async ({ client, snapshotId }: { client: unknown; snapshotId: string }) => ({
      version: 1,
      snapshotId,
      exportedAt: new Date().toISOString(),
      database: 'docflow_test',
      pgDumpVersion: null,
      ...(await readSnapshotData(client)),
    }));
    fs.writeFileSync(path.join(setDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2), 'utf8');
    for (const v of snapshot.versions as { id: string; storageKey: string }[]) {
      if (skip.includes(v.id)) continue;
      const src = path.join(dataRoot(), v.storageKey);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(setDir, v.storageKey);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
    return { setDir, snapshot };
  }

  it('reads the database as it was when the snapshot opened, not as it is now', async () => {
    const seen = await withExportedSnapshot(url(), async ({ client, snapshotId }: { client: unknown; snapshotId: string }) => {
      expect(snapshotId).toMatch(/\S/);
      // Another connection commits a version while the snapshot is held — the
      // upload that used to land between the dump and the manifest.
      const added = await addVersion({ documentId: fx.client1a.upload, versionNo: 2, scanStatus: 'clean', withBytes: true });
      return { data: await readSnapshotData(client), addedId: added.id };
    });

    expect(seen.data.versions.map((v: { id: string }) => v.id)).not.toContain(seen.addedId);
    expect(seen.data.versions).toHaveLength(6);
    // The counts come from the same transaction, so they agree with the list.
    expect(seen.data.counts.tables.document_versions).toBe(6);
    expect(await db.select().from(schema.documentVersions)).toHaveLength(7);
  });

  it('fails a set that is missing the bytes of a version still waiting to be scanned', async () => {
    // Not servable — nobody can download a pending version — but its bytes are
    // real data, and a restore that loses them loses the last hour of uploads.
    const pending = await addVersion({ documentId: fx.client1a.upload, versionNo: 2, scanStatus: 'pending', withBytes: true });
    const { setDir } = await snapshotSet('set-pending-missing', [pending.id]);

    const result = await buildManifest({ setDir, url: url() });
    expect(result.ok).toBe(false);
    expect(result.consistency).toBe('snapshot');
    expect(result.fatal).toHaveLength(1);
    expect(result.fatal[0]).toMatchObject({ kind: 'missing', versionId: pending.id, scanStatus: 'pending' });
  });

  it('forgives the bytes of a version that was already infected', async () => {
    // Quarantine deletes the file on purpose. A set without it is complete.
    const infected = await addVersion({ documentId: fx.client1a.upload, versionNo: 2, scanStatus: 'infected', withBytes: false });
    const { setDir } = await snapshotSet('set-infected');

    const result = await buildManifest({ setDir, url: url() });
    expect(result.ok).toBe(true);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ kind: 'missing', versionId: infected.id, fatal: false })
    );
  });

  it('forgives a version quarantined between the snapshot and the copy', async () => {
    // Pending when the snapshot opened, infected by the time the files were
    // copied: the scanner deleted the bytes in that window. That is the one
    // legitimate reason for a file the snapshot names to be absent.
    const racing = await addVersion({ documentId: fx.client1a.upload, versionNo: 2, scanStatus: 'pending', withBytes: true });
    const { setDir } = await snapshotSet('set-quarantined-after', [racing.id]);
    await db
      .update(schema.documentVersions)
      .set({ scanStatus: 'infected', scannedAt: new Date() })
      .where(eq(schema.documentVersions.id, racing.id));

    const result = await buildManifest({ setDir, url: url() });
    expect(result.ok).toBe(true);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ kind: 'quarantined_after_snapshot', versionId: racing.id, fatal: false })
    );
  });

  it('takes the dump and the list from one snapshot, for real', async () => {
    // The only test that proves `pg_dump --snapshot=<id>` is accepted at all;
    // everything else drives the two halves separately. Skipped where the
    // client tools are not installed rather than failing on someone's laptop.
    let pgDump: string;
    try {
      pgDump = resolvePgDump();
      execFileSync(pgDump, ['--version'], { stdio: 'ignore' });
    } catch {
      console.warn('[ops] pg_dump not available — skipping the real dump');
      return;
    }

    const setDir = path.join(dataRoot(), 'real-set');
    const result = await backupDump({ setDir, url: url(), pgDump });
    expect(result.ok).toBe(true);
    expect(result.snapshotId).toMatch(/\S/);
    expect(fs.statSync(result.dumpPath).size).toBeGreaterThan(0);

    const snapshot = JSON.parse(fs.readFileSync(path.join(setDir, 'snapshot.json'), 'utf8'));
    expect(snapshot.versions).toHaveLength(6);
    expect(snapshot.counts.tables.documents).toBe(9);
    expect(snapshot.snapshotId).toBe(result.snapshotId);
    expect(snapshot.pgDumpVersion).toMatch(/pg_dump/);
  });

  it('calls a missing pending version fatal in the integrity check too', async () => {
    const pending = await addVersion({ documentId: fx.client1a.upload, versionNo: 2, scanStatus: 'pending', withBytes: true });
    fs.unlinkSync(pending.abs);

    const r = await checkIntegrity({ url: url(), dataRoot: dataRoot() });
    expect(r.ok).toBe(false);
    expect(r.fatal.map((f: { id: string }) => f.id)).toContain(pending.id);
  });

  /**
   * A restore can put every row and every byte back and still leave the firm
   * locked out: the TOTP secrets are sealed with APP_ENCRYPTION_KEY, and only
   * the key on the machine doing the restoring can open them. This is also what
   * pins scripts/lib.mjs's copy of the wire format to src/auth/crypto.ts — the
   * secret it reads here was written by the server's own encryptSecret.
   */
  it('reports whether APP_ENCRYPTION_KEY still opens the database', async () => {
    const ok = await checkIntegrity({ url: url(), dataRoot: dataRoot(), checkKey: true });
    expect(ok.mfaKeyOk).toBe(true);
    expect(ok.ok).toBe(true);

    const previous = process.env.APP_ENCRYPTION_KEY;
    process.env.APP_ENCRYPTION_KEY = 'a'.repeat(64);
    try {
      const wrong = await checkIntegrity({ url: url(), dataRoot: dataRoot(), checkKey: true });
      expect(wrong.mfaKeyOk).toBe(false);
      expect(wrong.mfaKeyNote).toMatch(/APP_ENCRYPTION_KEY/);
      // Every file is where it should be, and the restore still failed. That is
      // the point: bytes are not the only thing a restore has to get right —
      // and the drill's table reports the two as the separate facts they are.
      expect(wrong.fatal).toEqual([]);
      expect(wrong.filesOk).toBe(true);
      expect(wrong.ok).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.APP_ENCRYPTION_KEY;
      else process.env.APP_ENCRYPTION_KEY = previous;
    }
  });

  it('says so when there is no enrolment to check the key against', async () => {
    await db.delete(schema.mfaTotp);
    const r = await checkIntegrity({ url: url(), dataRoot: dataRoot(), checkKey: true });
    // "Nothing to check" is not "the key is right", and the drill should not
    // read one as the other.
    expect(r.mfaKeyOk).toBeNull();
    expect(r.mfaKeyNote).toMatch(/no enrolled TOTP secret/);
    expect(r.ok).toBe(true);
  });
});
