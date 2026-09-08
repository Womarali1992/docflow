#!/usr/bin/env node
/**
 * Integrity check (v3, C5.4): does the database's idea of the files match the
 * bytes on disk?
 *
 * **`document_versions.storage_key` under `DATA_ROOT`** (the keys themselves
 * start with `files/`) is every byte the system holds going forward. Versions
 * are immutable by design, so a mismatch there is not "an edit", it is
 * corruption or a wrong restore. Only versions that are *servable* (clean and
 * published) are fatal: a quarantined version's bytes were deleted on purpose.
 *
 * It also walks **`documents.storage_path` under `server/uploads`** whenever a
 * database still has that column — the tree the C2.1 import left in place. That
 * is not nostalgia: the restore drill runs this against restored *pre-C5.4*
 * sets, and a drill that silently skips half the bytes it restored proves
 * nothing. `0008_contract` drops the column, and then the legacy pass simply
 * finds nothing to do.
 *
 * **Since H6, missing bytes are fatal unless the version is `infected`** — the
 * same rule the backup manifest applies. A quarantined version's bytes were
 * deleted on purpose; a version still waiting to be scanned has bytes, because
 * nothing commits a version row without them (H3). Judging only *servable*
 * versions, as this did, meant a restore could lose every pending upload of the
 * last hour and still print PASS.
 *
 * `--check-key` additionally decrypts one `mfa_totp.secret_enc` with
 * APP_ENCRYPTION_KEY and reports `mfaKeyOk`. The restore drill runs it, because
 * a restored database with the wrong key is a firm locked out of its own second
 * factor — bytes and rows all present, nobody able to sign in.
 *
 * This is what the restore drill runs to decide whether a restore actually
 * worked.
 *
 *   node scripts/integrity.mjs [--url ...] [--data-root <dir>] [--uploads <dir>]
 *                              [--manifest <path>] [--check-key]
 *
 * Exit code 1 when an expected file is missing, hashes differently, or the
 * encryption key cannot read the database's own secrets.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { argValue, databaseUrl, decryptSecret, hasFlag, isMain, serverDir, sha256File } from './lib.mjs';

const norm = (p) => p.replace(/\\/g, '/');

/**
 * @param {{ url: string, dataRoot: string, uploadsDir?: string | null, checkKey?: boolean,
 *           manifest?: { files?: { entries?: { path: string, sha256: string }[] },
 *                        uploads?: { path: string, sha256: string }[] } | null }} opts
 */
