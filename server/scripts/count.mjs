#!/usr/bin/env node
/**
 * Row counts for every application table, plus the number of documents that
 * have a stored file and the migration state. Printed as JSON; embedded in the
 * backup manifest and compared after a restore.
 *
 *   node scripts/count.mjs [--url postgres://...]
 */
import pg from 'pg';
import { databaseUrl, dbNameOf, isMain } from './lib.mjs';

export const TABLES = [
  'providers',
  'clients',
  'documents',
  'messages',
  'activities',
  'presets',
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

export async function countAll(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
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
    const withFile = await client.query(
      'SELECT COUNT(*)::int AS n FROM documents WHERE storage_path IS NOT NULL'
    );
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
      database: dbNameOf(url),
      tables,
      missingTables,
      documentsWithFile: withFile.rows[0].n,
      migrations,
      lastMigrationAt,
    };
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
