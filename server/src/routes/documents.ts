import { Router, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { authenticate, type AuthPayload } from '../middleware/auth.js';
import { uploadSingle } from '../middleware/upload.js';
import { INSTRUCTIONS_MAX, NAME_MAX } from '../security/limits.js';
import {
  absPathFor,
  deleteStoredFile,
  humanSize,
  storedFileName,
  writeStoredFile,
} from '../storage.js';
import { recordActivity } from '../db/activity-log.js';

const router = Router();
router.use(authenticate);

type DocumentRow = typeof schema.documents.$inferSelect;

/**
 * Public shape of a document. Storage details never leave the server; the
 * frontend only needs to know whether bytes exist.
 */
export function serializeDocument(doc: DocumentRow) {
  const { storagePath, ...rest } = doc;
  return { ...rest, hasFile: !!storagePath };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Load a document the caller is allowed to see. Returns null when it does not
 * exist OR belongs to another tenant; callers answer 404 either way, so an id
 * never confirms existence across tenants.
 */
async function findScopedDocument(auth: AuthPayload, id: string): Promise<DocumentRow | null> {
  if (!UUID_RE.test(id)) return null;
  const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
  if (!doc) return null;
  if (auth.kind === 'provider' && doc.providerId !== auth.providerId) return null;
  if (auth.kind === 'client' && doc.clientId !== auth.sub) return null;
  return doc;
}

const notFound = (res: Response) => res.status(404).json({ error: 'Not found' });
const advisorOnly = (res: Response) =>
  res.status(403).json({ error: 'Only your advisor can do that.' });

/** A client may attach bytes to their own open requests and re-upload their own files — never to advisor material. */
function clientMayReplaceFile(doc: DocumentRow): boolean {
  if (doc.folder === 'Reports') return false;
  return !!doc.isRequested || doc.uploadedByKind === 'client';
}

/** Strip characters that would break a Content-Disposition header. */
function safeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\r\n"\\]/g, '_').replace(/[\x00-\x1f]/g, '').trim() || 'download';
}

/* List documents — scoped by auth */
router.get('/', async (req, res) => {
  const auth = req.auth!;
  const clientId = req.query.clientId as string | undefined;

  if (auth.kind === 'provider') {
    const conditions = [eq(schema.documents.providerId, auth.providerId)];
    if (clientId) conditions.push(eq(schema.documents.clientId, clientId));
    const list = await db
      .select()
      .from(schema.documents)
      .where(and(...conditions));
    return res.json(list.map(serializeDocument));
  }

  // client
  const list = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.clientId, auth.sub));
  return res.json(list.map(serializeDocument));
});

/* Get single doc */
router.get('/:id', async (req, res) => {
  const doc = await findScopedDocument(req.auth!, req.params.id);
  if (!doc) return notFound(res);
  res.json(serializeDocument(doc));
});

/* Download the stored file — authenticated; works from a same-origin <a href>. */
router.get('/:id/download', async (req, res) => {
  const doc = await findScopedDocument(req.auth!, req.params.id);
  if (!doc) return notFound(res);
  if (!doc.storagePath) return res.status(404).json({ error: 'No file attached' });

  let abs: string;
  try {
    abs = absPathFor(doc.storagePath);
  } catch {
    return res.status(404).json({ error: 'File missing' });
  }

  const dispType = req.query.disposition === 'attachment' ? 'attachment' : 'inline';
  const filename = safeFilename(doc.name);
  res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
  if (doc.sizeBytes) res.setHeader('Content-Length', String(doc.sizeBytes));
  res.setHeader(
    'Content-Disposition',
    `${dispType}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(doc.name)}`
  );

  const stream = fs.createReadStream(abs);
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).json({ error: 'File missing' });
    else res.destroy();
  });
  stream.pipe(res);
});

/* Upload / replace the file for a document (multipart field: file).
   The target is resolved and authorized BEFORE the multipart body is parsed. */
router.post('/:id/file', async (req: Request, res: Response, next: NextFunction) => {
  const auth = req.auth!;
  const doc = await findScopedDocument(auth, req.params.id);
  if (!doc) return notFound(res);
  if (auth.kind === 'client' && !clientMayReplaceFile(doc)) return advisorOnly(res);

  uploadSingle(req, res, (err?: unknown) => {
    if (err) return next(err);
    attachFile(req, res, doc).catch(next);
  });
});

