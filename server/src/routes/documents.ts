/**
 * Documents — rebuilt around kinds and versions.
 *
 * A document is a named slot in a client's file; its bytes are versions. What
 * the advisor can do to it is explicit: accept, request a correction, share,
 * unshare, archive. PATCH is organization only (title, category, which
 * engagement it belongs to) — never review state, never sharing (invariant 5).
 *
 * Compatibility ledger, kept until C5.4:
 *   - `GET /documents` keeps the legacy list shape (C3.4 replaces the callers);
 *   - `GET /documents/:id/download` still serves the legacy `storagePath` bytes
 *     (C2.4 replaces it with per-version delivery);
 *   - `POST /documents/:id/file` still writes in place (C2.3 makes it a version);
 *   - `DELETE /documents/:id` now ARCHIVES instead of deleting — nothing a
 *     client sent is ever destroyed by a click.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import { and, desc, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { authenticate, type AuthPayload } from '../middleware/auth.js';
import { stageUpload, stagedFrom, discardStaged } from '../files/staging.js';
import { publishStagedUpload } from '../files/publish.js';
import { INSTRUCTIONS_MAX, NAME_MAX, uploadLimiter } from '../security/limits.js';
import { absPathFor, humanSize } from '../storage.js';
import { absPathForKey } from '../files/store.js';
import { recordActivity } from '../db/activity-log.js';
import { auditRequest } from '../db/audit.js';
import { serializeDocument, serializeReview } from './serialize.js';
import { advisorOnly, badRequest, findDocument, findEngagement, isId, notFound } from './scope.js';
import type { Document } from '../db/schema.js';

const router = Router();
router.use(authenticate);

export { serializeDocument };

/**
 * Loads a document for an advisor-only verb, in the order the invariants
 * require: a row the caller cannot see is 404 (they must not learn it exists),
 * and only a row they *can* see turns a wrong role into 403.
 */
async function loadForAdvisor(req: Request, res: Response): Promise<Document | null> {
  const doc = await findDocument(req.auth!, req.params.id);
  if (!doc) {
    notFound(res);
    return null;
  }
  if (req.auth!.kind !== 'provider') {
    advisorOnly(res);
    return null;
  }
  return doc;
}

/** A client may attach bytes to their own open requests and re-upload their own files — never advisor material. */
function clientMayReplaceFile(doc: Document): boolean {
  if (doc.kind === 'deliverable' || doc.folder === 'Reports') return false;
  return Boolean(doc.isRequested) || doc.requestId !== null || doc.uploadedByKind === 'client';
}

/** Strip characters that would break a Content-Disposition header. */
function safeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\r\n"\\]/g, '_').replace(/[\x00-\x1f]/g, '').trim() || 'download';
}

/**
 * The legacy list, still the shape the current frontend reads. Filters now come
 * from the workflow columns; a client never sees an unshared deliverable or an
 * archived row.
 */
router.get('/', async (req, res) => {
  const auth = req.auth!;
  const q = req.query as Record<string, string | undefined>;

  const conditions =
    auth.kind === 'provider'
      ? [eq(schema.documents.providerId, auth.providerId)]
      : [
          eq(schema.documents.clientId, auth.sub),
          // Deliverables appear only once shared; everything else is theirs already.
          or(eq(schema.documents.kind, 'client_upload'), isNull(schema.documents.kind), isNotNull(schema.documents.sharedAt))!,
        ];

  if (auth.kind === 'provider' && q.clientId && isId(q.clientId)) conditions.push(eq(schema.documents.clientId, q.clientId));
  if (q.engagementId && isId(q.engagementId)) conditions.push(eq(schema.documents.engagementId, q.engagementId));
  if (q.kind === 'client_upload' || q.kind === 'deliverable' || q.kind === 'imported') {
    conditions.push(eq(schema.documents.kind, q.kind));
  }
  if (q.includeArchived !== 'true') conditions.push(isNull(schema.documents.archivedAt));

  const list = await db
    .select()
    .from(schema.documents)
    .where(and(...conditions))
    .orderBy(desc(schema.documents.uploadedAt));
  res.json(list.map(serializeDocument));
});

