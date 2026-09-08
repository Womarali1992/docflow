/**
 * The three ways bytes enter DocFlow:
 *
 *   POST /requests/:id/uploads      the client answering a checklist line
 *   POST /engagements/:id/uploads   an ad-hoc file, either side
 *   POST /documents/:id/versions    a replacement for something already here
 *
 * **Authorize before bytes (invariant 1).** Every handler resolves and
 * authorizes its target *before* `stageUpload` runs, so an upload aimed at
 * someone else's request never reaches the disk at all. A test asserts the
 * staging directory stays empty for an unauthorized attempt — if that test ever
 * fails, this ordering has been broken.
 *
 * Two more things happen in that same pre-staging window (H3), for the same
 * reason — they are cheap, and they mean bytes that cannot be accepted are
 * never carried across the network at all:
 *
 *   - **`X-Upload-Id`.** A phone that loses the response to a 20 MB upload
 *     retries it. Without an id that is a second version of the same file, and
 *     the advisor reviews the client's flaky connection. With one, the retry is
 *     recognised and answered with the original result. The lookup is scoped
 *     through `findDocument`, so someone else's upload id reads as absent.
 *   - **The client's storage quota**, from `Content-Length` first and from the
 *     real size after staging (files/quota.ts).
 *   - **`X-Replace-Document`** (H5). A request holds several attachments now,
 *     so an upload without this header is *another* file; with it, the bytes
 *     become the next version of the attachment it names.
 *
 * Answers: 201 published, 202 stored but still being checked, 200 for the two
 * "nothing new happened" cases (`duplicate_upload`, `unchanged`), and a stable
 * `code` on every refusal.
 */
import { type NextFunction, type Request, type Response } from 'express';
import { asyncRouter } from './async-router.js';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';
import { uploadLimiter } from '../security/limits.js';
import { discardStaged, stageUpload, stagedFrom } from '../files/staging.js';
import { duplicateAnswer, publishStagedUpload, versionByUploadId, type PublishSuccess } from '../files/publish.js';
import { quotaRefusal } from '../files/quota.js';
import { recordActivity } from '../db/activity-log.js';
import { serializeDocument, serializeVersion } from './serialize.js';
import { advisorOnly, badRequest, findDocument, findEngagement, findRequest, isId, notFound } from './scope.js';
import { type Tx } from '../workflow/publish.js';
import { notify } from '../notify.js';
import type { Document } from '../db/schema.js';

const router = asyncRouter();

/*
 * NOTE: this router is mounted at /api, so router-level middleware would run for
 * every API request and authenticate them a second time. `authenticate` is
 * therefore attached per route, and nothing here executes for a path that does
 * not match one of the three below.
 */

/** Who this upload is for, known before any document row exists. */
interface UploadContext {
  clientId: string;
  providerId: string;
}

/**
 * The client's id for one send. Absent means no idempotency — an old build, or
 * a curl — which is allowed; a malformed one is refused rather than ignored,
 * because silently dropping it would turn a retry into a duplicate version.
 */
function uploadIdOf(req: Request): string | null | 'invalid' {
  const raw = req.get('X-Upload-Id');
  if (raw === undefined || raw.trim() === '') return null;
  const value = raw.trim();
  return isId(value) ? value : 'invalid';
}

/**
 * The attachment a request upload is replacing, when the caller names one (H5).
 *
 * `undefined` means "no header, so this is another attachment". `'invalid'`
 * means the header named something that is not one of this request's own
 * attachments — a different request's file, a deliverable, an archived one, a
 * document the caller cannot see, or plain nonsense. All of those get the same
 * refusal, which is what keeps it from confirming whether the id exists.
 *
 * Resolved before staging, so a replacement aimed at the wrong document never
 * carries its bytes across the network.
 */
