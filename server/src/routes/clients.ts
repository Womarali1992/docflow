import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { authenticate, requireProvider } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

/**
 * Column set for a client row including the three counters that used to be
 * stored columns — now computed on read via correlated subqueries so they can
 * never drift out of sync. `viewerKind` decides which side "unread" counts from.
 */
function clientColumns(viewerKind: 'provider' | 'client') {
  return {
    id: schema.clients.id,
    providerId: schema.clients.providerId,
    name: schema.clients.name,
    email: schema.clients.email,
    accountId: schema.clients.accountId,
    plan: schema.clients.plan,
    clientSince: schema.clients.clientSince,
    // Cast numeric → float8 so the API returns a JS number (not a string).
    aum: sql<number | null>`${schema.clients.aum}::float8`.as('aum'),
    lastActivity: schema.clients.lastActivity,
    createdAt: schema.clients.createdAt,
    updatedAt: schema.clients.updatedAt,
    // NOTE: the correlation must be fully qualified as "clients"."id" — a bare
    // ${schema.clients.id} renders as "id", which Postgres binds to the inner
    // table's own id column, silently making every count 0.
    documentsCount: sql<number>`(
      SELECT COUNT(*)::int FROM ${schema.documents} d
      WHERE d.client_id = ${schema.clients}."id" AND d.storage_path IS NOT NULL
    )`.as('documents_count'),
    pendingUpdates: sql<number>`(
      SELECT COUNT(*)::int FROM ${schema.documents} d
      WHERE d.client_id = ${schema.clients}."id" AND (d.is_requested = true OR d.has_update_request = true)
    )`.as('pending_updates'),
    unreadMessages: sql<number>`(
      SELECT COUNT(*)::int FROM ${schema.messages} m
      WHERE m.client_id = ${schema.clients}."id" AND m.read_at IS NULL AND m.sender_kind::text <> ${viewerKind}
    )`.as('unread_messages'),
  };
}

router.get('/', requireProvider, async (req, res) => {
  const list = await db
    .select(clientColumns('provider'))
    .from(schema.clients)
    .where(eq(schema.clients.providerId, req.auth!.providerId));
  res.json(list);
});

router.get('/:id', async (req, res) => {
  const auth = req.auth!;
  const [client] = await db
    .select(clientColumns(auth.kind))
    .from(schema.clients)
    .where(eq(schema.clients.id, req.params.id));
  if (!client) return res.status(404).json({ error: 'Not found' });

  // Provider can only see their own clients; client can only see themselves.
  // Out-of-scope ids are indistinguishable from missing ones.
  if (auth.kind === 'provider' && client.providerId !== auth.providerId) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (auth.kind === 'client' && client.id !== auth.sub) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(client);
});

const createClientSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  accountId: z.string().optional(),
  plan: z.string().optional(),
  aum: z.number().nonnegative().nullable().optional(),
  password: z.string().min(6).optional(),
});

router.post('/', requireProvider, async (req, res) => {
  const parsed = createClientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  const { name, email, accountId, plan, aum, password } = parsed.data;

  const passwordHash = password ? await bcrypt.hash(password, 10) : null;
  const [created] = await db
    .insert(schema.clients)
    .values({
      providerId: req.auth!.providerId,
      name,
      email,
      passwordHash,
      accountId: accountId || `CL-${Date.now().toString().slice(-5)}`,
      plan: plan || 'Core',
      aum: aum === null || aum === undefined ? null : String(aum),
    })
    .returning({ id: schema.clients.id });

  const [client] = await db
    .select(clientColumns('provider'))
    .from(schema.clients)
    .where(eq(schema.clients.id, created.id));
  res.status(201).json(client);
});

const updateClientSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  plan: z.string().optional(),
  aum: z.number().nonnegative().nullable().optional(),
  password: z.string().min(6).optional(),
});

router.patch('/:id', requireProvider, async (req, res) => {
  const parsed = updateClientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });

  const [existing] = await db.select().from(schema.clients).where(eq(schema.clients.id, req.params.id));
  if (!existing || existing.providerId !== req.auth!.providerId) {
    return res.status(404).json({ error: 'Not found' });
  }

  const { name, email, plan, aum, password } = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = email;
  if (plan !== undefined) updates.plan = plan;
  if (aum !== undefined) updates.aum = aum === null ? null : String(aum);
  if (password !== undefined) updates.passwordHash = await bcrypt.hash(password, 10);

  await db.update(schema.clients).set(updates).where(eq(schema.clients.id, req.params.id));

  const [client] = await db
    .select(clientColumns('provider'))
    .from(schema.clients)
    .where(eq(schema.clients.id, req.params.id));
  res.json(client);
});

export default router;