async function attachFile(req: Request, res: Response, doc: DocumentRow) {
  const auth = req.auth!;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file provided' });

  const fileName = storedFileName(doc.id, file.mimetype);
  // Clean up a previous file if the extension changed (otherwise it's overwritten in place).
  if (doc.storagePath && doc.storagePath !== fileName) {
    await deleteStoredFile(doc.storagePath);
  }
  await writeStoredFile(fileName, file.buffer);

  const wasRequested = doc.isRequested;
  const hadFile = !!doc.storagePath;

  const [updated] = await db
    .update(schema.documents)
    .set({
      storagePath: fileName,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      size: humanSize(file.size),
      url: `/api/documents/${doc.id}/download`,
      uploadedByKind: auth.kind,
      uploadedById: auth.sub,
      uploadedAt: new Date(),
      isRequested: false,
      hasUpdateRequest: false,
      updateRequestedById: null,
      updateRequestedAt: null,
      updateRequestDescription: null,
      requestedVersion: null,
      status: 'pending',
      updatedAt: new Date(),
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

  res.json(serializeDocument(updated));
}

/* Create / request document (provider creates a request, or a metadata record) */
const createSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1).max(NAME_MAX),
  type: z.string().optional(),
  folder: z.string().optional(),
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

  // Resolve providerId based on caller. A client id outside the caller's scope
  // is indistinguishable from a missing one.
  let providerId: string;
  if (auth.kind === 'provider') {
    providerId = auth.providerId;
    const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, data.clientId));
    if (!c || c.providerId !== providerId) return notFound(res);
  } else {
    if (data.clientId !== auth.sub) return notFound(res);
    providerId = auth.providerId;
  }

  const [doc] = await db
    .insert(schema.documents)
    .values({
      clientId: data.clientId,
      providerId,
      name: data.name,
      type: data.type,
      folder: data.folder || 'Documents',
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
    providerId,
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

/* Update document metadata / status / update-requests — advisor only */
const updateSchema = z.object({
  name: z.string().min(1).max(NAME_MAX).optional(),
  folder: z.string().optional(),
  isRequested: z.boolean().optional(),
  status: z.enum(['pending', 'reviewed', 'needs_update', 'in_review']).optional(),
  hasUpdateRequest: z.boolean().optional(),
  updateRequestDescription: z.string().max(INSTRUCTIONS_MAX).optional(),
  requestedVersion: z.string().optional(),
  requestFrequency: z.enum(['daily', 'monthly', 'quarterly', 'yearly', 'one-time']).optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

router.patch('/:id', async (req, res) => {
  const auth = req.auth!;
  const doc = await findScopedDocument(auth, req.params.id);
  if (!doc) return notFound(res);
  if (auth.kind !== 'provider') return advisorOnly(res);

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });

  const updates: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };

  // dueDate: explicit null clears it; a string becomes a Date.
  if (parsed.data.dueDate === null) updates.dueDate = null;
  else if (parsed.data.dueDate) updates.dueDate = new Date(parsed.data.dueDate);

  // Update-request lifecycle: stamp on open, clear on resolve.
  if (parsed.data.hasUpdateRequest === true) {
    updates.updateRequestedById = auth.sub;
    updates.updateRequestedAt = new Date();
    if (parsed.data.status === undefined) updates.status = 'needs_update';
  } else if (parsed.data.hasUpdateRequest === false) {
    updates.updateRequestedById = null;
    updates.updateRequestedAt = null;
    updates.updateRequestDescription = null;
    updates.requestedVersion = null;
  }

  const [updated] = await db
    .update(schema.documents)
    .set(updates)
    .where(eq(schema.documents.id, doc.id))
    .returning();

  // Record activity for meaningful changes
  let description: string | null = null;
  let activityType: 'document' | 'update' = 'document';
  if (parsed.data.status === 'reviewed' && doc.status !== 'reviewed') {
    description = `marked reviewed: ${updated.name}`;
    activityType = 'update';
  } else if (parsed.data.hasUpdateRequest && !doc.hasUpdateRequest) {
    description = `requested update on: ${updated.name}`;
    activityType = 'update';
  }
  if (description) {
    await recordActivity({
      providerId: updated.providerId,
      clientId: updated.clientId,
      type: activityType,
      description,
      actorKind: auth.kind,
      actorId: auth.sub,
      actorName: auth.name,
      targetId: updated.id,
    });
  }

  res.json(serializeDocument(updated));
});

/* Delete — advisor only */
router.delete('/:id', async (req, res) => {
  const auth = req.auth!;
  const doc = await findScopedDocument(auth, req.params.id);
  if (!doc) return notFound(res);
  if (auth.kind !== 'provider') return advisorOnly(res);
  await deleteStoredFile(doc.storagePath);
  await db.delete(schema.documents).where(eq(schema.documents.id, doc.id));
  res.json({ ok: true });
});

export default router;
