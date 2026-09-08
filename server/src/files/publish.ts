/**
 * The upload pipeline, end to end: authorize (the caller's job, already done) →
 * stage (staging.ts) → validate → scan → publish.
 *
 * The order is the point. Nothing is written into `files/` until it has been
 * validated and scanned, and nothing is marked `clean` that a scanner has not
 * looked at (invariant 3). Every exit that is not a publish deletes the staged
 * file, so a rejected upload leaves nothing behind.
 *
 * A scanner that is down does NOT reject the client's document — that would
 * make the firm's outage the client's problem. The file is stored, the version
 * is `error`, a retry job is queued, and the client is told it is being checked
 * (202). Nobody can read it until a scan succeeds.
 *
 * **H3 moved the document row to the end of that sentence.** The pipeline used
 * to be handed a document that the route had already created, so every refused
 * upload — wrong type, spoofed extension, encrypted, infected — left an empty
 * document behind: the client saw a rejection and the advisor saw a document
 * with no file in it (audit F11). Now the caller passes `resolveDocument`, a
 * thunk this module calls only once the bytes have earned a row (invariant 20),
 * and the version, its scan-retry job and its audit line commit in one
 * transaction rather than three.
 *
 * Two answers that are not new versions, both 200:
 *   - `duplicate_upload` — the same `X-Upload-Id` already produced a version.
 *     A retry after a lost response is the same send, not a second one.
 *   - `unchanged` — byte-identical to the version already current. Re-sending
 *     the same file should not reopen a review the advisor has finished.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { Document, DocumentVersion } from '../db/schema.js';
import { audit } from '../db/audit.js';
import { enqueue } from '../jobs/queue.js';
import { recordNewVersionTx, type NewVersionResult } from '../workflow/versions.js';
import type { Tx } from '../workflow/publish.js';
import { absPathForKey, commitStaged, discardStaged, newStorageKey } from './store.js';
import { validateStagedFile } from './validate.js';
import { scanForPipeline } from './scan.js';
import { quotaRefusal } from './quota.js';
import type { StagedUpload } from './staging.js';

/** Stable codes the frontend can branch on; the message is what a person reads. */
export type PublishFailureCode =
  | 'unsupported_type'
  | 'type_mismatch'
  | 'encrypted'
  | 'empty_file'
  | 'infected'
  | 'quota_exceeded'
  | 'storage_failed';

export interface PublishFailure {
  ok: false;
  status: number;
  code: PublishFailureCode;
  error: string;
}

export interface PublishSuccess {
  ok: true;
  /** 201 published, 202 stored and still being checked, 200 nothing new happened. */
  status: 200 | 201 | 202;
  result: NewVersionResult;
  scanStatus: 'clean' | 'error' | 'pending';
  /** Set when the scanner could not be reached, or when this was not a new version. */
  code?: 'scanner_unavailable' | 'duplicate_upload' | 'unchanged';
}

export type PublishResult = PublishSuccess | PublishFailure;

export interface PublishInput {
  /**
   * The document these bytes belong to — called only after validation and the
   * virus check have passed, so a refused upload never creates one, and called
   * *inside* the version transaction, so a document created for an upload that
   * then fails rolls back with it.
   */
  resolveDocument: (tx: Tx) => Promise<Document>;
  /**
   * The same scoping the route uses, for the one case that needs it after the
   * fact: a retry that lost the idempotency race has to be answered with the
   * winner's document, and only if the caller may see it.
   */
  visibleDocument?: (documentId: string) => Promise<Document | null>;
  /** Who the file is for, known before the document exists (for the audit line). */
  context: { clientId: string; providerId: string };
  staged: StagedUpload;
  uploadedByKind: 'provider' | 'client';
  uploadedById: string;
  /** The caller's `X-Upload-Id`, already validated as a UUID. */
  uploadId?: string | null;
  /** Who to attribute the audit line to; defaults to the uploader. */
  ip?: string | null;
  now?: Date;
}

