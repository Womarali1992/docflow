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
 * Answers are the same across all three: 201 published, 202 stored but still
 * being checked, and a stable `code` on every refusal.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';
import { uploadLimiter } from '../security/limits.js';
import { discardStaged, stageUpload, stagedFrom } from '../files/staging.js';
import { publishStagedUpload } from '../files/publish.js';
import { recordActivity } from '../db/activity-log.js';
import { serializeDocument, serializeVersion } from './serialize.js';
import { advisorOnly, badRequest, findDocument, findEngagement, findRequest, notFound } from './scope.js';
import type { Document } from '../db/schema.js';

const router = Router();

/*
 * NOTE: this router is mounted at /api, so router-level middleware would run for
 * every API request and authenticate them a second time. `authenticate` is
 * therefore attached per route, and nothing here executes for a path that does
 * not match one of the three below.
 */

/**
 * Shapes the pipeline's answer into the response every upload route gives.
 *
 * `resolveDocument` runs only once bytes have actually arrived, so a request
 * with no file attached does not leave an empty document row behind.
 */
async function finish(req: Request, res: Response, resolveDocument: () => Promise<Document>, label: string) {
  const auth = req.auth!;
  const staged = stagedFrom(req);
  if (!staged) return res.status(400).json({ error: 'No file was sent.', code: 'no_file' });

  const document = await resolveDocument();

  const outcome = await publishStagedUpload({
    document,
    staged,
    uploadedByKind: auth.kind,
    uploadedById: auth.sub,
    ip: req.ip ?? null,
  });

  if (!outcome.ok) {
    return res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
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

  const [fresh] = await db.select().from(schema.documents).where(eq(schema.documents.id, document.id));
  return res.status(outcome.status).json({
    document: serializeDocument(fresh),
    version: serializeVersion(outcome.result.version),
    scanStatus: outcome.scanStatus,
    ...(outcome.code ? { code: outcome.code } : {}),
    ...(outcome.status === 202
      ? { message: 'Received. We are checking this file — it will appear once the check finishes.' }
      : {}),
  });
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
 * The document behind a request, created on first upload. One document per
 * request, so a re-upload becomes version 2 rather than a second row.
 */
async function documentForRequest(request: typeof schema.requests.$inferSelect): Promise<Document> {
  const [existing] = await db.select().from(schema.documents).where(eq(schema.documents.requestId, request.id));
  if (existing) return existing;

  const now = new Date();
  const [created] = await db
    .insert(schema.documents)
    .values({
      clientId: request.clientId,
      providerId: request.providerId,
      engagementId: request.engagementId,
      requestId: request.id,
      kind: 'client_upload',
      displayName: request.title,
      category: request.category,
      name: request.title,
      folder: request.category ?? 'Documents',
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
        res.locals.request = request;
        next();
      })
      .catch(next);
  },
  withStaging((req, res) => finish(req, res, () => documentForRequest(res.locals.request), 'submitted'))
);

/* ------------------------------------------------------- ad-hoc, either side */

/**
 * A fresh document for an ad-hoc upload. An advisor filing into an engagement is
 * producing a deliverable (private until shared); a client is sending something
 * in. That one decision is what later decides who may see it.
 */
async function documentForEngagement(req: Request, engagement: typeof schema.engagements.$inferSelect): Promise<Document> {
  const auth = req.auth!;
  const staged = stagedFrom(req);
  const filename = staged?.originalFilename ?? 'Upload';
  const kind = auth.kind === 'provider' ? ('deliverable' as const) : ('client_upload' as const);
  const folder = kind === 'deliverable' ? 'Reports' : 'Uploads';
  const now = new Date();

  const [created] = await db
    .insert(schema.documents)
    .values({
      clientId: engagement.clientId,
      providerId: engagement.providerId,
      engagementId: engagement.id,
      kind,
      displayName: filename,
      category: folder,
      name: filename,
      folder,
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

        res.locals.engagement = engagement;
        next();
      })
      .catch(next);
  },
  withStaging((req, res) => finish(req, res, () => documentForEngagement(req, res.locals.engagement), 'uploaded'))
);

/* ------------------------------------------------ a new version of a document */

/** A client may replace their own submissions; advisor material is the advisor's. */
function mayAddVersion(doc: Document, kind: 'provider' | 'client'): boolean {
  if (kind === 'provider') return true;
  if (doc.kind === 'deliverable') return false;
  return doc.requestId !== null || doc.uploadedByKind === 'client' || Boolean(doc.isRequested);
}

router.post(
  '/documents/:id/versions',
  authenticate,
  uploadLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    findDocument(req.auth!, req.params.id)
      .then((doc) => {
        if (!doc) return notFound(res);
        if (!mayAddVersion(doc, req.auth!.kind)) return advisorOnly(res);
        if (doc.archivedAt) return badRequest(res, 'This document is archived.', 'archived');
        res.locals.document = doc;
        next();
      })
      .catch(next);
  },
  withStaging((req, res) => finish(req, res, async () => res.locals.document as Document, 'uploaded a new version of'))
);

export default router;
