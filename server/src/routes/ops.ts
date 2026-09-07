/**
 * Operational status for the advisor — the `/settings/system` panel (C5.2).
 *
 * One screen that answers the questions an operator of a single firm PC
 * actually has, in the order they matter:
 *
 *   Did the backup run?      — the only one that cannot be recovered from later.
 *   Is the scanner working?  — while it is down, uploads arrive but stay closed.
 *   Is the disk filling?     — the failure that takes everything else with it.
 *   Is anything stuck?       — failed jobs, and versions that never published.
 *   Who is signed in?        — sessions, so a forgotten one can be noticed.
 *
 * Advisor-only: a client has no business knowing the firm's disk usage. Nothing
 * here names a document or a client — it is counts and timestamps, so the panel
 * can be left open on a screen in a shared office.
 */
import fs from 'node:fs';
import { asyncRouter } from './async-router.js';
import { and, count, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { authenticate, requireProvider } from '../middleware/auth.js';
import { queueStats } from '../jobs/queue.js';
import { isMailConfigured } from '../jobs/mail.js';
import { clamdHost, clamdPort, ping, scanRequired, signatureDate, version } from '../files/scan.js';
import { dataRoot } from '../files/store.js';
import { firmTimezone } from '../jobs/schedule.js';

const router = asyncRouter();

router.use(authenticate);

/** Free and total bytes on the volume that holds the documents. */
async function storage(): Promise<{ path: string; freeBytes: number | null; totalBytes: number | null; note: string | null }> {
  const root = dataRoot();
  try {
    const stats = await fs.promises.statfs(root);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeRatio = totalBytes > 0 ? freeBytes / totalBytes : 1;
    return {
      path: root,
      freeBytes,
      totalBytes,
      // A disk that fills stops uploads, backups and Postgres itself, in that
      // order and without warning. 10% is late but still actionable.
      note: freeRatio < 0.1 ? 'Less than 10% of this volume is free. Clear space or move the backups off it.' : null,
    };
  } catch {
    return { path: root, freeBytes: null, totalBytes: null, note: 'Could not read the disk usage for this volume.' };
  }
}

/** How the scanner is, and how old what it knows is. */
async function scanner() {
  if (!scanRequired()) {
    return {
      required: false,
      reachable: false,
      endpoint: `${clamdHost()}:${clamdPort()}`,
      signaturesAt: null as string | null,
      note: 'Scanning is switched off (SCAN_REQUIRED=false). Uploads are stored but never marked clean.',
    };
  }
  const reachable = await ping();
  const reply = reachable ? await version() : null;
  const signaturesAt = signatureDate(reply);
  const ageDays = signaturesAt ? (Date.now() - new Date(signaturesAt).getTime()) / 86_400_000 : null;

  let note: string | null = null;
  if (!reachable) {
    note = 'The virus scanner is not answering. Uploads are still accepted and stored, but stay unreadable until it is back.';
  } else if (ageDays !== null && ageDays > 7) {
    note = `The scanner's signatures are ${Math.floor(ageDays)} days old. Check that freshclam is running.`;
  }
  return { required: true, reachable, endpoint: `${clamdHost()}:${clamdPort()}`, signaturesAt, note };
}

/** The last backup that finished, and whether it worked. */
async function backups() {
  const [last] = await db.select().from(schema.backupRuns).orderBy(desc(schema.backupRuns.startedAt)).limit(1);
  const [lastOk] = await db
    .select()
    .from(schema.backupRuns)
    .where(eq(schema.backupRuns.ok, true))
    .orderBy(desc(schema.backupRuns.startedAt))
    .limit(1);

  const hoursSince = lastOk ? (Date.now() - lastOk.startedAt.getTime()) / 3_600_000 : null;
  let note: string | null = null;
  if (!lastOk) {
    note = 'No successful backup has ever been recorded. Run ops\\windows\\backup.ps1.';
  } else if (hoursSince !== null && hoursSince > 36) {
    note = `The last good backup was ${Math.floor(hoursSince / 24)} day(s) ago. Check the scheduled task.`;
  } else if (last && !last.ok) {
    note = 'The most recent backup attempt failed. The last good one is older than it looks.';
  }

  return {
    lastRunAt: last ? last.startedAt.toISOString() : null,
    lastRunOk: last ? last.ok : null,
    lastGoodAt: lastOk ? lastOk.startedAt.toISOString() : null,
    lastGoodFiles: lastOk?.fileCount ?? null,
    lastGoodDumpBytes: lastOk?.dumpBytes ?? null,
    lastError: last && !last.ok ? last.error : null,
    note,
  };
}

/** Uploads that never finished, and sessions that are still live. */
async function health() {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [stuckVersions] = await db
    .select({ n: count() })
    .from(schema.documentVersions)
    .where(and(isNull(schema.documentVersions.publishedAt), lt(schema.documentVersions.createdAt, hourAgo)));
  const [quarantined] = await db
    .select({ n: count() })
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.scanStatus, 'infected'));
  const [sessions] = await db
    .select({ n: count() })
    .from(schema.sessions)
    .where(and(isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, sql`now()`)));

  return {
    unpublishedVersions: Number(stuckVersions?.n ?? 0),
    quarantinedVersions: Number(quarantined?.n ?? 0),
    activeSessions: Number(sessions?.n ?? 0),
  };
}

router.get('/status', requireProvider, async (_req, res) => {
  const [jobs, scan, disk, backup, live] = await Promise.all([queueStats(), scanner(), storage(), backups(), health()]);

  res.json({
    time: new Date().toISOString(),
    firmTimezone: firmTimezone(),
    jobs,
    scanner: scan,
    storage: disk,
    backups: backup,
    health: live,
    mail: {
      configured: isMailConfigured(),
      // What the advisor should do about it, rather than making them read the runbook.
      note: isMailConfigured()
        ? null
        : 'No mail server configured (SMTP_URL). Invitations and password resets are copy-link only.',
    },
  });
});

export default router;