async function replaceTargetOf(req: Request, requestId: string): Promise<Document | undefined | 'invalid'> {
  const raw = req.get('X-Replace-Document');
  if (raw === undefined || raw.trim() === '') return undefined;

  const id = raw.trim();
  if (!isId(id)) return 'invalid';

  const document = await findDocument(req.auth!, id);
  if (!document) return 'invalid';
  if (document.requestId !== requestId) return 'invalid';
  if (document.kind !== 'client_upload') return 'invalid';
  if (document.archivedAt) return 'invalid';
  return document;
}

/** The answer every upload route gives, in one shape. */
function answerBody(outcome: PublishSuccess, document: Document) {
  return {
    document: serializeDocument(document),
    version: serializeVersion(outcome.result.version),
    scanStatus: outcome.scanStatus,
    ...(outcome.code ? { code: outcome.code } : {}),
    ...(outcome.status === 202
      ? { message: 'Received. We are checking this file — it will appear once the check finishes.' }
      : {}),
  };
}

/**
 * Everything that can be settled before a byte is staged: a malformed upload
 * id, a retry of a send that already landed, and a body that would obviously
 * put the client over their quota.
 *
 * Returns true when it has answered the request.
 */
async function settledBeforeBytes(req: Request, res: Response, context: UploadContext): Promise<boolean> {
  const uploadId = uploadIdOf(req);
  if (uploadId === 'invalid') {
    badRequest(res, 'X-Upload-Id must be a UUID.', 'bad_upload_id');
    return true;
  }

  if (uploadId) {
    const existing = await versionByUploadId(uploadId);
    const visible = existing ? await findDocument(req.auth!, existing.documentId) : null;
    if (existing && visible) {
      res.status(200).json(answerBody(duplicateAnswer(existing, visible), visible));
      return true;
    }
    // Scoped: an id on a version the caller cannot see behaves exactly as if it
    // did not exist — no replay, and no refusal either, because a refusal would
    // confirm that someone else's upload has that id. It is dropped rather than
    // carried into the insert: the column is globally unique, so keeping it
    // would turn a probe into a collision.
    res.locals.uploadId = existing ? null : uploadId;
  }

  if (req.auth!.kind === 'client') {
    // The client's claim about the body size. An over-estimate by a few hundred
    // bytes of multipart overhead, which is nothing against a 2 GiB ceiling —
    // and refusing here means a phone on cellular never sends the file at all.
    const declared = Number.parseInt(req.get('Content-Length') ?? '', 10);
    if (Number.isFinite(declared) && declared > 0) {
      const refusal = await quotaRefusal(context.clientId, declared);
      if (refusal) {
        res.status(refusal.status).json({ error: refusal.error, code: refusal.code });
        return true;
      }
    }
  }

  return false;
}

/**
 * Shapes the pipeline's answer into the response every upload route gives.
 *
 * `resolveDocument` is handed to the pipeline rather than called here: it runs
 * only once the bytes have been validated and scanned, so a refused upload does
 * not leave an empty document row behind (invariant 20).
 */
