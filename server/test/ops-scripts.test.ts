/**
 * The Node helpers behind ops/windows/backup.ps1 and restore.ps1: row counts,
 * stored-file integrity, and the scratch-database guard.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { countAll, TABLES } from '../scripts/count.mjs';
import { checkIntegrity } from '../scripts/integrity.mjs';
import { ensureDatabase } from '../scripts/create-db.mjs';
import { PDF_BYTES, seedFixture, type Fixture } from './helpers.js';

const url = () => process.env.DATABASE_URL!;
const uploadsDir = () => process.env.UPLOADS_DIR!;

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
      presets: 2,
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

  it('passes integrity when every stored file is present and sized as recorded', async () => {
    const r = await checkIntegrity({ url: url(), uploadsDir: uploadsDir() });
    expect(r.ok).toBe(true);
    expect(r.documentsWithFile).toBe(6);
    expect(r.checked).toBe(6);
    expect(r.missing).toEqual([]);
    expect(r.mismatched).toEqual([]);
  });

  it('reports a missing file and a manifest hash mismatch', async () => {
    const victim = path.join(uploadsDir(), `${fx.client1a.upload}.pdf`);
    fs.unlinkSync(victim);
    const missing = await checkIntegrity({ url: url(), uploadsDir: uploadsDir() });
    expect(missing.ok).toBe(false);
    expect(missing.missing.map((m: { id: string }) => m.id)).toEqual([fx.client1a.upload]);

    fs.writeFileSync(victim, PDF_BYTES);
    const manifest = {
      uploads: [{ path: `${fx.client1b.upload}.pdf`, bytes: PDF_BYTES.length, sha256: '0'.repeat(64) }],
    };
    const tampered = await checkIntegrity({ url: url(), uploadsDir: uploadsDir(), manifest });
    expect(tampered.ok).toBe(false);
    expect(tampered.mismatched).toHaveLength(1);
    expect(tampered.mismatched[0].id).toBe(fx.client1b.upload);
  });

  it('reports a size that drifted from the database', async () => {
    const victim = path.join(uploadsDir(), `${fx.client2a.deliverable}.pdf`);
    fs.appendFileSync(victim, 'extra bytes');
    const r = await checkIntegrity({ url: url(), uploadsDir: uploadsDir() });
    expect(r.ok).toBe(false);
    expect(r.mismatched.map((m: { id: string }) => m.id)).toEqual([fx.client2a.deliverable]);
  });

  it('refuses to create anything but a docflow_test / docflow_restore* database', async () => {
    await expect(ensureDatabase({ name: 'docflow', owner: 'docflow', adminUrl: url() })).rejects.toThrow(/Refusing/);
    await expect(ensureDatabase({ name: 'postgres', owner: 'docflow', adminUrl: url() })).rejects.toThrow(/Refusing/);
    await expect(ensureDatabase({ name: 'docflow_restore', owner: 'docflow; drop', adminUrl: url() })).rejects.toThrow(/role/);
  });
});
