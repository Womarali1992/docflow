/**
 * Re-scan a version the scanner could not reach the first time.
 *
 * The rule this protects (invariant 3, R6): a scanner outage must never turn
 * into a published-but-unscanned file, and never into a rejected upload either.
 * The client's document is safely stored and unreadable; this job keeps asking
 * until a scanner answers, and only then does the version become `clean` and
 * visible.
 *
 * A verdict of `infected` on retry quarantines the version: the row stays as the
 * record, the bytes are deleted, and the document stops pointing at it.
 *
 * H2: this job no longer has its own opinion about what "published" means. It
 * scans, writes the verdict, and hands the version to `publishVersion` — the
 * same call the upload path makes. Before that it repointed `currentVersionId`
 * at whatever it had just scanned, so a slow scan of an older version undid a
 * newer one that was already on screen, and it skipped the request transition
 * whenever the request was `accepted`, so a replacement that arrived during an
 * outage published without ever reaching the advisor (audit F4).
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/client.js';
import type { Job } from '../../db/schema.js';
import { absPathForKey, discardStaged } from '../../files/store.js';
import { scanFile, scanRequired } from '../../files/scan.js';
import { audit } from '../../db/audit.js';
import { lockDocument, publishVersion, quarantineVersion } from '../../workflow/publish.js';

export async function scanRetryJob(job: Job): Promise<void> {
  const payload = (job.payload ?? {}) as { versionId?: unknown };
  if (typeof payload.versionId !== 'string') throw new Error('scan_retry job has no versionId');

  const [version] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, payload.versionId));
  if (!version) {
    console.log(`[worker] scan_retry ${job.id}: version is gone; nothing to do`);
    return;
  }
  if (version.scanStatus === 'clean' || version.scanStatus === 'infected') {
    console.log(`[worker] scan_retry ${job.id}: version ${version.id} is already ${version.scanStatus}`);
    return;
  }
  if (!scanRequired()) {
    // Nothing to retry against. Throwing keeps the job in the queue for the day
    // scanning is switched on, rather than silently marking the file finished.
    throw new Error('SCAN_REQUIRED=false: no scanner to retry against');
  }

  const abs = absPathForKey(version.storageKey);
  const result = await scanFile(abs);
  const now = new Date();

  if (result.verdict === 'error') {
    // Still down. Fail the job so the queue backs off and tries again.
    await db
      .update(schema.documentVersions)
      .set({ scanStatus: 'error', scanDetail: result.detail, scannedAt: now })
      .where(eq(schema.documentVersions.id, version.id));
    throw new Error(`scanner still unavailable: ${result.detail}`);
  }

  const [document] = await db.select().from(schema.documents).where(eq(schema.documents.id, version.documentId));

  if (result.verdict === 'infected') {
    await db.transaction(async (tx) => {
      await quarantineVersion(tx, { versionId: version.id, detail: result.detail, now });
      // Inside the transaction: the record of a quarantine and the quarantine
      // itself are one fact, and a log that can be missing is not a log (F10).
      await audit(
        {
          action: 'document.quarantined',
          targetType: 'document_version',
          targetId: version.id,
          clientId: document?.clientId ?? null,
          actorKind: 'system',
          meta: { signature: result.detail, onRetry: true },
        },
        tx
      );
    });
    // The row stays as the record; the bytes do not.
    discardStaged(abs);

    console.error(`[worker] scan_retry ${job.id}: version ${version.id} is INFECTED (${result.detail}); quarantined`);
    return;
  }

  /* Clean at last: publish it through the one publication path, and move the
     checklist on if it was waiting. The document is locked first — every path
     that publishes takes the document lock before touching a version row, which
     is what keeps this job and a concurrent upload from deadlocking. */
  const outcome = await db.transaction(async (tx) => {
    await lockDocument(tx, version.documentId);
    await tx
      .update(schema.documentVersions)
      .set({ scanStatus: 'clean', scanDetail: null, scannedAt: now })
      .where(eq(schema.documentVersions.id, version.id));

    const published = await publishVersion(tx, { versionId: version.id, now, reason: 'scan_retry' });
    await audit(
      {
        action: 'document.published',
        targetType: 'document_version',
        targetId: version.id,
        clientId: document?.clientId ?? null,
        actorKind: 'system',
        meta: {
          afterRetry: true,
          versionNo: version.versionNo,
          // A late arrival that lost to a newer version is worth being able to
          // find in the log a month later.
          currentChanged: published.currentChanged,
        },
      },
      tx
    );
    return published;
  });

  console.log(
    outcome.currentChanged
      ? `[worker] scan_retry ${job.id}: version ${version.id} scanned clean and published`
      : `[worker] scan_retry ${job.id}: version ${version.id} scanned clean but a newer version is already current; superseded`
  );
}

export default scanRetryJob;
