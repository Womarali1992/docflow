/**
 * What the ops panel and the daily digest both read (H7).
 *
 * This used to live inside `routes/ops.ts`, which was fine while a screen was
 * the only consumer. It stopped being fine the moment a job had to answer the
 * same questions by email: two implementations of "is the backup old enough to
 * worry about" drift, and the one that drifts is always the one nobody is
 * looking at.
 *
 * So there is one `collectOpsStatus()` and one `opsProblems()`, and the panel
 * and the digest are two renderings of them.
 *
 * Everything here is counts, timestamps and configuration. No client name, no
 * document title, no filename, no connection string — the panel is meant to be
 * safe to leave open on a screen in a shared office, and the digest is meant to
 * be safe in an inbox.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, count, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { queueStats, failedJobs, type FailedJob, type QueueStats } from '../jobs/queue.js';
import { isMailConfigured } from '../jobs/mail.js';
import { workerStatus, type WorkerStatus } from '../jobs/heartbeat.js';
import { clamdHost, clamdPort, ping, scanRequired, signatureDate, version } from '../files/scan.js';
import { dataRoot } from '../files/store.js';
import { clientsNearQuota, maxClientStorageBytes, topClientsByStorage } from '../files/quota.js';
import { firmTimezone } from '../jobs/schedule.js';
import { release, type Release } from './release.js';

/** Under a tenth free, the disk is the problem that takes everything else with it. */
export const LOW_DISK_RATIO = 0.1;
/** A backup older than this has probably stopped happening rather than been late. */
export const STALE_BACKUP_HOURS = 36;

export interface StorageStatus {
  path: string;
  freeBytes: number | null;
  totalBytes: number | null;
  note: string | null;
  perClientQuotaBytes: number;
  topClients: { clientId: string; bytes: number; percentOfQuota: number }[];
  /** Clients within reach of their ceiling — a count, never who. */
  clientsNearQuota: number;
}

export interface ScannerStatus {
  required: boolean;
  reachable: boolean;
  endpoint: string;
  signaturesAt: string | null;
  note: string | null;
}

export interface BackupStatus {
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  lastGoodAt: string | null;
  lastGoodFiles: number | null;
  lastGoodDumpBytes: number | null;
  lastError: string | null;
  note: string | null;
}

export interface HealthStatus {
  unpublishedVersions: number;
  quarantinedVersions: number;
  activeSessions: number;
}

export interface ReleaseStatus extends Release {
  migrations: { applied: number; lastAppliedAt: string | null; pending: string[] };
  /** What clamd says it is, when it is answering. */
  scanner: string | null;
}

export interface OpsStatus {
  time: string;
  firmTimezone: string;
  jobs: QueueStats & { failedList: FailedJob[] };
  worker: WorkerStatus;
  scanner: ScannerStatus;
  storage: StorageStatus;
  backups: BackupStatus;
  health: HealthStatus;
  mail: { configured: boolean; note: string | null };
  release: ReleaseStatus;
}

/** Free and total bytes on the volume that holds the documents. */
async function storage(providerId: string | null): Promise<StorageStatus> {
  const root = dataRoot();
  const [top, nearQuota] = await Promise.all([
    providerId ? topClientsByStorage(providerId) : Promise.resolve([]),
    clientsNearQuota(providerId),
  ]);
  const shared = { perClientQuotaBytes: maxClientStorageBytes(), topClients: top, clientsNearQuota: nearQuota };
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
      note: freeRatio < LOW_DISK_RATIO ? 'Less than 10% of this volume is free. Clear space or move the backups off it.' : null,
      ...shared,
    };
  } catch {
    return { path: root, freeBytes: null, totalBytes: null, note: 'Could not read the disk usage for this volume.', ...shared };
  }
}