router.get('/:id', async (req, res) => {
  const doc = await findDocument(req.auth!, req.params.id);
  if (!doc) return notFound(res);
  res.json(serializeDocument(doc));
});

/** The decision history for a document — who decided what, about which version. */
router.get('/:id/reviews', async (req, res) => {
  const doc = await findDocument(req.auth!, req.params.id);
  if (!doc) return notFound(res);
  const rows = await db
    .select()
    .from(schema.reviews)
    .where(eq(schema.reviews.documentId, doc.id))
    .orderBy(desc(schema.reviews.createdAt));
  res.json(rows.map(serializeReview));
});

/* ------------------------------------------------------------ advisor verbs */

const decisionSchema = z.object({ versionId: z.string().uuid().optional(), note: z.string().max(INSTRUCTIONS_MAX).optional() });

/** Accept / request a correction on an ad-hoc upload — one with no request behind it. */
async function decide(req: Request, res: Response, decision: 'accepted' | 'needs_correction') {
  const auth = req.auth!;
  const doc = await loadForAdvisor(req, res);
  if (!doc) return;
  if (doc.kind === 'deliverable') {
    return badRequest(res, 'A deliverable is your own material — there is nothing to review.', 'not_reviewable');
  }

  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  if (decision === 'needs_correction' && !parsed.data.note) {
    return res.status(400).json({ error: 'Say what needs correcting — the client sees this note.', code: 'note_required' });
  }

  let versionId = parsed.data.versionId ?? doc.currentVersionId;
  if (versionId) {
    if (!isId(versionId)) return badRequest(res, 'That version does not belong to this document.', 'version_mismatch');
    const [v] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, versionId));
    if (!v || v.documentId !== doc.id) return badRequest(res, 'That version does not belong to this document.', 'version_mismatch');
  } else {
    versionId = null;
  }

  const now = new Date();
  await db.insert(schema.reviews).values({
    documentId: doc.id,
    versionId,
    requestId: doc.requestId,
    reviewerId: auth.sub,
    decision,
    note: parsed.data.note ?? null,
    createdAt: now,
  });
  // Keep the legacy status column in step so the current UI still reads right.
  await db
    .update(schema.documents)
    .set({ status: decision === 'accepted' ? 'reviewed' : 'needs_update', updatedAt: now })
    .where(eq(schema.documents.id, doc.id));

  await auditRequest(req, {
    action: decision === 'accepted' ? 'request.accepted' : 'request.correction_requested',
    targetType: 'document',
    targetId: doc.id,
    clientId: doc.clientId,
    meta: { versionId },
  });

  const [updated] = await db.select().from(schema.documents).where(eq(schema.documents.id, doc.id));
  res.json(serializeDocument(updated));
}

router.post('/:id/accept', (req, res, next) => {
  decide(req, res, 'accepted').catch(next);
});

router.post('/:id/request-correction', (req, res, next) => {
  decide(req, res, 'needs_correction').catch(next);
});

/**
 * Sharing a deliverable is the moment it becomes visible to the client, so it
 * is a deliberate act with its own audit line — never a side effect of an edit.
 */
router.post('/:id/share', async (req, res) => {
  const auth = req.auth!;
  const doc = await loadForAdvisor(req, res);
  if (!doc) return;
  if (doc.kind !== 'deliverable') return badRequest(res, 'Only a deliverable can be shared.', 'not_a_deliverable');
  if (!doc.currentVersionId) return badRequest(res, 'There is nothing to share yet — this deliverable has no file.', 'no_file');

  const now = new Date();
  const [updated] = await db
    .update(schema.documents)
    .set({ sharedAt: doc.sharedAt ?? now, sharedById: doc.sharedById ?? auth.sub, updatedAt: now })
    .where(eq(schema.documents.id, doc.id))
    .returning();

  await auditRequest(req, { action: 'document.shared', targetType: 'document', targetId: doc.id, clientId: doc.clientId });
  await recordActivity({
    providerId: doc.providerId,
    clientId: doc.clientId,
    type: 'document',
    description: `shared ${updated.displayName ?? updated.name}`,
    actorKind: 'provider',
    actorId: auth.sub,
    actorName: auth.name,
    targetId: doc.id,
  });

  res.json(serializeDocument(updated));
});

