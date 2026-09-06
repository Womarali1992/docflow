#!/usr/bin/env node
/**
 * The last backup, for `verify.ps1` (C5.3).
 *
 * `GET /ops/status` answers the same question, but it needs an advisor session
 * — and a verification script that has to log in is a verification script
 * nobody runs. This reads the row directly.
 *
 *   node scripts/last-backup.mjs [--url ...]
 */
import pg from 'pg';
import { databaseUrl, isMain } from './lib.mjs';

export async function lastBackup(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT started_at, ok, file_count, dump_bytes, error
         FROM backup_runs ORDER BY started_at DESC LIMIT 20`
    );
    const lastRun = rows[0] ?? null;
    const lastGood = rows.find((r) => r.ok) ?? null;
    return {
      lastRunAt: lastRun ? lastRun.started_at.toISOString() : null,
      lastRunOk: lastRun ? lastRun.ok : null,
      lastRunError: lastRun && !lastRun.ok ? lastRun.error : null,
      lastGoodAt: lastGood ? lastGood.started_at.toISOString() : null,
      lastGoodFiles: lastGood ? lastGood.file_count : null,
      lastGoodDumpBytes: lastGood ? lastGood.dump_bytes : null,
    };
  } finally {
    await client.end();
  }
}

if (isMain(import.meta.url)) {
  try {
    process.stdout.write(JSON.stringify(await lastBackup(databaseUrl()), null, 2) + '\n');
  } catch (err) {
    console.error(`last-backup failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}