async function finish(
  req: Request,
  res: Response,
  context: UploadContext,
  resolveDocument: (tx: Tx) => Promise<Document>,
  label: string
) {
  const auth = req.auth!;
  const staged = stagedFrom(req);
  if (!staged) return res.status(400).json({ error: 'No file was sent.', code: 'no_file' });

  const outcome = await publishStagedUpload({
    resolveDocument,
    visibleDocument: (id) => findDocument(auth, id),
    context,
    staged,
    uploadedByKind: auth.kind,
    uploadedById: auth.sub,
    uploadId: (res.locals.uploadId as string | undefined) ?? null,
    ip: req.ip ?? null,
  });

  if (!outcome.ok) {
    return res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
  }

  const [fresh] = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, outcome.result.document.id));
  const document = fresh ?? outcome.result.document;

  // Nothing arrived that anyone has to look at: a retry of a send that already
  // landed, or the same bytes that are already on screen. Announcing either
  // would be telling the advisor about something that did not happen.
  if (outcome.code === 'duplicate_upload' || outcome.code === 'unchanged') {
    return res.status(outcome.status).json(answerBody(outcome, document));
  }

  // The advisor hears about a client's upload; their own deliverable is not news.
  if (auth.kind === 'client') {
    await notify({
      userKind: 'provider',
      userId: document.providerId,
      type: 'upload.received',
      title: `${auth.name} sent ${document.displayName ?? document.name}`,
      body: outcome.status === 202 ? 'It is being checked before it can be opened.' : null,
      link: `/review/${document.id}`,
    });
  }
  await recordActivity({
    providerId: document.providerId,
    clientId: document.clientId,
    type: 'document',
    description: `${label}: ${document.displayName ?? document.name}`,
    actorKind: auth.kind,
    actorId: auth.sub,
    actorName: auth.name,
    targetId: document.id,
  });

  return res.status(outcome.status).json(answerBody(outcome, document));
}

/** Any handler that stages bytes must have authorized its target first. */
function withStaging(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    stageUpload(req, res, (err?: unknown) => {
      if (err) return next(err);
      handler(req, res).catch((e) => {
        // Never leave bytes behind because a handler threw.
        discardStaged(req.file?.path);
        next(e);
      });
    });
  };
}

/* --------------------------------------------- the client answers a request */

/**
 * The document this upload belongs to.
 *
 * **By default, a new one (H5).** Six receipts answering one checklist line are
 * six attachments, each with its own version history. Until H5 a second upload
 * silently became version 2 of the first — the client's second receipt
 * *replaced* their first one, and neither side was told.
 *
 * `X-Replace-Document` is how a client says "this is a better copy of that
 * one": the named document becomes the parent and the bytes become its next
 * version, which is `POST /documents/:id/versions` under a different door. The
 * header is validated before staging, so a replacement aimed at a document the
 * caller cannot see never reaches the disk (invariant 1).
 *
 * Note what stopped being a race. The old shape was select-then-insert with
 * nothing holding the request still, so four uploads against one empty request
 * all found no document and all created one (audit F3); H2 serialized them by
 * locking the request row. Creating a fresh document per upload cannot collide
 * with itself, so that lock is gone — and the version-number race it also
 * guarded now only exists on the replace path, where `recordNewVersionTx` holds
 * the document lock exactly as it does for `POST /documents/:id/versions`.
 */