/** How the scanner is, how old what it knows is, and what it says it is. */
async function scanner(): Promise<{ block: ScannerStatus; versionReply: string | null }> {
  if (!scanRequired()) {
    return {
      versionReply: null,
      block: {
        required: false,
        reachable: false,
        endpoint: `${clamdHost()}:${clamdPort()}`,
        signaturesAt: null,
        note: 'Scanning is switched off (SCAN_REQUIRED=false). Uploads are stored but never marked clean.',
      },
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
  return { versionReply: reply, block: { required: true, reachable, endpoint: `${clamdHost()}:${clamdPort()}`, signaturesAt, note } };
}

/** The last backup that finished, and whether it worked. */
async function backups(): Promise<BackupStatus> {
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
  } else if (hoursSince !== null && hoursSince > STALE_BACKUP_HOURS) {
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
async function health(): Promise<HealthStatus> {
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

/* `dist/ops/status.js` and `src/ops/status.ts` are both two levels under
   `server/`, so one walk finds the journal in a build and in a `tsx` run. */
const journalPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
  'meta',
  '_journal.json'
);

/** The migration tags this build carries, in order. */
export function journalTags(): string[] {
  try {
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries?: { tag: string }[] };
    return (journal.entries ?? []).map((e) => e.tag);
  } catch {
    return [];
  }
}

/**
 * What has been applied, and what this build expects that has not been.
 *
 * The gap is the point. The dev database sits behind `0008_contract` on
 * purpose, and "the code expects ten migrations and the database has nine" is
 * the kind of thing that should be on a screen rather than in someone's memory.
 */
async function migrations(): Promise<ReleaseStatus['migrations']> {
  const tags = journalTags();
  try {
    const result = await db.execute(
      sql`SELECT COUNT(*)::int AS n, MAX(created_at)::text AS last FROM drizzle.__drizzle_migrations`
    );
    const row = result.rows[0] as { n?: number; last?: string | null } | undefined;
    const applied = Number(row?.n ?? 0);
    const lastMs = row?.last === null || row?.last === undefined ? null : Number(row.last);
    return {
      applied,
      lastAppliedAt: lastMs === null || Number.isNaN(lastMs) ? null : new Date(lastMs).toISOString(),
      pending: tags.slice(applied),
    };
  } catch {
    // No migrations table at all: an empty database, or one this role cannot read.
    return { applied: 0, lastAppliedAt: null, pending: tags };
  }
}

/**
 * Everything the panel shows, in one read.
 *
 * `providerId` scopes the per-client storage rows to one advisor's own clients.
 * The digest has no advisor to scope to and passes none, which is why every
 * other field here is about the machine rather than about a tenant.
 */
export async function collectOpsStatus(providerId: string | null = null): Promise<OpsStatus> {
  const [jobs, failedList, worker, scan, disk, backup, live, migrationState] = await Promise.all([
    queueStats(),
    failedJobs(),
    workerStatus(),
    scanner(),
    storage(providerId),
    backups(),
    health(),
    migrations(),
  ]);

  return {
    time: new Date().toISOString(),
    firmTimezone: firmTimezone(),
    jobs: { ...jobs, failedList },
    worker,
    scanner: scan.block,
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
    release: { ...release(), migrations: migrationState, scanner: scan.versionReply },
  };
}

/**
 * The things wrong right now, as sentences an accountant can act on.
 *
 * This is the digest's whole editorial policy: an empty list means no email.
 * A daily "everything is fine" is how an alert becomes a filter rule, and the
 * one morning it says something else it will already be in a folder nobody
 * opens.
 */
export function opsProblems(status: OpsStatus): string[] {
  const problems: string[] = [];

  if (status.jobs.failed > 0) {
    problems.push(
      `${status.jobs.failed} background job${status.jobs.failed === 1 ? ' has' : 's have'} failed and stopped retrying.`
    );
  }
  if (status.worker.note) problems.push(status.worker.note);
  if (status.backups.note) problems.push(status.backups.note);
  /* A switched-off scanner is a configuration choice, not a fault. When it is
     required, both of its notes — silent, or signatures a week old — are worth
     an email. */
  if (status.scanner.required && status.scanner.note) problems.push(status.scanner.note);
  if (status.storage.note) problems.push(status.storage.note);
  if (status.health.unpublishedVersions > 0) {
    problems.push(
      `${status.health.unpublishedVersions} upload${status.health.unpublishedVersions === 1 ? '' : 's'} stored bytes over an hour ago and never finished being checked.`
    );
  }
  if (status.storage.clientsNearQuota > 0) {
    problems.push(
      `${status.storage.clientsNearQuota} client${status.storage.clientsNearQuota === 1 ? ' is' : 's are'} close to their storage limit and will start being refused uploads.`
    );
  }
  return problems;
}
