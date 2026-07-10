import { Router } from 'express';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';
import { recordActivity } from '../db/activity-log.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const auth = req.auth!;
  const clientId = req.query.clientId as string | undefined;
  const documentId = req.query.documentId as string | undefined;

  let resolvedClientId: string | undefined;
  if (auth.kind === 'client') {
    resolvedClientId = auth.sub;
  } else {
    if (!clientId) return res.status(400).json({ error: 'clientId required' });
    resolvedClientId = clientId;
    // Verify client belongs to this provider
    const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, resolvedClientId));
    if (!c || c.providerId !== auth.providerId) return res.status(403).json({ error: 'Forbidden' });
  }

  const conditions = [eq(schema.messages.clientId, resolvedClientId)];
  if (documentId) conditions.push(eq(schema.messages.documentId, documentId));

  const list = await db
    .select()
    .from(schema.messages)
    .where(and(...conditions))
    .orderBy(asc(schema.messages.createdAt));
  res.json(list);
});

/* Mark messages from the other party as read (clears unread counters). */
const readSchema = z.object({
  clientId: z.string().uuid().optional(),
  documentId: z.string().uuid().optional(),
});

router.patch('/read', async (req, res) => {
  const auth = req.auth!;
  const parsed = readSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });

  let clientId: string;
  if (auth.kind === 'client') {
    clientId = auth.sub;
  } else {
    if (!parsed.data.clientId) return res.status(400).json({ error: 'clientId required' });
    clientId = parsed.data.clientId;
    const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
    if (!c || c.providerId !== auth.providerId) return res.status(403).json({ error: 'Forbidden' });
  }

  const conditions = [
    eq(schema.messages.clientId, clientId),
    isNull(schema.messages.readAt),
    sql`${schema.messages.senderKind}::text <> ${auth.kind}`,
  ];
  if (parsed.data.documentId) conditions.push(eq(schema.messages.documentId, parsed.data.documentId));

  const updated = await db
    .update(schema.messages)
    .set({ readAt: new Date() })
    .where(and(...conditions))
    .returning({ id: schema.messages.id });

  res.json({ updated: updated.length });
});

const sendSchema = z.object({
  clientId: z.string().uuid().optional(),
  documentId: z.string().uuid().optional(),
  content: z.string().min(1),
});

router.post('/', async (req, res) => {
  const auth = req.auth!;
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });

  let clientId: string;
  let providerId: string;

  if (auth.kind === 'client') {
    clientId = auth.sub;
    providerId = auth.providerId;
  } else {
    if (!parsed.data.clientId) return res.status(400).json({ error: 'clientId required' });
    clientId = parsed.data.clientId;
    providerId = auth.providerId;
    const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
    if (!c || c.providerId !== providerId) return res.status(403).json({ error: 'Forbidden' });
  }

  const [msg] = await db
    .insert(schema.messages)
    .values({
      clientId,
      providerId,
      documentId: parsed.data.documentId,
      senderKind: auth.kind,
      senderId: auth.sub,
      senderName: auth.name,
      content: parsed.data.content,
    })
    .returning();

  await recordActivity({
    providerId,
    clientId,
    type: 'message',
    description: parsed.data.documentId ? `sent message about a document` : `sent a message`,
    actorKind: auth.kind,
    actorId: auth.sub,
    actorName: auth.name,
    targetId: msg.id,
  });

  res.status(201).json(msg);
});

export default router;
