/**
 * Version history and delivery. Mounted alongside `documents.ts` on
 * `/api/documents`, because that is where the resource lives.
 *
 * Reading the record leaves `storageKey` and `sha256` on the server. Reading the
 * *bytes* has its own rules, and they are the point of the delivery half:
 *
 *   - **Only a clean, published version is ever served** (invariant 3). Anything
 *     else answers 409 with a reason, so "still being checked" and "we found
 *     something in this" never look like "not found".
 *   - **`preview` is deliberately narrower than `download`.** Only formats a
 *     browser renders safely inline — PDF and the four image types — and the
 *     `Content-Type` comes from the SNIFFED bytes, not from what was recorded at
 *     upload. An Office file is a download, never an inline render (415).
 *   - Inline responses are sandboxed and never cached, because they render in
 *     the client's browser with the client's session alive.
 */
import fs from 'node:fs';
import { type Request, type Response } from 'express';
import { asyncRouter } from './async-router.js';
import { desc, eq } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { db, schema } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';
import { auditRequest } from '../db/audit.js';
import { absPathForKey } from '../files/store.js';
import { contentDisposition } from '../files/filename.js';
import { serializeReview, serializeVersion } from './serialize.js';
import { findDocument, findVersion, notFound } from './scope.js';
import type { Document, DocumentVersion } from '../db/schema.js';

const router = asyncRouter();
router.use(authenticate);

router.get('/:id/versions', async (req, res) => {
  const doc = await findDocument(req.auth!, req.params.id);
  if (!doc) return notFound(res);

  const versions = await db
    .select()
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, doc.id))
    .orderBy(desc(schema.documentVersions.versionNo));

  const reviews = await db.select().from(schema.reviews).where(eq(schema.reviews.documentId, doc.id));
  const reviewsByVersion = new Map<string, ReturnType<typeof serializeReview>[]>();
  for (const r of reviews) {
    if (!r.versionId) continue;
    reviewsByVersion.set(r.versionId, [...(reviewsByVersion.get(r.versionId) ?? []), serializeReview(r)]);
  }

  res.json(
    versions.map((v) => ({
      ...serializeVersion(v),
      // The decision made about this particular version, not the document as a whole.
      reviews: reviewsByVersion.get(v.id) ?? [],
      isCurrent: doc.currentVersionId === v.id,
    }))
  );
});

router.get('/:id/versions/:versionId', async (req, res) => {
  const found = await findVersion(req.auth!, req.params.id, req.params.versionId);
  if (!found) return notFound(res);
  res.json(serializeVersion(found.version));
});

/* ---------------------------------------------------------------- delivery */

/** The only types a browser is asked to render inline. Everything else downloads. */
const PREVIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * A version is only readable once a scanner has passed it. The refusals say
 * which case it is, because "still being checked" and "we found something in
 * this file" call for very different things from the person reading them.
 */
function unavailable(res: Response, version: DocumentVersion): boolean {
  if (version.scanStatus === 'infected') {
    res.status(409).json({ error: 'This file did not pass the virus check and cannot be opened.', code: 'infected' });
    return true;
  }
  if (version.scanStatus !== 'clean' || version.publishedAt === null) {
    res.status(409).json({ error: 'This file is still being checked. It will open once the check finishes.', code: 'not_available_yet' });
    return true;
  }
  return false;
}

/** Magic bytes from the head of a file; enough for every signature that matters here. */
async function sniffHead(abs: string) {
  const handle = await fs.promises.open(abs, 'r');
  try {
    const head = Buffer.alloc(4100);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return await fileTypeFromBuffer(head.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/** Streams the bytes with the headers the mode calls for, then audits the read. */
async function deliver(req: Request, res: Response, document: Document, version: DocumentVersion, mode: 'download' | 'preview') {
  if (unavailable(res, version)) return;

  let abs: string;
  try {
    abs = absPathForKey(version.storageKey);
  } catch {
    return res.status(404).json({ error: 'File missing' });
  }
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing' });

  // The type is taken from the bytes on disk, not from what was recorded at
  // upload: a stored row could be wrong, and the browser acts on this header.
  // Only the head is read — every signature this matters for lives in the first
  // few KB, and a 25 MB file should not be loaded twice to answer one question.
  const contentType = (await sniffHead(abs))?.mime ?? version.mimeType;

  if (mode === 'preview' && !PREVIEWABLE.has(contentType)) {
    return res.status(415).json({
      error: 'This file type cannot be shown in the browser. Download it instead.',
      code: 'not_previewable',
    });
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(version.sizeBytes));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  if (mode === 'preview') {
    // Rendered in the client's browser while their session is live: no scripts,
    // no forms, no navigation out of it.
    res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Content-Disposition', contentDisposition('inline', version.originalFilename));
  } else {
    res.setHeader('Content-Disposition', contentDisposition('attachment', version.originalFilename));
  }

  await auditRequest(req, {
    action: mode === 'preview' ? 'document.previewed' : 'document.downloaded',
    targetType: 'document_version',
    targetId: version.id,
    clientId: document.clientId,
    meta: { documentId: document.id, versionNo: version.versionNo },
  });

  const stream = fs.createReadStream(abs);
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).json({ error: 'File missing' });
    else res.destroy();
  });
  stream.pipe(res);
}

/*
 * `next` on purpose: Express 4 does not catch a rejected async handler, so an
 * error in here would surface as an unhandled rejection and stop the process —
 * one bad file taking the portal down for everybody. It goes to the error
 * handler instead, which answers 500 and keeps serving.
 */
router.get('/:id/versions/:versionId/download', (req, res, next) => {
  findVersion(req.auth!, req.params.id, req.params.versionId)
    .then((found) => (found ? deliver(req, res, found.document, found.version, 'download') : notFound(res)))
    .catch(next);
});

router.get('/:id/versions/:versionId/preview', (req, res, next) => {
  findVersion(req.auth!, req.params.id, req.params.versionId)
    .then((found) => (found ? deliver(req, res, found.document, found.version, 'preview') : notFound(res)))
    .catch(next);
});

export default router;
