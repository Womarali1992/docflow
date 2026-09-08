#!/usr/bin/env node
/**
 * Writes `manifest.json` for a backup set (C5.2, manifest v3).
 *
 * The manifest is what makes a backup set *checkable*. It records the dump's
 * hash, the row counts the dump should restore to, and — the part that matters —
 * **every version's storage key with the size and sha256 the database believes
 * it has**, verified against the bytes actually copied into the set.
 *
 * It is written last, on purpose: a set with a manifest is a complete set, and
 * the restore drill compares against it.
 *
 * **Since H6 it does not ask the live database anything it can avoid.**
 * `backup-dump.mjs` exports one snapshot, hands it to `pg_dump`, and writes the
 * version list and row counts it read *inside that same transaction* to
 * `snapshot.json`. This script reads that file, so the manifest describes
 * exactly the database the dump contains. A set written before H6 has no
 * `snapshot.json`; it still works, from a live query, and says so —
 * `consistency: "live"` is the honest label for a list read at a different
 * instant from the dump beside it.
 *
 * **What is fatal.** Every version in the set whose scan status is not
 * `infected` must have its bytes there: a quarantined version's bytes were
 * deleted on purpose, anything else missing means this set cannot restore the
 * system. The one exception is the race the snapshot makes visible — a version
 * that was `pending` when the snapshot was taken and has since been quarantined.
 * Its bytes are gone for a good reason; it is recorded as
 * `quarantined_after_snapshot` and does not fail the run.
 *
 * It records the legacy `uploads/` tree too, for as long as a database still
 * has a `storage_path` column. `0008_contract` drops it, and then `uploads` is
 * simply an empty list — the same shape, so restore.ps1 does not need to know
 * which side of the contraction it is on.
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
import { readLegacy, readVersions } from './backup-dump.mjs';

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

/** Tolerate a UTF-8 BOM: Windows PowerShell 5.1 adds one to files it writes. */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

/** The version list the dump was taken with, or a live read of it. */
async function versionsForSet(setDir, url) {
  const snapshotPath = path.join(setDir, 'snapshot.json');
  if (fs.existsSync(snapshotPath)) {
    const snapshot = readJson(snapshotPath);
    return {
      consistency: 'snapshot',
      snapshotId: snapshot.snapshotId ?? null,
      versions: snapshot.versions ?? [],
      legacy: snapshot.legacy ?? [],
      counts: snapshot.counts ?? (await countAll(url)),
      pgDumpVersion: snapshot.pgDumpVersion ?? null,
    };
  }
  /* A set written before H6. The dump and this list come from two different
     instants, which is exactly the defect H6 fixes — so say so in the manifest
     rather than let a later reader assume otherwise. */
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const versions = await readVersions(client);
    const { legacy } = await readLegacy(client);
    return { consistency: 'live', snapshotId: null, versions, legacy, counts: await countAll(url), pgDumpVersion: null };
  } finally {
    await client.end();
  }
}

/**
 * Which of these version ids the live database now calls `infected`. Asked only
 * about versions whose bytes are missing from the set, and only when the list
 * came from a snapshot: quarantine deletes bytes, so a version that turned
 * infected after the snapshot was exported is the one legitimate reason for a
 * file to be absent from a set that was otherwise complete.
 */
