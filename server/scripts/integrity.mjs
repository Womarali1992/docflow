#!/usr/bin/env node
/**
 * Checks that every document with a stored file actually has that file on disk,
 * that its size matches the database, and — when a backup manifest is given —
 * that its sha256 matches the manifest. Used by the restore drill and, later,
 * by the nightly backup verification.
 *
 *   node scripts/integrity.mjs [--url postgres://...] [--uploads <dir>] [--manifest <manifest.json>]
 *
 * Exit code 1 when anything is missing or mismatched.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { argValue, databaseUrl, isMain, serverDir, sha256File } from './lib.mjs';

const normalize = (p) => p.replace(/\\/g, '/');

/**
 * @param {{ url: string, uploadsDir: string, manifest?: { uploads?: { path: string, sha256: string, bytes?: number }[] } | null }} opts
 */
export async function checkIntegrity({ url, uploadsDir, manifest = null }) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let rows;
  try {
    rows = (
      await client.query(
        'SELECT id, name, storage_path, size_bytes FROM documents WHERE storage_path IS NOT NULL ORDER BY id'
      )
    ).rows;
  } finally {
    await client.end();
  }

  const expected = new Map((manifest?.uploads ?? []).map((u) => [normalize(u.path), u]));
  const missing = [];
  const mismatched = [];
  let checked = 0;

  for (const r of rows) {
    const rel = normalize(r.storage_path);
    const abs = path.join(uploadsDir, rel);
    if (!fs.existsSync(abs)) {
      missing.push({ id: r.id, name: r.name, path: rel });
      continue;
    }
    const size = fs.statSync(abs).size;
    const sha = sha256File(abs);
    const exp = expected.get(rel);
    if (exp && exp.sha256 !== sha) {
      mismatched.push({ id: r.id, path: rel, reason: 'sha256 differs from the manifest' });
    } else if (r.size_bytes !== null && r.size_bytes !== size) {
      mismatched.push({ id: r.id, path: rel, reason: `size on disk ${size} != database ${r.size_bytes}` });
    }
    checked++;
  }

  return {
    ok: missing.length === 0 && mismatched.length === 0,
    uploadsDir,
    documentsWithFile: rows.length,
    checked,
    manifestEntries: expected.size,
    missing,
    mismatched,
  };
}

if (isMain(import.meta.url)) {
  try {
    const uploadsDir = path.resolve(argValue('--uploads') || process.env.UPLOADS_DIR || path.join(serverDir, 'uploads'));
    const manifestPath = argValue('--manifest');
    // Tolerate a UTF-8 BOM: Windows PowerShell 5.1 adds one to files it writes as UTF8.
    const manifest = manifestPath ? JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/, '')) : null;
    const result = await checkIntegrity({ url: databaseUrl(), uploadsDir, manifest });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.ok) process.exitCode = 1;
  } catch (err) {
    console.error(`integrity check failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}
