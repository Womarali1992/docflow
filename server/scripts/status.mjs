#!/usr/bin/env node
/**
 * What exactly is running here?
 *
 * The 2026-09-07 audit spent a page reconstructing this by hand — which commit
 * is checked out, whether the tree is dirty, how many migrations the database
 * has taken and which are still pending, where DATA_ROOT points and whether it
 * is (wrongly) inside the checkout, whether a scanner answers, when the last
 * backup ran, whether mail is configured. Every one of those is a question with
 * an exact answer, and reconstructing them by hand is how a deployment drifts
 * without anybody noticing.
 *
 *   node scripts/status.mjs                # JSON on stdout
 *   node scripts/status.mjs --url ...      # a different database
 *   node scripts/status.mjs --tests f.json # fold in a CI test-totals artifact
 *
 * Nothing here prints a secret: the database URL is redacted, the SMTP password
 * is never read out of the URL, and no client, document or filename appears.
 * That is what makes it safe to paste into an issue.
 *
 * It is also deliberately forgiving. A database that will not answer, a missing
 * pg_dump, a scanner that is not installed — each becomes a field saying so,
 * not a crash, because the moment this is most needed is the moment something
 * is already broken.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { argValue, databaseUrl, dbNameOf, isMain, redact, serverDir } from './lib.mjs';

export const repoRoot = path.resolve(serverDir, '..');

/* ------------------------------------------------------------------ the repo */

function git(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function repo() {
  const commit = git(['rev-parse', 'HEAD']);
  if (!commit) return { commit: null, note: 'not a git checkout, or git is not on PATH' };
  const porcelain = git(['status', '--porcelain']);
  const changed = porcelain ? porcelain.split(/\r?\n/).filter(Boolean) : [];
  return {
    commit,
    short: commit.slice(0, 7),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    subject: git(['log', '-1', '--format=%s']),
    committedAt: git(['log', '-1', '--format=%cI']),
    dirty: changed.length > 0,
    // The count, not the names: a path can carry a client's name.
    dirtyFiles: changed.length,
  };
}

/* ------------------------------------------------------------- the toolchain */

/** Where pg_dump lives on Windows: PG_BIN, else the newest Program Files install. */
export function pgBinDir() {
  const configured = process.env.PG_BIN;
  if (configured) return configured;
  const base = 'C:\\Program Files\\PostgreSQL';
  try {
    const versions = fs
      .readdirSync(base)
      .filter((name) => /^\d+$/.test(name))
      .sort((a, b) => Number(b) - Number(a));
    for (const v of versions) {
      const bin = path.join(base, v, 'bin');
      if (fs.existsSync(path.join(bin, 'pg_dump.exe'))) return bin;
    }
  } catch {
    // Not Windows, or no install: fall through to PATH.
  }
  return null;
}

function toolVersion(exe) {
  const dir = pgBinDir();
  const candidates = dir ? [path.join(dir, exe), exe] : [exe];
  for (const cmd of candidates) {
    try {
      return execFileSync(cmd, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/* -------------------------------------------------------------- the database */

/** The migration tags in the journal, in order — the full set the code expects. */
export function journalEntries() {
  const file = path.join(serverDir, 'migrations', 'meta', '_journal.json');
  try {
    const journal = JSON.parse(fs.readFileSync(file, 'utf8'));
    return journal.entries.map((e) => ({ tag: e.tag, when: Number(e.when) }));
  } catch {
    return [];
  }
}

/**
 * Which migrations this database has taken, and which it has not.
 *
 * drizzle records `created_at` = the journal entry's `when`, so the two line up
 * exactly; anything in the journal without a matching row is pending. That is
 * the number `verify.ps1` and the release checks care about, and until now the
 * only way to get it was to read the table and the journal side by side.
 */
export async function migrationState(client) {
  const entries = journalEntries();
  let applied = [];
  try {
    const { rows } = await client.query('SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at');
    applied = rows.map((r) => Number(r.created_at));
  } catch {
    // No migrations table: an empty database. Everything is pending.
    return { appliedCount: 0, last: null, applied: [], pending: entries.map((e) => e.tag), unknown: 0 };
  }
  const appliedSet = new Set(applied);
  const known = new Set(entries.map((e) => e.when));
  const appliedTags = entries.filter((e) => appliedSet.has(e.when)).map((e) => e.tag);
  return {
    appliedCount: applied.length,
    last: appliedTags.length ? appliedTags[appliedTags.length - 1] : null,
    applied: appliedTags,
    pending: entries.filter((e) => !appliedSet.has(e.when)).map((e) => e.tag),
    // Rows the journal cannot explain: this checkout is older than the database.
    unknown: applied.filter((ms) => !known.has(ms)).length,
  };
}

async function database(url) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  const out = { name: dbNameOf(url), url: redact(url), reachable: false };
  try {
    await client.connect();
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
    return { database: out, migrations: null, backup: null, work: null };
  }
  try {
    out.reachable = true;
    out.serverVersion = (await client.query('SHOW server_version')).rows[0].server_version;
    return {
      database: out,
      migrations: await migrationState(client),
      backup: await lastBackupRun(client),
      work: await workState(client),
    };
  } finally {
    await client.end();
  }
}

async function lastBackupRun(client) {
  try {
    const { rows } = await client.query(
      'SELECT started_at, ok, file_count, dump_bytes, error FROM backup_runs ORDER BY started_at DESC LIMIT 20'
    );
    const last = rows[0] ?? null;
    const good = rows.find((r) => r.ok) ?? null;
    return {
      lastRunAt: last ? last.started_at.toISOString() : null,
      lastRunOk: last ? last.ok : null,
      lastRunError: last && !last.ok ? last.error : null,
      lastGoodAt: good ? good.started_at.toISOString() : null,
      lastGoodFiles: good ? good.file_count : null,
      lastGoodDumpBytes: good ? Number(good.dump_bytes) : null,
      // H6 adds snapshot-consistent backups; until then a set is 'legacy'.
      ageHours: good ? Math.round(((Date.now() - good.started_at.getTime()) / 3_600_000) * 10) / 10 : null,
    };
  } catch {
    return null;
  }
}

/** Counts only — nothing here names a client, a document or a file. */
async function workState(client) {
  const one = async (sql) => {
    try {
      return Number((await client.query(sql)).rows[0].n);
    } catch {
      return null;
    }
  };
  return {
    documentVersions: await one('SELECT COUNT(*)::int AS n FROM document_versions'),
    unpublishedVersions: await one(
      "SELECT COUNT(*)::int AS n FROM document_versions WHERE scan_status IN ('pending','error')"
    ),
    quarantined: await one("SELECT COUNT(*)::int AS n FROM document_versions WHERE scan_status = 'infected'"),
    // Same definition queue.ts queueStats() uses: there is no status column,
    // an unfinished job is pending until its attempts run out, then failed.
    jobsPending: await one('SELECT COUNT(*)::int AS n FROM jobs WHERE done_at IS NULL AND attempts < max_attempts'),
    jobsFailed: await one('SELECT COUNT(*)::int AS n FROM jobs WHERE done_at IS NULL AND attempts >= max_attempts'),
    activeSessions: await one('SELECT COUNT(*)::int AS n FROM sessions WHERE expires_at > now()'),
  };
}

/* ------------------------------------------------------------- the scanner */

/** clamd's own PING, spoken directly: the scripts cannot import the TypeScript. */
export async function pingClamd(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => socket.write('zPING\0'));
    socket.on('data', (chunk) => finish(chunk.toString('latin1').includes('PONG')));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
  });
}

async function scanner() {
  const host = process.env.CLAMD_HOST || '127.0.0.1';
  const port = Number.parseInt(process.env.CLAMD_PORT || '3310', 10) || 3310;
  // Mirrors scan.ts scanRequired(): production always requires a scan.
  const required = process.env.NODE_ENV === 'production' ? true : process.env.SCAN_REQUIRED !== 'false';
  return { required, endpoint: `${host}:${port}`, reachable: await pingClamd(host, port) };
}

/* ------------------------------------------------------------- the storage */

async function storage() {
  // Mirrors store.ts dataRoot(); a missing DATA_ROOT in production is itself the finding.
  const configured = process.env.DATA_ROOT;
  const root = configured ? path.resolve(configured) : path.resolve(serverDir, '.data');
  const rel = path.relative(repoRoot, root);
  const out = {
    dataRoot: root,
    configured: Boolean(configured),
    // Documents inside the checkout are one `git clean` away from gone, and get
    // copied into OneDrive on this laptop. Production must never look like this.
    insideCheckout: rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel),
    exists: fs.existsSync(root),
    freeBytes: null,
    totalBytes: null,
  };
  try {
    const stats = await fs.promises.statfs(root);
    out.freeBytes = Number(stats.bavail) * Number(stats.bsize);
    out.totalBytes = Number(stats.blocks) * Number(stats.bsize);
  } catch {
    // A path that is not there yet has no free space to report.
  }
  return out;
}

