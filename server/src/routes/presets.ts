import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { authenticate, requireProvider } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireProvider);

router.get('/', async (req, res) => {
  const list = await db
    .select()
    .from(schema.presets)
    .where(eq(schema.presets.providerId, req.auth!.providerId));
  res.json(list);
});

const presetSchema = z.object({
  name: z.string().min(1),
  bins: z.array(z.object({
    id: z.string(),
    label: z.string(),
    items: z.array(z.object({ name: z.string() })),
  })),
});

router.post('/', async (req, res) => {
  const parsed = presetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  const [created] = await db
    .insert(schema.presets)
    .values({
      providerId: req.auth!.providerId,
      name: parsed.data.name,
      bins: parsed.data.bins,
    })
    .returning();
  res.status(201).json(created);
});

router.delete('/:id', async (req, res) => {
  const [preset] = await db.select().from(schema.presets).where(eq(schema.presets.id, req.params.id));
  if (!preset || preset.providerId !== req.auth!.providerId) {
    return res.status(404).json({ error: 'Not found' });
  }
  await db.delete(schema.presets).where(eq(schema.presets.id, req.params.id));
  res.json({ ok: true });
});

export default router;
