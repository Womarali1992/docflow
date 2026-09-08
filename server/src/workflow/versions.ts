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
 *
 * H2 moved the second half of that job into `publish.ts`: this function
 * allocates and inserts the row, and `publishVersion` decides what the reader
 * sees. Two reasons. The allocation has to happen with the document locked or
 * concurrent uploads collide on `version_no` (audit F3), and publication has to
 * be one shared path or the scan-retry job's copy of it drifts — which is
 * exactly what F4 was.
 */
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { Document, DocumentVersion, ScanStatus } from '../db/schema.js';
import { allocateVersionNo, lockDocument, publishVersion } from './publish.js';

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
 * transaction: lock the document, allocate the number under that lock, insert,
 * and — if a scanner has already said the file is clean — publish it.
 */
export async function recordNewVersion(input: NewVersionInput): Promise<NewVersionResult> {
  const now = input.now ?? new Date();
  const scanStatus = input.scanStatus ?? 'clean';

  return db.transaction(async (tx) => {
    // Lock first, allocate second (invariant 17). Without this, two uploads
    // landing together both read the same MAX and one of them dies on the
    // unique index — a 500 for a client whose file was perfectly fine.
    const document = await lockDocument(tx, input.document.id);
    if (!document) throw new Error(`recordNewVersion: document ${input.document.id} does not exist`);
    const versionNo = await allocateVersionNo(tx, document.id);

    const [version] = await tx
      .insert(schema.documentVersions)
      .values({
        documentId: document.id,
        versionNo,
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
        createdAt: now,
      })
      .returning();

    // A quarantined or still-being-checked version is recorded but changes
    // nothing the reader can see. `publishVersion` owns the rest.
    if (scanStatus !== 'clean') {
      return { version, document, reopenedRequest: false };
    }

    const outcome = await publishVersion(tx, { versionId: version.id, now, reason: 'upload' });
    return { version: outcome.version, document: outcome.document, reopenedRequest: outcome.reopened };
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
