#!/usr/bin/env node
/**
 * The database half of a backup set, taken from **one exported snapshot** (H6).
 *
 * The problem this replaces: `backup.ps1` ran `pg_dump`, then copied the files,
 * then `manifest.mjs` asked the *live* database which files should exist. Three
 * different instants. An upload that committed between them put a row in the
 * manifest whose bytes were never copied — a backup that fails its own check
 * for no reason — and, worse, a version that was superseded in that window
 * could be described by a manifest that disagrees with the dump it sits beside.
 *
 * Postgres already has the answer. A `REPEATABLE READ` transaction that calls
 * `pg_export_snapshot()` hands its snapshot id to `pg_dump --snapshot`, and both
 * then read the same instant — with nobody paused and no writer blocked. The
 * same transaction lists every version and counts every table, and that list is
 * written beside the dump as `snapshot.json`. `manifest.mjs` reads it instead of
 * re-querying, so the set describes exactly the database the dump contains.
 *
 *   node scripts/backup-dump.mjs --set <backup-day-dir> [--url ...] [--started <iso>]
 *                                [--pg-bin <dir>] [--pg-dump <exe>]
 *
 * Exits non-zero if either half fails; a set without `snapshot.json` is one the
 * manifest will fall back to a live query for, and flag as such.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import pg from 'pg';
import { argValue, databaseUrl, dbNameOf, isMain, serverDir } from './lib.mjs';
import { countOn } from './count.mjs';
import { pgBinDir } from './status.mjs';

/** `pg_dump` as this machine can reach it: an explicit path, PG_BIN, or PATH. */
export function resolvePgDump(preferred = null) {
  if (preferred) return preferred;
  const dir = argValue('--pg-bin') || pgBinDir();
  const exe = process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump';
  if (dir && fs.existsSync(path.join(dir, exe))) return path.join(dir, exe);
  return exe; // PATH, and a clear ENOENT if it is not there.
}

/**
 * Open a read-only `REPEATABLE READ` transaction, export its snapshot, and run
 * `fn({ client, snapshotId })` inside it. The transaction is held open for as
 * long as `fn` runs — which is deliberate: an exported snapshot only survives
 * while its exporting transaction does.
 */
export async function withExportedSnapshot(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows } = await client.query('SELECT pg_export_snapshot() AS id');
    const snapshotId = rows[0].id;
    try {
      const result = await fn({ client, snapshotId });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  } finally {
    await client.end();
  }
}

/** Every version row, in the shape `snapshot.json` and the manifest both use. */
export async function readVersions(client) {
  const { rows } = await client.query(
    `SELECT id, document_id, version_no, storage_key, size_bytes, sha256, scan_status,
            published_at IS NOT NULL AS published
       FROM document_versions
      ORDER BY created_at`
  );
  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    versionNo: r.version_no,
    storageKey: r.storage_key,
    sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
    sha256: r.sha256,
    scanStatus: r.scan_status,
    published: r.published,
  }));
}

/**
 * The legacy `uploads/` tree, for as long as a database still has the column.
 * `0008_contract` drops it, and then this is simply an empty list — the same
 * shape, so nothing downstream needs to know which side of the contraction it
 * is on.
 */
export async function readLegacy(client) {
  const present = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'documents' AND column_name = 'storage_path'`
  );
  if (!present.rowCount) return { hasStoragePath: false, legacy: [] };
  const { rows } = await client.query(
    'SELECT id, storage_path, size_bytes FROM documents WHERE storage_path IS NOT NULL ORDER BY id'
  );
  return {
    hasStoragePath: true,
    legacy: rows.map((r) => ({ id: r.id, storagePath: r.storage_path, sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes) })),
  };
}

/** Versions, legacy rows and row counts — all from the caller's transaction. */
export async function readSnapshotData(client) {
  const versions = await readVersions(client);
  const { hasStoragePath, legacy } = await readLegacy(client);
  const counts = await countOn(client);
  return { versions, legacy, hasStoragePath, counts };
}

function runPgDump({ pgDump, url, snapshotId, dumpPath }) {
  const conn = new URL(url);
  const args = [
    '-Fc',
    `--snapshot=${snapshotId}`,
    '-h',
    conn.hostname,
    '-p',
    conn.port || '5432',
    '-U',
    decodeURIComponent(conn.username),
    '-d',
    dbNameOf(url),
    '-f',
    dumpPath,
  ];
  /* The password reaches the child and nothing else: never this process's
     environment, never an argument, never a log line. */
  const env = { ...process.env };
  if (conn.password) env.PGPASSWORD = decodeURIComponent(conn.password);
  else delete env.PGPASSWORD;

  return new Promise((resolve, reject) => {
    const child = spawn(pgDump, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => reject(new Error(`could not run ${pgDump}: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) return resolve({ stderr: stderr.trim() });
      reject(new Error(`pg_dump exited with ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
    });
  });
}

function pgDumpVersionOf(pgDump) {
  try {
    return execFileSync(pgDump, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/**
 * @param {{ setDir: string, url: string, startedAt?: string, pgDump?: string|null }} opts
 */
export async function backupDump({ setDir, url, startedAt, pgDump = null }) {
  const exe = resolvePgDump(pgDump);
  fs.mkdirSync(setDir, { recursive: true });
  const dumpPath = path.join(setDir, 'db.dump');

  return withExportedSnapshot(url, async ({ client, snapshotId }) => {
    /* Both halves read the same instant: pg_dump adopts the snapshot, this
       transaction already holds it. They run at the same time on purpose — the
       dump is the slow half, and the list costs a few milliseconds. */
    const dumping = runPgDump({ pgDump: exe, url, snapshotId, dumpPath });
    const data = await readSnapshotData(client);
    await dumping;

    const snapshot = {
      version: 1,
      snapshotId,
      exportedAt: new Date().toISOString(),
      startedAt: startedAt ?? new Date().toISOString(),
      database: dbNameOf(url),
      pgDumpVersion: pgDumpVersionOf(exe),
      counts: data.counts,
      hasStoragePath: data.hasStoragePath,
      versions: data.versions,
      legacy: data.legacy,
    };
    fs.writeFileSync(path.join(setDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2), 'utf8');

    const dumpBytes = fs.statSync(dumpPath).size;
    return {
      ok: true,
      setDir,
      dumpPath,
      dumpBytes,
      snapshotId,
      pgDumpVersion: snapshot.pgDumpVersion,
      versions: data.versions.length,
      legacy: data.legacy.length,
      counts: data.counts,
    };
  });
}

if (isMain(import.meta.url)) {
  try {
    const setDir = path.resolve(argValue('--set') || path.join(serverDir, '..', 'backup-set'));
    const url = databaseUrl();
    const result = await backupDump({
      setDir,
      url,
      startedAt: argValue('--started'),
      pgDump: argValue('--pg-dump') ?? null,
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    console.error(`backup dump failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}
