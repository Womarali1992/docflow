import { Router } from 'express';
import fs from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';
import { uploadSingle } from '../middleware/upload.js';
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
    if (clientId) {
      const list = await db
        .select()
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.providerId, auth.providerId),
            eq(schema.documents.clientId, clientId)
          )
        );
      return res.json(list);
    }
    const list = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.providerId, auth.providerId));
    return res.json(list);
  }

  // client
  const list = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.clientId, auth.sub));
  return res.json(list);
});

/* Get single doc */
router.get('/:id', async (req, res) => {
  const auth = req.auth!;
  const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, req.params.id));
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (auth.kind === 'provider' && doc.providerId !== auth.providerId) return res.status(403).json({ error: 'Forbidden' });
  if (auth.kind === 'client' && doc.clientId !== auth.sub) return res.status(403).json({ error: 'Forbidden' });
  res.json(doc);
});

/* Download the stored file — authenticated; works from a same-origin <a href>. */
router.get('/:id/download', async (req, res) => {
  const auth = req.auth!;
  const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, req.params.id));
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (auth.kind === 'provider' && doc.providerId !== auth.providerId) return res.status(403).json({ error: 'Forbidden' });
  if (auth.kind === 'client' && doc.clientId !== auth.sub) return res.status(403).json({ error: 'Forbidden' });
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

/* Upload / replace the file for a document (multipart field: file) */
router.post('/:id/file', uploadSingle, async (req, res) => {
  const auth = req.auth!;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file provided' });

  const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, req.params.id));
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (auth.kind === 'provider' && doc.providerId !== auth.providerId) return res.status(403).json({ error: 'Forbidden' });
  if (auth.kind === 'client' && doc.clientId !== auth.sub) return res.status(403).json({ error: 'Forbidden' });

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

  res.json(updated);
});

/* Create / request document (provider creates a request, or a metadata record) */
const createSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1),
  type: z.string().optional(),
  folder: z.string().optional(),
  isRequested: z.boolean().optional(),
  description: z.string().optional(),
  requestFrequency: z.enum(['daily', 'monthly', 'quarterly', 'yearly', 'one-time']).optional(),
  dueDate: z.string().datetime().optional(),
});

router.post('/', async (req, res) => {
  const auth = req.auth!;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  const data = parsed.data;

  // Resolve providerId based on caller
  let providerId: string;
  if (auth.kind === 'provider') {
    providerId = auth.providerId;
    // Verify client belongs to this provider
    const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, data.clientId));
    if (!c || c.providerId !== providerId) return res.status(403).json({ error: 'Forbidden' });
  } else {
    if (data.clientId !== auth.sub) return res.status(403).json({ error: 'Forbidden' });
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

  res.status(201).json(doc);
});

/* Update document metadata / status / update-requests */
const updateSchema = z.object({
  name: z.string().optional(),
  folder: z.string().optional(),
  isRequested: z.boolean().optional(),
  status: z.enum(['pending', 'reviewed', 'needs_update', 'in_review']).optional(),
  hasUpdateRequest: z.boolean().optional(),
  updateRequestDescription: z.string().optional(),
  requestedVersion: z.string().optional(),
  requestFrequency: z.enum(['daily', 'monthly', 'quarterly', 'yearly', 'one-time']).optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

router.patch('/:id', async (req, res) => {
  const auth = req.auth!;
  const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, req.params.id));
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (auth.kind === 'provider' && doc.providerId !== auth.providerId) return res.status(403).json({ error: 'Forbidden' });
  if (auth.kind === 'client' && doc.clientId !== auth.sub) return res.status(403).json({ error: 'Forbidden' });

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
    .where(eq(schema.documents.id, req.params.id))
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

  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const auth = req.auth!;
  const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, req.params.id));
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (auth.kind === 'provider' && doc.providerId !== auth.providerId) return res.status(403).json({ error: 'Forbidden' });
  if (auth.kind === 'client' && doc.clientId !== auth.sub) return res.status(403).json({ error: 'Forbidden' });
  await deleteStoredFile(doc.storagePath);
  await db.delete(schema.documents).where(eq(schema.documents.id, req.params.id));
  res.json({ ok: true });
});

export default router;