async function infectedSince(url, ids) {
  if (ids.length === 0) return new Set();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT id FROM document_versions WHERE id = ANY($1::uuid[]) AND scan_status = 'infected'`,
      [ids]
    );
    return new Set(rows.map((r) => r.id));
  } finally {
    await client.end();
  }
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

  const source = await versionsForSet(setDir, url);

  const problems = [];
  const files = [];
  const missingVersions = [];
  let fileBytes = 0;

  for (const v of source.versions) {
    const rel = norm(v.storageKey);
    const abs = path.join(setDir, rel);
    if (!fs.existsSync(abs)) {
      missingVersions.push({ version: v, rel });
      continue;
    }
    const bytes = fs.statSync(abs).size;
    const sha = sha256File(abs);
    const servable = Boolean(v.published) && v.scanStatus === 'clean';
    if (v.sha256 && v.sha256 !== sha) {
      problems.push({ kind: 'sha256', storageKey: rel, versionId: v.id, expected: v.sha256, actual: sha, servable, fatal: true });
    } else if (v.sizeBytes !== null && Number(v.sizeBytes) !== bytes) {
      problems.push({ kind: 'size', storageKey: rel, versionId: v.id, expected: Number(v.sizeBytes), actual: bytes, servable, fatal: true });
    }
    files.push({ path: rel, bytes, sha256: sha, versionId: v.id, documentId: v.documentId, versionNo: v.versionNo });
    fileBytes += bytes;
  }

  /* Missing bytes. Infected in the snapshot: expected, the bytes were deleted
     when the version was quarantined. Infected only now: quarantined between
     the snapshot and this check — a race, not a hole. Anything else, including
     a version still waiting to be scanned, means the set is incomplete. */
  const quarantinedSince =
    source.consistency === 'snapshot'
      ? await infectedSince(
          url,
          missingVersions.filter((m) => m.version.scanStatus !== 'infected').map((m) => m.version.id)
        )
      : new Set();

  for (const { version: v, rel } of missingVersions) {
    const servable = Boolean(v.published) && v.scanStatus === 'clean';
    if (v.scanStatus === 'infected') {
      problems.push({ kind: 'missing', storageKey: rel, versionId: v.id, scanStatus: v.scanStatus, servable, fatal: false });
    } else if (quarantinedSince.has(v.id)) {
      problems.push({ kind: 'quarantined_after_snapshot', storageKey: rel, versionId: v.id, scanStatus: v.scanStatus, servable, fatal: false });
    } else {
      problems.push({ kind: 'missing', storageKey: rel, versionId: v.id, scanStatus: v.scanStatus, servable, fatal: true });
    }
  }

  /* Legacy tree. Empty on a contracted database and on any set taken after the
     tree was deleted — `uploads` then stays an empty array rather than
     disappearing, so restore.ps1 reads the same shape either way. */
  const uploads = [];
  let uploadBytes = 0;
  for (const rel of walk(uploadsDir)) {
    const abs = path.join(uploadsDir, rel);
    const bytes = fs.statSync(abs).size;
    uploads.push({ path: rel, bytes, sha256: sha256File(abs) });
    uploadBytes += bytes;
  }
  /* A row still pointing at a legacy file the set does not contain. Fatal for
     the same reason a missing version is: this set cannot restore the system as
     it currently stands. */
  const legacyMissing = source.legacy
    .map((d) => norm(d.storagePath))
    .filter((rel) => !fs.existsSync(path.join(uploadsDir, rel)));
  for (const rel of legacyMissing) {
    problems.push({ kind: 'missing', storageKey: rel, versionId: null, legacy: true, servable: true, fatal: true });
  }

  const dumpBytes = fs.statSync(dumpPath).size;

  const manifest = {
    version: 3,
    createdAt: new Date().toISOString(),
    startedAt: startedAt ?? new Date().toISOString(),
    host: process.env.COMPUTERNAME || process.env.HOSTNAME || null,
    database: dbNameOf(url),
    /* Whether the dump and this list came from one instant. `snapshot` is what
       H6 produces; `live` is a set from before it, or one dumped by hand. */
    consistency: source.consistency,
    snapshotId: source.snapshotId,
    /* Which pg_dump wrote it: restoring a 17 dump with a 16 pg_restore fails,
       and the drill should be able to say so rather than guess. */
    pgDumpVersion: pgDumpVersion ?? source.pgDumpVersion,
    dump: { file: 'db.dump', bytes: dumpBytes, sha256: sha256File(dumpPath) },
    counts: source.counts,
    files: { count: files.length, bytes: fileBytes, entries: files },
    /* Legacy tree — present and empty once there is nothing left to carry. */
    uploads,
    uploadCount: uploads.length,
    uploadBytes,
    legacyMissing,
    problems,
  };

  const out = path.join(setDir, 'manifest.json');
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2), 'utf8');

  const fatal = problems.filter((p) => p.fatal);
  return {
    ok: fatal.length === 0,
    manifestPath: out,
    consistency: source.consistency,
    snapshotId: source.snapshotId,
    fileCount: files.length,
    fileBytes,
    dumpBytes,
    problems,
    fatal,
  };
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
      console.error(`manifest: ${result.fatal.length} file(s) missing or mismatched — this set is NOT restorable`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`manifest failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}
