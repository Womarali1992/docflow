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
 * This is what the restore drill runs to decide whether a restore actually
 * worked.
 *
 *   node scripts/integrity.mjs [--url ...] [--data-root <dir>] [--uploads <dir>] [--manifest <path>]
 *
 * Exit code 1 when a servable file is missing or hashes differently.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { argValue, databaseUrl, isMain, serverDir, sha256File } from './lib.mjs';

const norm = (p) => p.replace(/\\/g, '/');

/**
 * @param {{ url: string, dataRoot: string, uploadsDir?: string | null,
 *           manifest?: { files?: { entries?: { path: string, sha256: string }[] },
 *                        uploads?: { path: string, sha256: string }[] } | null }} opts
 */
export async function checkIntegrity({ url, dataRoot, uploadsDir = null, manifest = null }) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let versions;
  let legacyDocs = [];
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
    if (!fs.existsSync(abs)) {
      missing.push({ kind: 'version', id: v.id, path: rel, servable, scanStatus: v.scan_status });
      continue;
    }
    const bytes = fs.statSync(abs).size;
    const sha = sha256File(abs);
    const fromManifest = expectedFiles.get(rel);
    if (v.sha256 && v.sha256 !== sha) {
      mismatched.push({ kind: 'version', id: v.id, path: rel, servable, reason: 'sha256 differs from the database' });
    } else if (fromManifest && fromManifest.sha256 !== sha) {
      mismatched.push({ kind: 'version', id: v.id, path: rel, servable, reason: 'sha256 differs from the manifest' });
    } else if (v.size_bytes !== null && Number(v.size_bytes) !== bytes) {
      mismatched.push({ kind: 'version', id: v.id, path: rel, servable, reason: `size on disk ${bytes} != database ${v.size_bytes}` });
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
      missing.push({ kind: 'legacy', id: d.id, path: rel, servable: true });
      continue;
    }
    const bytes = fs.statSync(abs).size;
    const sha = sha256File(abs);
    const fromManifest = expectedUploads.get(rel);
    if (fromManifest && fromManifest.sha256 !== sha) {
      mismatched.push({ kind: 'legacy', id: d.id, path: rel, servable: true, reason: 'sha256 differs from the manifest' });
    } else if (d.size_bytes !== null && Number(d.size_bytes) !== bytes) {
      mismatched.push({ kind: 'legacy', id: d.id, path: rel, servable: true, reason: `size on disk ${bytes} != database ${d.size_bytes}` });
    }
    checkedUploads++;
  }

  const fatal = [...missing, ...mismatched].filter((p) => p.servable);

  return {
    ok: fatal.length === 0,
    dataRoot,
    uploadsDir,
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
    const result = await checkIntegrity({ url: databaseUrl(), dataRoot, uploadsDir, manifest });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.ok) {
      console.error(`integrity: ${result.fatal.length} servable file(s) missing or altered`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`integrity check failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}
