/**
 * Hourly cleanup of uploads that never finished.
 *
 * Two kinds of debris, and the sweeper is the backstop for both — not the
 * mechanism. Every error path in the pipeline already deletes its own staged
 * file; this catches what a crash or a killed process left behind.
 *
 *   1. Staged `.part` files older than an hour. Nothing legitimate takes an hour
 *      between arriving and being published, so an old one is abandoned.
 *   2. Versions still unpublished after an hour — the process died between
 *      storing the bytes and getting a verdict. They become `error` so the ops
 *      panel shows them and a person can decide.
 *
 * It NEVER touches anything under `files/` that a version row points at
 * (invariant 2: published bytes are immutable). The only bytes it deletes are
 * staged ones, which by definition were never published.
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { db, schema } from '../../db/client.js';
import type { Job } from '../../db/schema.js';
import { discardStaged, stagingDir } from '../../files/store.js';

/** How long an upload may sit unfinished before it is assumed abandoned. */
export const STALE_AFTER_MS = 60 * 60 * 1000;

export interface SweepResult {
  stagedRemoved: number;
  versionsFlagged: number;
}

export async function sweepOnce(now = new Date()): Promise<SweepResult> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  let stagedRemoved = 0;

  /* 1. Abandoned staged files. */
  const dir = stagingDir();
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.part')) continue;
      const abs = path.join(dir, entry);
      try {
        const stat = fs.statSync(abs);
        if (stat.mtimeMs < cutoff.getTime()) {
          discardStaged(abs);
          stagedRemoved++;
        }
      } catch {
        // Vanished between readdir and stat — someone else's problem, already solved.
      }
    }
  }

  /* 2. Versions that never got a verdict. */
  const stranded = await db
    .update(schema.documentVersions)
    .set({
      scanStatus: 'error',
      scanDetail: 'No verdict was recorded within an hour of upload; the upload did not finish.',
    })
    .where(
      and(
        isNull(schema.documentVersions.publishedAt),
        eq(schema.documentVersions.scanStatus, 'pending'),
        lt(schema.documentVersions.createdAt, cutoff)
      )
    )
    .returning({ id: schema.documentVersions.id });

  return { stagedRemoved, versionsFlagged: stranded.length };
}

export async function sweeperJob(job: Job): Promise<void> {
  const result = await sweepOnce();
  if (result.stagedRemoved || result.versionsFlagged) {
    console.log(
      `[worker] sweeper ${job.id}: removed ${result.stagedRemoved} abandoned staged file(s), flagged ${result.versionsFlagged} unfinished version(s)`
    );
  }
}

export default sweeperJob;
