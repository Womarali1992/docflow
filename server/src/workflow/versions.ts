/**
 * What happens when a new version of a document lands.
 *
 * This is the one place that knows the rule the whole review loop rests on:
 * **a new version resets acceptance and keeps the old review.** An advisor who
 * accepted version 1 has not accepted version 2, and the record of what they
 * decided about version 1 stays exactly as it was — reviews are history, not
 * current state.
 *
 * C2.2 uses this to record versions; C2.3's publish pipeline calls the same
 * function at the end of its transaction, so the upload path and any future
 * path cannot drift apart.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { Document, DocumentVersion, ScanStatus } from '../db/schema.js';

export interface NewVersionInput {
  document: Document;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  uploadedByKind: 'provider' | 'client';
  uploadedById: string;
  /** Only a clean version is published; anything else waits (invariant 3). */
  scanStatus?: ScanStatus;
  scanDetail?: string | null;
  now?: Date;
}

export interface NewVersionResult {
  version: DocumentVersion;
  document: Document;
  /** True when an accepted request was sent back for review by this version. */
  reopenedRequest: boolean;
}

/**
 * Inserts the next version and moves everything that depends on it, in one
 * transaction: supersede the previous version, repoint `currentVersionId`, and
 * put the request back in front of the advisor.
 */
export async function recordNewVersion(input: NewVersionInput): Promise<NewVersionResult> {
  const now = input.now ?? new Date();
  const scanStatus = input.scanStatus ?? 'clean';
  const published = scanStatus === 'clean';

  return db.transaction(async (tx) => {
    const [{ maxNo }] = await tx
      .select({ maxNo: sql<number>`COALESCE(MAX(${schema.documentVersions.versionNo}), 0)` })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, input.document.id));

    const [version] = await tx
      .insert(schema.documentVersions)
      .values({
        documentId: input.document.id,
        versionNo: Number(maxNo) + 1,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        storageKey: input.storageKey,
        scanStatus,
        scanDetail: input.scanDetail ?? null,
        scannedAt: scanStatus === 'pending' ? null : now,
        uploadedByKind: input.uploadedByKind,
        uploadedById: input.uploadedById,
        publishedAt: published ? now : null,
        createdAt: now,
      })
      .returning();

    // Only a published version becomes the one being served; a quarantined or
    // pending one is recorded but changes nothing the reader can see.
    if (!published) {
      return { version, document: input.document, reopenedRequest: false };
    }

    // Everything older is superseded — exactly one live version per document.
    await tx
      .update(schema.documentVersions)
      .set({ supersededAt: now })
      .where(
        and(
          eq(schema.documentVersions.documentId, input.document.id),
          isNull(schema.documentVersions.supersededAt),
          sql`${schema.documentVersions.id} <> ${version.id}`
        )
      );

    const [document] = await tx
      .update(schema.documents)
      .set({ currentVersionId: version.id, updatedAt: now })
      .where(eq(schema.documents.id, input.document.id))
      .returning();

    let reopenedRequest = false;
    if (document.requestId) {
      const [request] = await tx.select().from(schema.requests).where(eq(schema.requests.id, document.requestId));
      if (request && request.status !== 'waived') {
        // A new answer means the advisor has to look again, whatever they
        // decided last time. The old review row is left untouched.
        reopenedRequest = request.status === 'accepted';
        await tx
          .update(schema.requests)
          .set({
            status: 'submitted',
            // A fresh submission also clears a stale "I don't have this".
            clientResponseKind: null,
            clientResponseNote: null,
            clientResponseAt: null,
            updatedAt: now,
          })
          .where(eq(schema.requests.id, request.id));
      }
    }

    return { version, document, reopenedRequest };
  });
}

/** The versions of a document, newest first. */
export async function listVersions(documentId: string): Promise<DocumentVersion[]> {
  return db
    .select()
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, documentId))
    .orderBy(desc(schema.documentVersions.versionNo));
}
