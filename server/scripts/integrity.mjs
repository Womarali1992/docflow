#!/usr/bin/env node
/**
 * Integrity check (v3, C5.4): does the database's idea of the files match the
 * bytes on disk?
 *
 * One tree now. **`document_versions.storage_key` under `DATA_ROOT`** (the keys
 * themselves start with `files/`) is every byte the system holds. Versions are
 * immutable by design, so a mismatch here is not "an edit", it is corruption or
 * a wrong restore. Only versions that are *servable* (clean and published) are
 * fatal: a quarantined version's bytes were deleted on purpose.
 *
 * Until C5.4 this also walked `documents.storage_path` under `server/uploads`,
 * the tree the C2.1 import left in place. That column and that directory are
 * both gone — every byte they held was checked byte-identical to a published
 * version under DATA_ROOT before they went.
 *
 * This is what the restore drill runs to decide whether a restore actually
 * worked.
 *
 *   node scripts/integrity.mjs [--url ...] [--data-root <dir>] [--manifest <path>]
 *
 * Exit code 1 when a servable file is missing or hashes differently.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { argValue, databaseUrl, isMain, serverDir, sha256File } from './lib.mjs';

const norm = (p) => p.replace(/\\/g, '/');

/**
 * @param {{ url: string, dataRoot: string,
 *           manifest?: { files?: { entries?: { path: string, sha256: string }[] } } | null }} opts
 */
export async function checkIntegrity({ url, dataRoot, manifest = null }) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let versions;
  try {
    versions = (
      await client.query(
        `SELECT id, document_id, version_no, storage_key, size_bytes, sha256, scan_status,
                published_at IS NOT NULL AS published
           FROM document_versions ORDER BY created_at`
      )
    ).rows;
  } finally {
    await client.end();
  }

  const expectedFiles = new Map((manifest?.files?.entries ?? []).map((f) => [norm(f.path), f]));

  const missing = [];
  const mismatched = [];
  let checkedVersions = 0;

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


  const fatal = [...missing, ...mismatched].filter((p) => p.servable);

  return {
    ok: fatal.length === 0,
    dataRoot,
    versions: versions.length,
    checkedVersions,
    manifestEntries: expectedFiles.size,
    missing,
    mismatched,
    fatal,
  };
}

if (isMain(import.meta.url)) {
  try {
    const dataRoot = path.resolve(argValue('--data-root') || process.env.DATA_ROOT || path.join(serverDir, '.data'));
    const manifestPath = argValue('--manifest');
    // Tolerate a UTF-8 BOM: Windows PowerShell 5.1 adds one to files it writes as UTF8.
    const manifest = manifestPath ? JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/, '')) : null;
    const result = await checkIntegrity({ url: databaseUrl(), dataRoot, manifest });
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
