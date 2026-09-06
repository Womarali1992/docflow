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
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/client.js';
import type { Job } from '../../db/schema.js';
import { absPathForKey, discardStaged } from '../../files/store.js';
import { scanFile, scanRequired } from '../../files/scan.js';
import { audit } from '../../db/audit.js';

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
      await tx
        .update(schema.documentVersions)
        .set({ scanStatus: 'infected', scanDetail: result.detail, scannedAt: now, publishedAt: null })
        .where(eq(schema.documentVersions.id, version.id));
      // Never serve it: if the document points here, unpoint it.
      if (document?.currentVersionId === version.id) {
        await tx.update(schema.documents).set({ currentVersionId: null, updatedAt: now }).where(eq(schema.documents.id, document.id));
      }
    });
    // The row stays as the record; the bytes do not.
    discardStaged(abs);

    await audit({
      action: 'document.quarantined',
      targetType: 'document_version',
      targetId: version.id,
      clientId: document?.clientId ?? null,
      actorKind: 'system',
      meta: { signature: result.detail, onRetry: true },
    });
    console.error(`[worker] scan_retry ${job.id}: version ${version.id} is INFECTED (${result.detail}); quarantined`);
    return;
  }

  /* Clean at last: publish it, and move the checklist on if it was waiting. */
  await db.transaction(async (tx) => {
    await tx
      .update(schema.documentVersions)
      .set({ scanStatus: 'clean', scanDetail: null, scannedAt: now, publishedAt: version.publishedAt ?? now })
      .where(eq(schema.documentVersions.id, version.id));
    if (document) {
      await tx.update(schema.documents).set({ currentVersionId: version.id, updatedAt: now }).where(eq(schema.documents.id, document.id));
      if (document.requestId) {
        const [request] = await tx.select().from(schema.requests).where(eq(schema.requests.id, document.requestId));
        if (request && request.status !== 'waived' && request.status !== 'accepted') {
          await tx.update(schema.requests).set({ status: 'submitted', updatedAt: now }).where(eq(schema.requests.id, request.id));
        }
      }
    }
  });

  await audit({
    action: 'document.published',
    targetType: 'document_version',
    targetId: version.id,
    clientId: document?.clientId ?? null,
    actorKind: 'system',
    meta: { afterRetry: true, versionNo: version.versionNo },
  });
  console.log(`[worker] scan_retry ${job.id}: version ${version.id} scanned clean and published`);
}

export default scanRetryJob;
