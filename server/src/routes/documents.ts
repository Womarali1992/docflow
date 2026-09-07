/**
 * Documents — kinds and versions.
 *
 * A document is a named slot in a client's file; its bytes are versions. What
 * the advisor can do to it is explicit: accept, request a correction, share,
 * unshare, archive. PATCH is organization only (title, category, which
 * engagement it belongs to) — never review state, never sharing (invariant 5).
 *
 * C5.4 closed the last of this file's compatibility ledger: `POST
 * /documents/:id/file` is gone (no screen had called it since C4.1), the list
 * answers the contracted shape, and `GET /documents/:id/download` no longer has
 * a legacy `storagePath` to fall back to — every byte is a version under
 * DATA_ROOT. The route itself stays: it is a public contract, and it resolves
 * whichever version is current.
 *
 * `DELETE /documents/:id` ARCHIVES rather than deletes — nothing a client sent
 * is ever destroyed by a click.
 */
import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import { and, desc, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { authenticate, type AuthPayload } from '../middleware/auth.js';
import { INSTRUCTIONS_MAX, NAME_MAX } from '../security/limits.js';
import { absPathForKey } from '../files/store.js';
import { recordActivity } from '../db/activity-log.js';
import { auditRequest } from '../db/audit.js';
import { contentDisposition } from '../files/filename.js';
import { serializeDocument, serializeReview } from './serialize.js';
import { notify } from '../notify.js';
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

/**
 * The document list. Filters come from the workflow columns; a client never
 * sees an unshared deliverable or an archived row.
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
          or(eq(schema.documents.kind, 'client_upload'), isNotNull(schema.documents.sharedAt))!,
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
  await db.update(schema.documents).set({ updatedAt: now }).where(eq(schema.documents.id, doc.id));

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

  await notify({
    userKind: 'client',
    userId: doc.clientId,
    type: 'deliverable.shared',
    title: `Your accountant shared: ${updated.displayName ?? updated.name}`,
    body: 'It is ready to download from your portal.',
    link: '/portal/shared',
  });
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
 * Download the document — that is, whichever version is current. A stable,
 * shareable link that does not name a version is the reason this outlived the
 * legacy tree it was built for; C2.4's per-version routes sit beside it for
 * when the caller means one specific version.
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

  if (!abs) {
    // No servable version. If something was uploaded and is still being
    // checked, say so — "no file attached" would contradict the "we received
    // it" the client was just given.
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

  const dispType = req.query.disposition === 'attachment' ? 'attachment' : 'inline';
  res.setHeader('Content-Type', mime);
  if (size) res.setHeader('Content-Length', String(size));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', contentDisposition(dispType === 'attachment' ? 'attachment' : 'inline', filename));

  const stream = fs.createReadStream(abs);
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).json({ error: 'File missing' });
    else res.destroy();
  });
  stream.pipe(res);
});

/*
 * An empty document — a named slot with no bytes yet. The upload routes create
 * their own document, so this is for the caller that wants the slot first.
 *
 * C5.4 contracted the input to the workflow model. `isRequested`, `description`,
 * `requestFrequency` and `dueDate` used to make this a second way to ask a
 * client for something; asking is what a checklist request is for (C2.2), and
 * two doors onto one idea is how they drift apart.
 */
const createSchema = z
  .object({
    clientId: z.string().uuid(),
    name: z.string().min(1).max(NAME_MAX),
    category: z.string().max(NAME_MAX).optional(),
    engagementId: z.string().uuid().optional(),
  })
  .strict();

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

  const category = data.category || 'Documents';
  const [doc] = await db
    .insert(schema.documents)
    .values({
      clientId: data.clientId,
      providerId: auth.providerId,
      name: data.name,
      displayName: data.name,
      category,
      engagementId,
      /* An advisor's own file is material they are sending; a client's is a
         submission. The old rule read the folder name, which meant renaming a
         drawer changed what a document was. */
      kind: auth.kind === 'provider' ? 'deliverable' : 'client_upload',
      uploadedByKind: auth.kind,
      uploadedById: auth.sub,
    })
    .returning();

  await recordActivity({
    providerId: auth.providerId,
    clientId: doc.clientId,
    type: 'document',
    description: `added ${doc.name}`,
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