export async function checkIntegrity({ url, dataRoot, uploadsDir = null, manifest = null, checkKey = false }) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let versions;
  let legacyDocs = [];
  let secretSample = null;
  try {
    versions = (
      await client.query(
        `SELECT id, document_id, version_no, storage_key, size_bytes, sha256, scan_status,
                published_at IS NOT NULL AS published
           FROM document_versions ORDER BY created_at`
      )
    ).rows;
    /* Ask before selecting: 0008_contract drops the column, and this script has
       to answer for a restored pre-C5.4 set as well as a current one. */
    const hasStoragePath = (
      await client.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'documents' AND column_name = 'storage_path'`
      )
    ).rowCount;
    if (hasStoragePath && uploadsDir) {
      legacyDocs = (
        await client.query('SELECT id, name, storage_path, size_bytes FROM documents WHERE storage_path IS NOT NULL ORDER BY id')
      ).rows;
    }
    if (checkKey) {
      /* One row is enough: every secret is sealed with the same key, so if one
         opens they all do. The plaintext never leaves this function. */
      const r = await client.query(
        'SELECT secret_enc FROM mfa_totp WHERE secret_enc IS NOT NULL ORDER BY created_at LIMIT 1'
      );
      secretSample = r.rowCount ? r.rows[0].secret_enc : null;
    }
  } finally {
    await client.end();
  }

  const expectedFiles = new Map((manifest?.files?.entries ?? []).map((f) => [norm(f.path), f]));
  const expectedUploads = new Map((manifest?.uploads ?? []).map((u) => [norm(u.path), u]));

  const missing = [];
  const mismatched = [];
  let checkedVersions = 0;
  let checkedUploads = 0;

  for (const v of versions) {
    const rel = norm(v.storage_key);
    const abs = path.join(dataRoot, rel);
    const servable = Boolean(v.published) && v.scan_status === 'clean';
    /* A quarantined version's bytes were deleted on purpose. Everything else the
       database still records must be on disk — a pending version has bytes from
       the moment its row exists (H3), so its absence is a real loss. */
    const expected = v.scan_status !== 'infected';
    if (!fs.existsSync(abs)) {
      missing.push({ kind: 'version', id: v.id, path: rel, servable, expected, scanStatus: v.scan_status });
      continue;
    }
    const bytes = fs.statSync(abs).size;
    const sha = sha256File(abs);
    const fromManifest = expectedFiles.get(rel);
    if (v.sha256 && v.sha256 !== sha) {
      mismatched.push({ kind: 'version', id: v.id, path: rel, servable, expected, reason: 'sha256 differs from the database' });
    } else if (fromManifest && fromManifest.sha256 !== sha) {
      mismatched.push({ kind: 'version', id: v.id, path: rel, servable, expected, reason: 'sha256 differs from the manifest' });
    } else if (v.size_bytes !== null && Number(v.size_bytes) !== bytes) {
      mismatched.push({ kind: 'version', id: v.id, path: rel, servable, expected, reason: `size on disk ${bytes} != database ${v.size_bytes}` });
    }
    checkedVersions++;
  }

  /* The legacy tree, when there still is one. Empty on a contracted database,
     so this loop simply does not run once the contraction is done — the same
     result the C5.4-only version gave, without being blind to a restored
     pre-C5.4 set, which is exactly what the restore drill exists to check. */
  for (const d of legacyDocs) {
    const rel = norm(d.storage_path);
    const abs = path.join(uploadsDir, rel);
    if (!fs.existsSync(abs)) {
      missing.push({ kind: 'legacy', id: d.id, path: rel, servable: true, expected: true });
      continue;
    }
    const bytes = fs.statSync(abs).size;
    const sha = sha256File(abs);
    const fromManifest = expectedUploads.get(rel);
    if (fromManifest && fromManifest.sha256 !== sha) {
      mismatched.push({ kind: 'legacy', id: d.id, path: rel, servable: true, expected: true, reason: 'sha256 differs from the manifest' });
    } else if (d.size_bytes !== null && Number(d.size_bytes) !== bytes) {
      mismatched.push({ kind: 'legacy', id: d.id, path: rel, servable: true, expected: true, reason: `size on disk ${bytes} != database ${d.size_bytes}` });
    }
    checkedUploads++;
  }

  const fatal = [...missing, ...mismatched].filter((p) => p.expected);

  /* Can this database's own secrets be read with the key this machine has? null
     when the check was not asked for, or when there is no enrolment to try —
     "nothing to check" and "the key is wrong" are not the same answer. */
  let mfaKeyOk = null;
  let mfaKeyNote = null;
  if (checkKey) {
    if (!secretSample) {
      mfaKeyNote = 'no enrolled TOTP secret to check';
    } else {
      try {
        decryptSecret(secretSample);
        mfaKeyOk = true;
      } catch (err) {
        mfaKeyOk = false;
        mfaKeyNote = `APP_ENCRYPTION_KEY cannot decrypt mfa_totp.secret_enc (${err instanceof Error ? err.message : err})`;
      }
    }
  }

  return {
    ok: fatal.length === 0 && mfaKeyOk !== false,
    /* The bytes on their own, so a caller can report "every file verified" and
       "the key is wrong" as the two separate facts they are. */
    filesOk: fatal.length === 0,
    dataRoot,
    uploadsDir,
    mfaKeyOk,
    mfaKeyNote,
    versions: versions.length,
    checkedVersions,
    legacyDocuments: legacyDocs.length,
    checkedUploads,
    manifestEntries: expectedFiles.size + expectedUploads.size,
    missing,
    mismatched,
    fatal,
  };
}

if (isMain(import.meta.url)) {
  try {
    const dataRoot = path.resolve(argValue('--data-root') || process.env.DATA_ROOT || path.join(serverDir, '.data'));
    const uploadsDir = path.resolve(argValue('--uploads') || process.env.UPLOADS_DIR || path.join(serverDir, 'uploads'));
    const manifestPath = argValue('--manifest');
    // Tolerate a UTF-8 BOM: Windows PowerShell 5.1 adds one to files it writes as UTF8.
    const manifest = manifestPath ? JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/, '')) : null;
    const result = await checkIntegrity({
      url: databaseUrl(),
      dataRoot,
      uploadsDir,
      manifest,
      checkKey: hasFlag('--check-key'),
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.ok) {
      if (result.mfaKeyOk === false) console.error(`integrity: ${result.mfaKeyNote}`);
      if (result.fatal.length) console.error(`integrity: ${result.fatal.length} expected file(s) missing or altered`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`integrity check failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}
