#!/usr/bin/env node
/**
 * Row counts for every application table, plus the number of documents that
 * have a stored file and the migration state. Printed as JSON; embedded in the
 * backup manifest and compared after a restore.
 *
 *   node scripts/count.mjs [--url postgres://...]
 */
import pg from 'pg';
import { databaseUrl, isMain } from './lib.mjs';

export const TABLES = [
  'providers',
  'clients',
  'documents',
  'messages',
  'activities',
  'sessions',
  'mfa_totp',
  'recovery_codes',
  'invitations',
  'password_resets',
  'jobs',
  'engagements',
  'requests',
  'document_versions',
  'reviews',
  'request_templates',
  'notifications',
  'audit_log',
  'backup_runs',
];

/**
 * The counts, taken on a connection the caller already owns — so a backup can
 * count inside the very transaction whose snapshot pg_dump is reading (H6).
 * Every query here is a plain read; all it needs from its transaction is that
 * transaction's snapshot, which is the whole point.
 */
export async function countOn(client) {
  // Count only what this database actually has. A backup set taken before a
  // migration is restored on the older schema, and the restore drill must still
  // be able to verify it — a newer table missing there is expected, not a fault.
  const present = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name = ANY($1)`,
    [TABLES]
  );
  const have = new Set(present.rows.map((r) => r.table_name));
  const tables = {};
  const missingTables = [];
  for (const t of TABLES) {
    if (!have.has(t)) {
      missingTables.push(t);
      continue;
    }
    const r = await client.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    tables[t] = r.rows[0].n;
  }
  /* Documents with bytes to serve. This read `storage_path IS NOT NULL` until
     C5.4 dropped that column; a version is where bytes live now. Tolerated
     rather than assumed, for the same reason `missingTables` is: this runs
     against restored older backup sets, whose schema is whatever it was. */
  let withFile = null;
  try {
    withFile = (
      await client.query('SELECT COUNT(*)::int AS n FROM documents WHERE current_version_id IS NOT NULL')
    ).rows[0].n;
  } catch {
    // Older set: no current_version_id column. Report null, not a crash.
  }
  let migrations = 0;
  let lastMigrationAt = null;
  try {
    const m = await client.query(
      'SELECT COUNT(*)::int AS n, MAX(created_at)::text AS last FROM drizzle.__drizzle_migrations'
    );
    migrations = m.rows[0].n;
    lastMigrationAt = m.rows[0].last === null ? null : Number(m.rows[0].last);
  } catch {
    // No migrations table (empty database): leave zeros.
  }
  return {
    database: (await client.query('SELECT current_database() AS name')).rows[0].name,
    tables,
    missingTables,
    documentsWithFile: withFile,
    migrations,
    lastMigrationAt,
  };
}

export async function countAll(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await countOn(client);
  } finally {
    await client.end();
  }
}

if (isMain(import.meta.url)) {
  try {
    const result = await countAll(databaseUrl());
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    console.error(`count failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}
