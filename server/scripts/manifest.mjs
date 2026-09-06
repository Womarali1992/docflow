#!/usr/bin/env node
/**
 * Writes `manifest.json` for a backup set (C5.2, manifest v2).
 *
 * The manifest is what makes a backup set *checkable*. It records the dump's
 * hash, the row counts the dump should restore to, and — the part that matters —
 * **every published version's storage key with the size and sha256 the database
 * believes it has**, verified against the bytes actually copied into the set.
 *
 * It is written last, on purpose: a set with a manifest is a complete set. The
 * legacy import (C2.1) refuses to run without one less than 24 hours old, and
 * the restore drill compares against it.
 *
 *   node scripts/manifest.mjs --set <backup-day-dir> [--url ...] [--started <iso>]
 *                              [--pg-dump-version "pg_dump (PostgreSQL) 17.6"]
 *
 * Exits 1 if a file the database expects is missing or does not hash as
 * recorded — a backup that cannot be verified is not a backup.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { argValue, databaseUrl, dbNameOf, isMain, serverDir, sha256File } from './lib.mjs';
import { countAll } from './count.mjs';

const norm = (p) => p.replace(/\\/g, '/');

/** Every file under a directory, as paths relative to it. */
function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, base, out);
    else out.push(norm(path.relative(base, abs)));
  }
  return out;
}

/**
 * @param {{ setDir: string, url: string, startedAt?: string, pgDumpVersion?: string }} opts
 */
export async function buildManifest({ setDir, url, startedAt, pgDumpVersion = null }) {
  const dumpPath = path.join(setDir, 'db.dump');
  if (!fs.existsSync(dumpPath)) throw new Error(`No db.dump in ${setDir} — run the dump first`);

  /* Storage keys already start with `files/`, so the set directory itself is
     the root they resolve against — the same shape as DATA_ROOT. */
  const uploadsDir = path.join(setDir, 'uploads');

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let versions;
  let legacy;
  try {
    versions = (
      await client.query(
        `SELECT v.id, v.document_id, v.version_no, v.storage_key, v.size_bytes, v.sha256, v.scan_status,
                v.published_at IS NOT NULL AS published
           FROM document_versions v
          ORDER BY v.created_at`
      )
    ).rows;
    legacy = (
      await client.query('SELECT id, storage_path, size_bytes FROM documents WHERE storage_path IS NOT NULL ORDER BY id')
    ).rows;
  } finally {
    await client.end();
  }

  const problems = [];
  const files = [];
  let fileBytes = 0;

  for (const v of versions) {
    const rel = norm(v.storage_key);
    const abs = path.join(setDir, rel);
    if (!fs.existsSync(abs)) {
      // Only a published, clean version is servable; anything else missing is
      // noted but does not fail the set (it may have been quarantined).
      problems.push({ kind: 'missing', storageKey: rel, versionId: v.id, servable: v.published && v.scan_status === 'clean' });
      continue;
    }
    const bytes = fs.statSync(abs).size;
    const sha = sha256File(abs);
    if (v.sha256 && v.sha256 !== sha) {
      problems.push({ kind: 'sha256', storageKey: rel, versionId: v.id, expected: v.sha256, actual: sha, servable: true });
    } else if (v.size_bytes !== null && Number(v.size_bytes) !== bytes) {
      problems.push({ kind: 'size', storageKey: rel, versionId: v.id, expected: Number(v.size_bytes), actual: bytes, servable: true });
    }
    files.push({ path: rel, bytes, sha256: sha, versionId: v.id, documentId: v.document_id, versionNo: v.version_no });
    fileBytes += bytes;
  }

  const uploads = [];
  let uploadBytes = 0;
  for (const rel of walk(uploadsDir)) {
    const abs = path.join(uploadsDir, rel);
    const bytes = fs.statSync(abs).size;
    uploads.push({ path: rel, bytes, sha256: sha256File(abs) });
    uploadBytes += bytes;
  }
  const legacyMissing = legacy
    .map((d) => norm(d.storage_path))
    .filter((rel) => !fs.existsSync(path.join(uploadsDir, rel)));

  const counts = await countAll(url);
  const dumpBytes = fs.statSync(dumpPath).size;

  const manifest = {
    version: 2,
    createdAt: new Date().toISOString(),
    startedAt: startedAt ?? new Date().toISOString(),
    host: process.env.COMPUTERNAME || process.env.HOSTNAME || null,
    database: dbNameOf(url),
    /* Which pg_dump wrote it: restoring a 17 dump with a 16 pg_restore fails,
       and the drill should be able to say so rather than guess. */
    pgDumpVersion,
    dump: { file: 'db.dump', bytes: dumpBytes, sha256: sha256File(dumpPath) },
    counts,
    files: { count: files.length, bytes: fileBytes, entries: files },
    /* Legacy tree, still carried until C5.4 removes server/uploads. */
    uploads: uploads,
    uploadCount: uploads.length,
    uploadBytes,
    legacyMissing,
    problems,
  };

  const out = path.join(setDir, 'manifest.json');
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2), 'utf8');

  // A file the database says is servable but the set does not contain (or does
  // not hash as recorded) means this set cannot restore the system as it is.
  const fatal = problems.filter((p) => p.servable);
  return { ok: fatal.length === 0, manifestPath: out, fileCount: files.length, fileBytes, dumpBytes, problems, fatal };
}

if (isMain(import.meta.url)) {
  try {
    const setDir = path.resolve(argValue('--set') || path.join(serverDir, '..', 'backup-set'));
    const result = await buildManifest({
      setDir,
      url: databaseUrl(),
      startedAt: argValue('--started'),
      pgDumpVersion: argValue('--pg-dump-version') ?? null,
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.ok) {
      console.error(`manifest: ${result.fatal.length} servable file(s) missing or mismatched — this set is NOT restorable`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`manifest failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}
