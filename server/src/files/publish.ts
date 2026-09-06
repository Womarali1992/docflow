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
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { Document } from '../db/schema.js';
import { audit } from '../db/audit.js';
import { enqueue } from '../jobs/queue.js';
import { recordNewVersion, type NewVersionResult } from '../workflow/versions.js';
import { commitStaged, discardStaged, newStorageKey } from './store.js';
import { validateStagedFile } from './validate.js';
import { scanForPipeline } from './scan.js';
import type { StagedUpload } from './staging.js';

/** Stable codes the frontend can branch on; the message is what a person reads. */
export type PublishFailureCode =
  | 'unsupported_type'
  | 'type_mismatch'
  | 'encrypted'
  | 'empty_file'
  | 'infected'
  | 'storage_failed';

export interface PublishFailure {
  ok: false;
  status: number;
  code: PublishFailureCode;
  error: string;
}

export interface PublishSuccess {
  ok: true;
  /** 201 when it is published and readable, 202 when it is stored but still being checked. */
  status: 201 | 202;
  result: NewVersionResult;
  scanStatus: 'clean' | 'error' | 'pending';
  /** Set when the scanner could not be reached, so the caller can say so. */
  code?: 'scanner_unavailable';
}

export type PublishResult = PublishSuccess | PublishFailure;

export interface PublishInput {
  document: Document;
  staged: StagedUpload;
  uploadedByKind: 'provider' | 'client';
  uploadedById: string;
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

/**
 * Runs validate → scan → publish for one staged file. Always consumes the
 * staged file: on every path it is either renamed into place or deleted.
 */
export async function publishStagedUpload(input: PublishInput): Promise<PublishResult> {
  const { staged, document } = input;
  const now = input.now ?? new Date();

  /* 1. Validate: is this the kind of file it claims to be? */
  const validation = await validateStagedFile(staged.absPath, staged.originalFilename);
  if (!validation.ok) {
    discardStaged(staged.absPath);
    return { ok: false, status: 400, code: validation.code, error: validation.message };
  }

  /* 2. Scan: a verdict before anything reaches files/. */
  const scan = await scanForPipeline(staged.absPath);
  if (scan.status === 'infected') {
    discardStaged(staged.absPath);
    await audit({
      action: 'document.quarantined',
      targetType: 'document',
      targetId: document.id,
      clientId: document.clientId,
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

  /* 3. Publish: hash, move into place, then one transaction for the model. */
  const sha256 = await hashFile(staged.absPath);
  const storageKey = newStorageKey(now, validation.ext);

  try {
    commitStaged(staged.absPath, storageKey);
  } catch (err) {
    discardStaged(staged.absPath);
    console.error('[files] could not store an upload:', err);
    return { ok: false, status: 500, code: 'storage_failed', error: 'The file could not be stored. Please try again.' };
  }

  let result: NewVersionResult;
  try {
    result = await recordNewVersion({
      document,
      originalFilename: staged.originalFilename,
      mimeType: validation.mimeType,
      sizeBytes: staged.sizeBytes,
      sha256,
      storageKey,
      uploadedByKind: input.uploadedByKind,
      uploadedById: input.uploadedById,
      scanStatus: scan.status === 'clean' ? 'clean' : scan.status === 'error' ? 'error' : 'pending',
      scanDetail: scan.detail,
      now,
    });
  } catch (err) {
    // The bytes are on disk but the row is not: leave the file for the sweeper
    // rather than deleting something a concurrent write may already reference.
    console.error('[files] version row failed after the file was stored:', err);
    return { ok: false, status: 500, code: 'storage_failed', error: 'The file could not be recorded. Please try again.' };
  }

  /* 4. A version nobody has scanned needs a retry queued and an honest answer. */
  if (scan.status !== 'clean') {
    await enqueue(
      'scan_retry',
      { versionId: result.version.id, documentId: document.id, storageKey },
      {
        runAt: new Date(now.getTime() + RETRY_EVERY_MS),
        // One retry chain per version, however many times the upload is retried.
        dedupeKey: `scan_retry:${result.version.id}`,
        maxAttempts: SCAN_RETRY_ATTEMPTS,
      }
    );
    return {
      ok: true,
      status: 202,
      result,
      scanStatus: scan.status === 'error' ? 'error' : 'pending',
      ...(scan.status === 'error' ? { code: 'scanner_unavailable' as const } : {}),
    };
  }

  await audit({
    action: 'document.published',
    targetType: 'document_version',
    targetId: result.version.id,
    clientId: document.clientId,
    actorKind: input.uploadedByKind,
    actorId: input.uploadedById,
    ip: input.ip ?? null,
    meta: { documentId: document.id, versionNo: result.version.versionNo, sizeBytes: staged.sizeBytes },
  });

  return { ok: true, status: 201, result, scanStatus: 'clean' };
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