async function documentForRequest(
  tx: Tx,
  req: Request,
  request: typeof schema.requests.$inferSelect,
  replacing: Document | undefined
): Promise<Document> {
  if (replacing) return replacing;

  /* Named after the file, not after the checklist line. Six receipts against
     "2024 receipts" used to be impossible; six attachments all *called* "2024
     receipts" would be the same problem wearing a different hat. The line's own
     title is already on screen above them. */
  const filename = stagedFrom(req)?.originalFilename ?? request.title;
  const now = new Date();
  const [created] = await tx
    .insert(schema.documents)
    .values({
      clientId: request.clientId,
      providerId: request.providerId,
      engagementId: request.engagementId,
      requestId: request.id,
      kind: 'client_upload',
      displayName: filename,
      category: request.category,
      name: filename,
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return created;
}

router.post(
  '/requests/:id/uploads',
  authenticate,
  uploadLimiter,
  // ---- authorize FIRST; stageUpload only runs if this calls next() ----
  (req: Request, res: Response, next: NextFunction) => {
    findRequest(req.auth!, req.params.id)
      .then(async (request) => {
        if (!request) return notFound(res);
        if (request.status === 'waived') {
          return badRequest(res, 'Your accountant has marked this item as not needed.', 'request_closed');
        }
        if (request.archivedAt) return notFound(res);
        // Only the client answers their own checklist; the advisor files ad-hoc.
        if (req.auth!.kind !== 'client') {
          return res.status(403).json({ error: 'Only the client uploads against a request.', code: 'client_only' });
        }
        const context = { clientId: request.clientId, providerId: request.providerId };
        const replacing = await replaceTargetOf(req, request.id);
        if (replacing === 'invalid') {
          return badRequest(
            res,
            'That file is not one of the ones you sent for this item.',
            'bad_replace_target'
          );
        }
        if (await settledBeforeBytes(req, res, context)) return;
        res.locals.request = request;
        res.locals.context = context;
        res.locals.replaceDocument = replacing;
        next();
      })
      .catch(next);
  },
  withStaging((req, res) =>
    finish(
      req,
      res,
      res.locals.context as UploadContext,
      (tx) => documentForRequest(tx, req, res.locals.request, res.locals.replaceDocument as Document | undefined),
      'submitted'
    )
  )
);

/* ------------------------------------------------------- ad-hoc, either side */

/**
 * A fresh document for an ad-hoc upload. An advisor filing into an engagement is
 * producing a deliverable (private until shared); a client is sending something
 * in. That one decision is what later decides who may see it.
 */
async function documentForEngagement(
  tx: Tx,
  req: Request,
  engagement: typeof schema.engagements.$inferSelect
): Promise<Document> {
  const auth = req.auth!;
  const staged = stagedFrom(req);
  const filename = staged?.originalFilename ?? 'Upload';
  const kind = auth.kind === 'provider' ? ('deliverable' as const) : ('client_upload' as const);
  const category = kind === 'deliverable' ? 'Reports' : 'Uploads';
  const now = new Date();

  const [created] = await tx
    .insert(schema.documents)
    .values({
      clientId: engagement.clientId,
      providerId: engagement.providerId,
      engagementId: engagement.id,
      kind,
      displayName: filename,
      category,
      name: filename,
      uploadedByKind: auth.kind,
      uploadedById: auth.sub,
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return created;
}

router.post(
  '/engagements/:id/uploads',
  authenticate,
  uploadLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    findEngagement(req.auth!, req.params.id)
      .then(async (engagement) => {
        if (!engagement) return notFound(res);
        if (engagement.status === 'closed') {
          return badRequest(res, 'This engagement is closed. Ask your accountant to reopen it.', 'engagement_closed');
        }

        const context = { clientId: engagement.clientId, providerId: engagement.providerId };
        if (await settledBeforeBytes(req, res, context)) return;
        res.locals.engagement = engagement;
        res.locals.context = context;
        next();
      })
      .catch(next);
  },
  withStaging((req, res) =>
    finish(
      req,
      res,
      res.locals.context as UploadContext,
      (tx) => documentForEngagement(tx, req, res.locals.engagement),
      'uploaded'
    )
  )
);

/* ------------------------------------------------ a new version of a document */

/** A client may replace their own submissions; advisor material is the advisor's. */
function mayAddVersion(doc: Document, kind: 'provider' | 'client'): boolean {
  if (kind === 'provider') return true;
  if (doc.kind === 'deliverable') return false;
  return doc.requestId !== null || doc.uploadedByKind === 'client';
}

router.post(
  '/documents/:id/versions',
  authenticate,
  uploadLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    findDocument(req.auth!, req.params.id)
      .then(async (doc) => {
        if (!doc) return notFound(res);
        if (!mayAddVersion(doc, req.auth!.kind)) return advisorOnly(res);
        if (doc.archivedAt) return badRequest(res, 'This document is archived.', 'archived');
        const context = { clientId: doc.clientId, providerId: doc.providerId };
        if (await settledBeforeBytes(req, res, context)) return;
        res.locals.document = doc;
        res.locals.context = context;
        next();
      })
      .catch(next);
  },
  withStaging((req, res) =>
    finish(
      req,
      res,
      res.locals.context as UploadContext,
      async () => res.locals.document as Document,
      'uploaded a new version of'
    )
  )
);

export default router;
