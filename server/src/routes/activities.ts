import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const auth = req.auth!;
  const limitRaw = parseInt((req.query.limit as string) || '50', 10);
  const limit = Math.min(Math.max(1, limitRaw), 200);
  const clientId = req.query.clientId as string | undefined;

  if (auth.kind === 'provider') {
    const conditions = [eq(schema.activities.providerId, auth.providerId)];
    if (clientId) conditions.push(eq(schema.activities.clientId, clientId));
    const list = await db
      .select()
      .from(schema.activities)
      .where(and(...conditions))
      .orderBy(desc(schema.activities.createdAt))
      .limit(limit);
    return res.json(list);
  }

  // client: only their own activity
  const list = await db
    .select()
    .from(schema.activities)
    .where(eq(schema.activities.clientId, auth.sub))
    .orderBy(desc(schema.activities.createdAt))
    .limit(limit);
  return res.json(list);
});

export default router;