/* ---------------------------------------------------------------- the mail */

/** Configured or not, and where to — never the password. */
function smtp() {
  const url = process.env.SMTP_URL;
  if (!url) return { configured: false, host: null, from: process.env.MAIL_FROM || null };
  try {
    const u = new URL(url);
    return {
      configured: true,
      host: `${u.hostname}:${u.port || '(default)'}`,
      // The account, not the credential. A username is an address the advisor already knows.
      user: decodeURIComponent(u.username || '') || null,
      from: process.env.MAIL_FROM || null,
    };
  } catch {
    return { configured: true, host: null, from: process.env.MAIL_FROM || null, error: 'SMTP_URL does not parse as a URL' };
  }
}

/* --------------------------------------------------------------- the tests */

/**
 * Test totals from a CI artifact, when there is one. H8's workflow writes it;
 * before that this is null, which is the honest answer to "did the suite pass
 * on something other than this laptop".
 */
function tests(explicitPath) {
  const file = explicitPath ? path.resolve(explicitPath) : path.join(repoRoot, '.ci', 'test-totals.json');
  try {
    return { source: file, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */

export async function collectStatus(options = {}) {
  const url = options.url || databaseUrl();
  const db = await database(url);
  return {
    at: new Date().toISOString(),
    node: process.version,
    env: process.env.NODE_ENV || 'development',
    repo: repo(),
    tools: { pgDump: toolVersion('pg_dump'), psql: toolVersion('psql'), pgBin: pgBinDir() },
    database: db.database,
    migrations: db.migrations,
    work: db.work,
    scanner: await scanner(),
    storage: await storage(),
    backup: db.backup,
    smtp: smtp(),
    tests: tests(options.testsPath ?? argValue('--tests')),
  };
}

if (isMain(import.meta.url)) {
  try {
    process.stdout.write(JSON.stringify(await collectStatus(), null, 2) + '\n');
  } catch (err) {
    console.error(`status failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}