router.post('/:id/unshare', async (req, res) => {
  const doc = await loadForAdvisor(req, res);
  if (!doc) return;
  if (doc.kind !== 'deliverable') return badRequest(res, 'Only a deliverable can be unshared.', 'not_a_deliverable');

  const [updated] = await db
    .update(schema.documents)
    .set({ sharedAt: null, sharedById: null, updatedAt: new Date() })
    .where(eq(schema.documents.id, doc.id))
    .returning();

  await auditRequest(req, { action: 'document.unshared', targetType: 'document', targetId: doc.id, clientId: doc.clientId });
  res.json(serializeDocument(updated));
});

router.post('/:id/archive', async (req, res) => {
  const doc = await loadForAdvisor(req, res);
  if (!doc) return;

  const now = new Date();
  const [updated] = await db
    .update(schema.documents)
    .set({ archivedAt: doc.archivedAt ?? now, updatedAt: now })
    .where(eq(schema.documents.id, doc.id))
    .returning();

  await auditRequest(req, { action: 'document.archived', targetType: 'document', targetId: doc.id, clientId: doc.clientId });
  res.json(serializeDocument(updated));
});

router.post('/:id/unarchive', async (req, res) => {
  const doc = await loadForAdvisor(req, res);
  if (!doc) return;
  const [updated] = await db
    .update(schema.documents)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(schema.documents.id, doc.id))
    .returning();
  res.json(serializeDocument(updated));
});

/* --------------------------------------------------------------- legacy API */

/*
 * Legacy download. Since C2.3 new bytes are versions under DATA_ROOT, so this
 * resolves the current version first and only falls back to the legacy
 * `storagePath` for rows the import left in place. C2.4 adds the per-version
 * routes with the full delivery headers; this keeps the existing link working
 * in the meantime.
 *
 * Only a published, clean version is ever served (invariant 3).
 */
