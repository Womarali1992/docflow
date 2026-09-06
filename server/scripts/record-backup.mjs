#!/usr/bin/env node
/**
 * Records a backup run in `backup_runs` (C5.2).
 *
 * The row exists so the ops panel can answer the only backup question that
 * matters day to day — *when did one last work?* — without anyone opening a
 * folder on a drive. A failed run is recorded too, with its error: a backup
 * that silently stopped happening is the failure mode this table exists to
 * prevent.
 *
 *   node scripts/record-backup.mjs --started <iso> [--ok] [--manifest <path>]
 *                                  [--dump-bytes N] [--file-count N] [--error "..."]
 */
import fs from 'node:fs';
import pg from 'pg';
import { argValue, databaseUrl, hasFlag, isMain } from './lib.mjs';

/**
 * @param {{ url: string, startedAt: Date, ok: boolean, manifestPath?: string|null,
 *           dumpBytes?: number|null, fileCount?: number|null, error?: string|null }} opts
 */
export async function recordBackup({ url, startedAt, ok, manifestPath = null, dumpBytes = null, fileCount = null, error = null }) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      `INSERT INTO backup_runs (started_at, finished_at, ok, dump_bytes, file_count, manifest_path, error)
       VALUES ($1, now(), $2, $3, $4, $5, $6)
       RETURNING id, started_at, finished_at, ok`,
      [startedAt.toISOString(), ok, dumpBytes, fileCount, manifestPath, error]
    );

    // Also in the append-only log, so "when was this system last backed up?"
    // has an answer that nothing in the app can rewrite.
    await client.query(
      `INSERT INTO audit_log (action, target_type, target_id, actor_kind, meta)
       VALUES ('backup.run', 'backup', $1, 'system', $2)`,
      [rows[0].id, JSON.stringify({ ok, fileCount, dumpBytes, error })]
    );
    return rows[0];
  } finally {
    await client.end();
  }
}

if (isMain(import.meta.url)) {
  try {
    const startedRaw = argValue('--started');
    const startedAt = startedRaw ? new Date(startedRaw) : new Date();
    if (Number.isNaN(startedAt.getTime())) throw new Error(`--started is not a date: ${startedRaw}`);

    const manifestPath = argValue('--manifest') ?? null;
    let dumpBytes = argValue('--dump-bytes') ? Number(argValue('--dump-bytes')) : null;
    let fileCount = argValue('--file-count') ? Number(argValue('--file-count')) : null;

    // The manifest already knows both numbers; reading them here keeps the
    // caller from having to pass what it just wrote.
    if (manifestPath && fs.existsSync(manifestPath) && (dumpBytes === null || fileCount === null)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/, ''));
      dumpBytes = dumpBytes ?? manifest?.dump?.bytes ?? null;
      fileCount = fileCount ?? manifest?.files?.count ?? null;
    }

    const row = await recordBackup({
      url: databaseUrl(),
      startedAt,
      ok: hasFlag('--ok'),
      manifestPath,
      dumpBytes,
      fileCount,
      error: argValue('--error') ?? null,
    });
    process.stdout.write(JSON.stringify(row, null, 2) + '\n');
  } catch (err) {
    // Never fail the backup because the bookkeeping failed.
    console.error(`record-backup failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}
