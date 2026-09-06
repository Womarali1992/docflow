/**
 * Request templates — the checklists an advisor starts an engagement from.
 *
 * The two starter templates are seeded on the first `GET /templates` so a new
 * advisor never faces an empty screen. They are ordinary rows after that: once
 * this provider has any template at all, nothing is ever seeded again, so a
 * deliberately cleared list stays cleared.
 */
import { Router } from 'express';
import { asc, eq, isNull, and } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { authenticate, requireProvider } from '../middleware/auth.js';
import { INSTRUCTIONS_MAX, NAME_MAX } from '../security/limits.js';
import { ensureStarterTemplates } from '../workflow/starter-templates.js';
import { serializeTemplate } from './serialize.js';
import { findTemplate, notFound } from './scope.js';

const router = Router();
router.use(authenticate, requireProvider);

const itemSchema = z.object({
  key: z.string().min(1).max(NAME_MAX),
  title: z.string().min(1).max(NAME_MAX),
  category: z.string().max(NAME_MAX).nullable().optional(),
  instructions: z.string().max(INSTRUCTIONS_MAX).nullable().optional(),
  required: z.boolean().optional(),
  dueOffsetDays: z.number().int().min(0).max(3650).optional(),
});

const templateSchema = z.object({
  name: z.string().min(1).max(NAME_MAX),
  kind: z.enum(['individual_tax', 'business_tax', 'custom']).optional(),
  items: z.array(itemSchema).min(1).max(200),
});

router.get('/', async (req, res) => {
  const providerId = req.auth!.providerId;
  await ensureStarterTemplates(providerId);

  const list = await db
    .select()
    .from(schema.requestTemplates)
    .where(and(eq(schema.requestTemplates.providerId, providerId), isNull(schema.requestTemplates.archivedAt)))
    .orderBy(asc(schema.requestTemplates.name));
  res.json(list.map(serializeTemplate));
});

router.post('/', async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });

  const now = new Date();
  const [created] = await db
    .insert(schema.requestTemplates)
    .values({
      providerId: req.auth!.providerId,
      name: parsed.data.name,
      kind: parsed.data.kind ?? 'custom',
      items: parsed.data.items,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  res.status(201).json(serializeTemplate(created));
});

router.get('/:id', async (req, res) => {
  const template = await findTemplate(req.auth!, req.params.id);
  if (!template) return notFound(res);
  res.json(serializeTemplate(template));
});

router.patch('/:id', async (req, res) => {
  const template = await findTemplate(req.auth!, req.params.id);
  if (!template) return notFound(res);

  const parsed = templateSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });

  const [updated] = await db
    .update(schema.requestTemplates)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(schema.requestTemplates.id, template.id))
    .returning();
  res.json(serializeTemplate(updated));
});

/**
 * Archives rather than deletes: engagements already built from this template
 * keep their `templateItemKey` references, and an advisor who removes a
 * checklist should not silently change last year's file.
 */
router.delete('/:id', async (req, res) => {
  const template = await findTemplate(req.auth!, req.params.id);
  if (!template) return notFound(res);

  await db
    .update(schema.requestTemplates)
    .set({ archivedAt: template.archivedAt ?? new Date(), updatedAt: new Date() })
    .where(eq(schema.requestTemplates.id, template.id));
  res.json({ ok: true, archived: true });
});

export default router;