router.get('/:id/download', async (req, res) => {
  const doc = await findDocument(req.auth!, req.params.id);
  if (!doc) return notFound(res);

  let abs: string | null = null;
  let filename = doc.name;
  let mime = doc.mimeType || 'application/octet-stream';
  let size = doc.sizeBytes ?? null;

  if (doc.currentVersionId) {
    const [version] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, doc.currentVersionId));
    if (version) {
      if (version.scanStatus !== 'clean' || version.publishedAt === null) {
        return res.status(409).json({ error: 'This file is still being checked.', code: 'not_available_yet' });
      }
      try {
        abs = absPathForKey(version.storageKey);
      } catch {
        return res.status(404).json({ error: 'File missing' });
      }
      filename = version.originalFilename;
      mime = version.mimeType;
      size = version.sizeBytes;
    }
  }

  if (!abs && !doc.storagePath) {
    // No current version and no legacy file. If something was uploaded and is
    // still being checked, say so — "no file attached" would contradict the
    // "we received it" the client was just given.
    const [latest] = await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, doc.id))
      .orderBy(desc(schema.documentVersions.versionNo))
      .limit(1);
    if (latest && latest.scanStatus !== 'infected') {
      return res.status(409).json({ error: 'This file is still being checked.', code: 'not_available_yet' });
    }
    if (latest) {
      return res.status(409).json({ error: 'This file did not pass the virus check.', code: 'infected' });
    }
    return res.status(404).json({ error: 'No file attached' });
  }

  if (!abs) {
    try {
      abs = absPathFor(doc.storagePath!);
    } catch {
      return res.status(404).json({ error: 'File missing' });
    }
  }

  const dispType = req.query.disposition === 'attachment' ? 'attachment' : 'inline';
  res.setHeader('Content-Type', mime);
  if (size) res.setHeader('Content-Length', String(size));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader(
    'Content-Disposition',
    `${dispType}; filename="${safeFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );

  const stream = fs.createReadStream(abs);
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).json({ error: 'File missing' });
    else res.destroy();
  });
  stream.pipe(res);
});

/*
 * Legacy upload endpoint. Since C2.3 it no longer writes in place: it runs the
 * same authorize → stage → validate → scan → publish pipeline as the new routes
 * and creates a version, so a caller that has not been updated yet still cannot
 * put unscanned bytes into the system or overwrite history.
 *
 * The response keeps the old shape (the serialized document) so the current
 * frontend is unaffected. Compatibility ledger: removed in C5.4.
 *
 * The target is resolved and authorized BEFORE the multipart body is parsed
 * (invariant 1) — `stageUpload` runs inside the callback, never before it.
 */
router.post('/:id/file', uploadLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const auth = req.auth!;
  const doc = await findDocument(auth, req.params.id);
  if (!doc) return notFound(res);
  if (auth.kind === 'client' && !clientMayReplaceFile(doc)) return advisorOnly(res);

  stageUpload(req, res, (err?: unknown) => {
    if (err) return next(err);
    legacyAttach(req, res, doc).catch((e) => {
      discardStaged(req.file?.path);
      next(e);
    });
  });
});

async function legacyAttach(req: Request, res: Response, doc: Document) {
  const auth = req.auth!;
  const staged = stagedFrom(req);
  if (!staged) return res.status(400).json({ error: 'No file provided' });

  const outcome = await publishStagedUpload({
    document: doc,
    staged,
    uploadedByKind: auth.kind,
    uploadedById: auth.sub,
    ip: req.ip ?? null,
  });
  if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error, code: outcome.code });

  const now = new Date();
  const wasRequested = doc.isRequested;
  const hadFile = Boolean(doc.storagePath) || doc.currentVersionId !== null;

  // Keep the legacy columns in step so the current UI still reads correctly
  // (Compatibility ledger). `storagePath` is deliberately NOT set: the bytes
  // live under DATA_ROOT now, and nothing new goes into server/uploads.
  const [updated] = await db
    .update(schema.documents)
    .set({
      mimeType: outcome.result.version.mimeType,
      sizeBytes: outcome.result.version.sizeBytes,
      size: humanSize(outcome.result.version.sizeBytes),
      url: `/api/documents/${doc.id}/download`,
      uploadedByKind: auth.kind,
      uploadedById: auth.sub,
      uploadedAt: now,
      isRequested: false,
      hasUpdateRequest: false,
      updateRequestedById: null,
      updateRequestedAt: null,
      updateRequestDescription: null,
      requestedVersion: null,
      status: 'pending',
      updatedAt: now,
    })
    .where(eq(schema.documents.id, doc.id))
    .returning();

  const description = wasRequested
    ? `fulfilled request: ${updated.name}`
    : hadFile
      ? `uploaded new version: ${updated.name}`
      : `uploaded ${updated.name}`;

  await recordActivity({
    providerId: updated.providerId,
    clientId: updated.clientId,
    type: 'document',
    description,
    actorKind: auth.kind,
    actorId: auth.sub,
    actorName: auth.name,
    targetId: updated.id,
  });

  res.status(outcome.status === 202 ? 202 : 200).json(serializeDocument(updated));
}

/* Create a document record (legacy shape; C2.3 replaces the upload paths). */
const createSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1).max(NAME_MAX),
  type: z.string().max(NAME_MAX).optional(),
  folder: z.string().max(NAME_MAX).optional(),
  engagementId: z.string().uuid().optional(),
  isRequested: z.boolean().optional(),
  description: z.string().max(INSTRUCTIONS_MAX).optional(),
  requestFrequency: z.enum(['daily', 'monthly', 'quarterly', 'yearly', 'one-time']).optional(),
  dueDate: z.string().datetime().optional(),
});

router.post('/', async (req, res) => {
  const auth = req.auth!;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  const data = parsed.data;

  if (auth.kind === 'provider') {
    const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, data.clientId));
    if (!c || c.providerId !== auth.providerId) return notFound(res);
  } else if (data.clientId !== auth.sub) {
    return notFound(res);
  }

  let engagementId: string | null = null;
  if (data.engagementId) {
    const engagement = await findEngagement(auth, data.engagementId);
    if (!engagement || engagement.clientId !== data.clientId) return notFound(res);
    engagementId = engagement.id;
  }

  const folder = data.folder || 'Documents';
  const [doc] = await db
    .insert(schema.documents)
    .values({
      clientId: data.clientId,
      providerId: auth.providerId,
      name: data.name,
      displayName: data.name,
      type: data.type,
      folder,
      category: folder,
      engagementId,
      kind: folder === 'Reports' ? 'deliverable' : 'client_upload',
      isRequested: data.isRequested ?? false,
      requestedById: data.isRequested ? auth.sub : null,
      requestedAt: data.isRequested ? new Date() : null,
      description: data.description,
      requestFrequency: data.requestFrequency,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      uploadedByKind: data.isRequested ? null : auth.kind,
      uploadedById: data.isRequested ? null : auth.sub,
    })
    .returning();

  await recordActivity({
    providerId: auth.providerId,
    clientId: doc.clientId,
    type: data.isRequested ? 'update' : 'document',
    description: data.isRequested ? `requested ${doc.name}` : `uploaded ${doc.name}`,
    actorKind: auth.kind,
    actorId: auth.sub,
    actorName: auth.name,
    targetId: doc.id,
  });

  res.status(201).json(serializeDocument(doc));
});

/**
 * Organization only: what it is called, which drawer it is in, which engagement
 * it belongs to. Review state, sharing and archiving are the verbs above.
 *
 * The legacy review fields are still accepted so the current UI keeps working
 * (Compatibility ledger, removed in C3.4) — but only for an advisor, as C0.2
 * established.
 */
/**
 * Filing only (C3.4). The legacy review fields — `status`, `hasUpdateRequest`,
 * `updateRequestDescription`, `requestedVersion`, `isRequested`,
 * `requestFrequency`, `dueDate`, `name`, `folder` — were removed with the last
 * screen that sent them: a review is a decision with a note and an audit line
 * (`POST /:id/accept`, `/request-correction`, or the request's own verbs), never
 * a PATCH that quietly sets a column. The columns themselves stay until C5.4;
 * only the door into them is closed.
 */
const patchSchema = z
  .object({
    displayName: z.string().min(1).max(NAME_MAX).optional(),
    category: z.string().max(NAME_MAX).nullable().optional(),
    engagementId: z.string().uuid().nullable().optional(),
  })
  .strict();

router.patch('/:id', async (req, res) => {
  const auth = req.auth!;
  const doc = await findDocument(auth, req.params.id);
  if (!doc) return notFound(res);
  if (auth.kind !== 'provider') return advisorOnly(res);

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    // A caller still sending a review field gets told where the decision lives.
    const unknown = parsed.error.issues.some((i) => i.code === 'unrecognized_keys');
    return res.status(400).json({
      error: unknown
        ? 'Only the filing can be patched. Accept, request a correction or waive through their own actions.'
        : 'Invalid input',
      code: unknown ? 'use_review_actions' : undefined,
      issues: parsed.error.issues,
    });
  }

  if (parsed.data.engagementId) {
    const engagement = await findEngagement(auth, parsed.data.engagementId);
    if (!engagement || engagement.clientId !== doc.clientId) return notFound(res);
  }

  const [updated] = await db
    .update(schema.documents)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(schema.documents.id, doc.id))
    .returning();

  res.json(serializeDocument(updated));
});

/**
 * DELETE archives. Bytes a client sent are never destroyed by a click — C5.x
 * adds a deliberate, audited purge if the firm ever needs one.
 */
router.delete('/:id', async (req, res) => {
  const doc = await loadForAdvisor(req, res);
  if (!doc) return;

  const now = new Date();
  await db
    .update(schema.documents)
    .set({ archivedAt: doc.archivedAt ?? now, updatedAt: now })
    .where(eq(schema.documents.id, doc.id));

  await auditRequest(req, { action: 'document.archived', targetType: 'document', targetId: doc.id, clientId: doc.clientId });
  res.json({ ok: true, archived: true });
});

export default router;