/** How long to wait before the first retry; the queue's backoff ladder takes over after that. */
const RETRY_EVERY_MS = 5 * 60 * 1000;
/**
 * Roughly a day of retrying, which is the plan's window. The spacing comes from
 * the queue's ladder (1 min, 5 min, 15 min, then hourly) rather than a flat five
 * minutes, so 30 attempts lands a little over 24 h — long enough to ride out a
 * scanner outage, short enough that a genuinely stuck version stops churning and
 * shows up as failed on the ops status instead.
 */
export const SCAN_RETRY_ATTEMPTS = 30;

/** Postgres' unique-violation SQLSTATE, which is how a lost idempotency race ends. */
const UNIQUE_VIOLATION = '23505';

/**
 * Runs validate → scan → publish for one staged file. Always consumes the
 * staged file: on every path it is either renamed into place or deleted.
 */
export async function publishStagedUpload(input: PublishInput): Promise<PublishResult> {
  const { staged, context } = input;
  const now = input.now ?? new Date();

  /* 1. Validate: is this the kind of file it claims to be? */
  const validation = await validateStagedFile(staged.absPath, staged.originalFilename);
  if (!validation.ok) {
    discardStaged(staged.absPath);
    return { ok: false, status: 400, code: validation.code, error: validation.message };
  }

  /* 2. Quota, now that the real size is known rather than claimed. The route
     already refused an obviously-oversized send before staging; this is the
     measurement. Advisors are exempt — see quota.ts. */
  if (input.uploadedByKind === 'client') {
    const refusal = await quotaRefusal(context.clientId, staged.sizeBytes);
    if (refusal) {
      discardStaged(staged.absPath);
      return { ok: false, ...refusal };
    }
  }

  /* 3. Scan: a verdict before anything reaches files/. */
  const scan = await scanForPipeline(staged.absPath);
  if (scan.status === 'infected') {
    discardStaged(staged.absPath);
    // No document row to point at — that is the F11 fix — so the audit line
    // names the client whose upload it was and the filename it arrived under.
    await audit({
      action: 'document.quarantined',
      targetType: 'upload',
      targetId: null,
      clientId: context.clientId,
      actorKind: input.uploadedByKind,
      actorId: input.uploadedById,
      ip: input.ip ?? null,
      // The signature name, never the file's contents.
      meta: { signature: scan.detail, filename: staged.originalFilename },
    });
    return {
      ok: false,
      status: 422,
      code: 'infected',
      error: 'That file did not pass the virus check and has not been stored. Please check the device it came from.',
    };
  }

  /* 4. The bytes have earned a row. Everything from here is one transaction:
     the document (created now, if this is the first file against a request),
     the version, the scan-retry job that will finish checking it, and the line
     that records all of it. A crash anywhere in here leaves an unreferenced
     file for `npm run files:orphans` and nothing else — no empty document, no
     version with no job, no change with no audit line (invariant 20). */
  const sha256 = await hashFile(staged.absPath);
  const storageKey = newStorageKey(now, validation.ext);
  const scanStatus = scan.status === 'clean' ? 'clean' : scan.status === 'error' ? 'error' : 'pending';

  let committed = false;
  let settled: PublishSuccess;
  try {
    settled = await db.transaction(async (tx): Promise<PublishSuccess> => {
      const document = await input.resolveDocument(tx);

      /* The same bytes as what is already on screen: nothing to record, and no
         review to reopen. (Impossible on a first upload — there is no current
         version to match — so this never discards a document it just made.) */
      const current = await currentVersionOf(tx, document);
      if (current && current.sha256 === sha256 && current.sizeBytes === staged.sizeBytes) {
        return {
          ok: true,
          status: 200,
          code: 'unchanged',
          scanStatus: 'clean',
          result: { version: current, document, reopenedRequest: false },
        };
      }

      // The rename is the one thing here that a rollback cannot undo; it happens
      // as late as possible, and what it leaves behind is an orphan the report
      // knows how to find.
      commitStaged(staged.absPath, storageKey);
      committed = true;

      const recorded = await recordNewVersionTx(tx, {
        document,
        originalFilename: staged.originalFilename,
        mimeType: validation.mimeType,
        sizeBytes: staged.sizeBytes,
        sha256,
        storageKey,
        uploadedByKind: input.uploadedByKind,
        uploadedById: input.uploadedById,
        uploadId: input.uploadId ?? null,
        scanStatus,
        scanDetail: scan.detail,
        now,
      });

      if (scanStatus !== 'clean') {
        await enqueue(
          'scan_retry',
          { versionId: recorded.version.id, documentId: recorded.document.id, storageKey },
          {
            runAt: new Date(now.getTime() + RETRY_EVERY_MS),
            // One retry chain per version, however many times the upload is retried.
            dedupeKey: `scan_retry:${recorded.version.id}`,
            maxAttempts: SCAN_RETRY_ATTEMPTS,
          },
          tx
        );
      }

      await audit(
        {
          action: scanStatus === 'clean' ? 'document.published' : 'document.received',
          targetType: 'document_version',
          targetId: recorded.version.id,
          clientId: recorded.document.clientId,
          actorKind: input.uploadedByKind,
          actorId: input.uploadedById,
          ip: input.ip ?? null,
          meta: {
            documentId: recorded.document.id,
            versionNo: recorded.version.versionNo,
            sizeBytes: staged.sizeBytes,
            scanStatus,
          },
        },
        tx
      );

      return {
        ok: true,
        status: scanStatus === 'clean' ? 201 : 202,
        result: recorded,
        scanStatus,
        ...(scanStatus === 'error' ? { code: 'scanner_unavailable' as const } : {}),
      };
    });
  } catch (err) {
    /* Two identical retries raced and this one lost the partial unique index on
       `upload_id`. The winner's version is the answer to both — provided the
       caller may see the document it landed on, which is the same scoping the
       pre-staging check uses. Everything this transaction did, including any
       document it created, has already rolled back. */
    const found = input.uploadId && isUniqueViolation(err) ? await versionByUploadId(input.uploadId) : null;
    const owner = found ? await input.visibleDocument?.(found.documentId) : null;
    if (committed) {
      // We generated this key moments ago and the transaction rolled back, so
      // nothing else can reference it. Unlike a general failure, this is safe to
      // clean up rather than leave for the orphan report.
      if (found && owner) discardStaged(absPathForKey(storageKey));
    }
    if (found && owner) return duplicateAnswer(found, owner);

    console.error('[files] the upload transaction failed:', err);
    if (!committed) discardStaged(staged.absPath);
    return { ok: false, status: 500, code: 'storage_failed', error: 'The file could not be recorded. Please try again.' };
  }

  // An answer that recorded nothing still has to consume the staged file.
  if (settled.code === 'unchanged') discardStaged(staged.absPath);
  return settled;
}

/** The version a document is serving, if any. */
async function currentVersionOf(tx: Tx, document: Document): Promise<DocumentVersion | null> {
  if (!document.currentVersionId) return null;
  const [row] = await tx
    .select()
    .from(schema.documentVersions)
    .where(
      and(eq(schema.documentVersions.id, document.currentVersionId), eq(schema.documentVersions.documentId, document.id))
    );
  return row ?? null;
}

/** A version already recorded under this `X-Upload-Id`, whoever sent it. */
export async function versionByUploadId(uploadId: string): Promise<DocumentVersion | null> {
  const [row] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.uploadId, uploadId));
  return row ?? null;
}

/** The original send's answer, replayed. */
export function duplicateAnswer(version: DocumentVersion, document: Document): PublishSuccess {
  return {
    ok: true,
    status: 200,
    code: 'duplicate_upload',
    scanStatus: version.scanStatus === 'clean' ? 'clean' : version.scanStatus === 'error' ? 'error' : 'pending',
    result: { version, document, reopenedRequest: false },
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === UNIQUE_VIOLATION;
}

/** sha256 of the file, streamed so a 25 MB upload never sits in memory twice. */
export async function hashFile(absPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(absPath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
