/**
 * Notifications — server-side unread state for everything that is not a message
 * (invariant 15: the client never computes its own badge).
 *
 * The table is filled in C4.3, when reminders and portal events start writing to
 * it. The read side exists now so both portals can be built against a real
 * endpoint rather than a placeholder, and it correctly returns an empty list.
 */
import { asyncRouter } from './async-router.js';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';

const router = asyncRouter();
router.use(authenticate);

const LIMIT = 50;

router.get('/', async (req, res) => {
  const auth = req.auth!;
  const unreadOnly = req.query.unread === 'true';

  const conditions = [eq(schema.notifications.userKind, auth.kind), eq(schema.notifications.userId, auth.sub)];
  if (unreadOnly) conditions.push(isNull(schema.notifications.readAt));

  const rows = await db
    .select()
    .from(schema.notifications)
    .where(and(...conditions))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(LIMIT);

  const unread = rows.filter((n) => n.readAt === null).length;
  res.json({ unread, notifications: rows });
});

const readSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200).optional() });

/** Marks the caller's own notifications read — `ids` for some, no body for all. */
router.post('/read', async (req, res) => {
  const auth = req.auth!;
  const parsed = readSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });

  // Scoped to the caller: an id from someone else's list simply matches nothing.
  const conditions = [
    eq(schema.notifications.userKind, auth.kind),
    eq(schema.notifications.userId, auth.sub),
    isNull(schema.notifications.readAt),
  ];
  if (parsed.data.ids?.length) conditions.push(inArray(schema.notifications.id, parsed.data.ids));

  const updated = await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(...conditions))
    .returning({ id: schema.notifications.id });

  res.json({ ok: true, marked: updated.length });
});

export default router;
