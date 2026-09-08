#!/usr/bin/env node
/**
 * Files under `DATA_ROOT/files` that no version row points at — and the only
 * sanctioned way to delete one.
 *
 * `npm run integrity` asks the question one way round: does every row's file
 * exist? This asks it the other: does every file have a row? The two failures
 * are completely different. A missing file is data loss and needs a restore; an
 * unreferenced file is *debris* — bytes that were committed to their final key
 * a moment before the transaction that would have recorded them failed, or
 * before the process died. The hourly sweeper has never covered `files/`,
 * deliberately: it cleans `staging/`, where nothing has ever been validated,
 * and `files/` is where the firm's documents live.
 *
 *   npm run files:orphans [-- --older-than 7d] [--delete] [--json]
 *
 * Default threshold is 24 h and the default is to report. `--delete` refuses a
 * threshold under 24 h: an upload that is seconds old may be mid-transaction on
 * another connection, and a client document deleted by a race is not
 * recoverable by anything short of last night's backup.
 *
 * Never touches `staging/`, never touches a referenced file, and prints every
 * deletion.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { argValue, databaseUrl, hasFlag, isMain, redact, serverDir } from './lib.mjs';

/** Storage keys are stored with forward slashes, whatever the platform. */
const norm = (p) => p.replace(/\\/g, '/');

const HOUR = 60 * 60 * 1000;
const DEFAULT_OLDER_THAN_MS = 24 * HOUR;
/** Below this, "unreferenced" and "still being written" are indistinguishable. */
const MIN_DELETE_AGE_MS = 24 * HOUR;

/** `30m`, `12h`, `7d`, or a bare number of hours. Returns ms, or null if unparseable. */
export function parseDuration(value) {
  if (value === undefined || value === null || value === '') return null;
  const m = /^(\d+(?:\.\d+)?)\s*([smhd]?)$/i.exec(String(value).trim());
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  const unit = (m[2] || 'h').toLowerCase();
  const scale = { s: 1000, m: 60 * 1000, h: HOUR, d: 24 * HOUR }[unit];
  return n * scale;
}

/** Every file under `<dataRoot>/files`, as storage keys relative to dataRoot. */
function walkFiles(dataRoot) {
  const root = path.join(dataRoot, 'files');
  if (!fs.existsSync(root)) return [];

  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        const stat = fs.statSync(full);
        out.push({ key: norm(path.relative(dataRoot, full)), abs: full, sizeBytes: stat.size, mtime: stat.mtime });
      }
    }
  }
  return out;
}

/**
 * @param {{ url: string, dataRoot: string, olderThanMs?: number, now?: Date }} opts
 */
export async function findOrphans({ url, dataRoot, olderThanMs = DEFAULT_OLDER_THAN_MS, now = new Date() }) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let referenced;
  try {
    const rows = await client.query('SELECT storage_key FROM document_versions');
    referenced = new Set(rows.rows.map((r) => norm(r.storage_key)));
  } finally {
    await client.end();
  }

  const files = walkFiles(dataRoot);
  const cutoff = now.getTime() - olderThanMs;

  const orphans = [];
  let tooRecent = 0;
  for (const file of files) {
    if (referenced.has(file.key)) continue;
    if (file.mtime.getTime() > cutoff) {
      // Unreferenced but young: quite possibly a transaction still open on
      // another connection. Counted, never listed for deletion.
      tooRecent += 1;
      continue;
    }
    orphans.push({ key: file.key, abs: file.abs, sizeBytes: file.sizeBytes, modifiedAt: file.mtime.toISOString() });
  }
  orphans.sort((a, b) => a.key.localeCompare(b.key));

  return {
    dataRoot,
    olderThanMs,
    scannedFiles: files.length,
    referencedRows: referenced.size,
    orphans,
    orphanBytes: orphans.reduce((n, o) => n + o.sizeBytes, 0),
    tooRecent,
  };
}

/** Deletes the listed orphans. Returns what actually went. */
export function deleteOrphans(orphans) {
  const deleted = [];
  const failed = [];
  for (const orphan of orphans) {
    try {
      fs.unlinkSync(orphan.abs);
      deleted.push(orphan.key);
    } catch (err) {
      failed.push({ key: orphan.key, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { deleted, failed };
}

const mb = (n) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

if (isMain(import.meta.url)) {
  const url = databaseUrl();
  const dataRoot = path.resolve(argValue('--data-root') || process.env.DATA_ROOT || path.join(serverDir, '.data'));
  const json = hasFlag('--json');
  const wantsDelete = hasFlag('--delete');

  const raw = argValue('--older-than');
  const olderThanMs = raw === undefined ? DEFAULT_OLDER_THAN_MS : parseDuration(raw);
  if (olderThanMs === null) {
    console.error(`--older-than: could not read "${raw}". Use 30m, 12h, 7d, or a number of hours.`);
    process.exit(2);
  }
  if (wantsDelete && olderThanMs < MIN_DELETE_AGE_MS) {
    console.error('--delete requires --older-than of at least 24h: a file minutes old may be mid-transaction.');
    process.exit(2);
  }

  const result = await findOrphans({ url, dataRoot, olderThanMs });
  const removal = wantsDelete ? deleteOrphans(result.orphans) : null;

  if (json) {
    console.log(JSON.stringify({ ...result, orphans: result.orphans.map(({ abs: _abs, ...o }) => o), removal }, null, 2));
  } else {
    console.log(`database:  ${redact(url)}`);
    console.log(`DATA_ROOT: ${dataRoot}`);
    console.log(`older than ${olderThanMs / HOUR}h`);
    console.log('');
    for (const o of result.orphans) {
      console.log(`  ORPHAN   ${o.key}  ${mb(o.sizeBytes)}  modified ${o.modifiedAt}`);
    }
    if (removal) {
      for (const key of removal.deleted) console.log(`  DELETED  ${key}`);
      for (const f of removal.failed) console.log(`  FAILED   ${f.key}  ${f.error}`);
    }
    console.log('');
    console.log(
      `${result.scannedFiles} file(s) under files/, ${result.referencedRows} referenced by a version row, ` +
        `${result.orphans.length} orphan(s) (${mb(result.orphanBytes)})` +
        (result.tooRecent > 0 ? `, ${result.tooRecent} too recent to judge` : '') +
        '.'
    );
    if (!wantsDelete && result.orphans.length > 0) {
      console.log('Run again with --delete (and --older-than at least 24h) to remove them.');
    }
  }

  // Orphans are a report, not a failure: exit 0 unless a deletion actually failed.
  process.exit(removal && removal.failed.length > 0 ? 1 : 0);
}
