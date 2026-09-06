/**
 * Presets — a read-only shim over request templates.
 *
 * Compatibility ledger: `presets` was the old name for a checklist, and the
 * current advisor UI still reads this endpoint. It now answers from
 * `request_templates` in the old bins shape, so the screen keeps working while
 * there is only one place the data actually lives. Writes are refused with a
 * pointer at the replacement rather than silently going to a dead table.
 *
 * Removed in C3.2, when the templates editor lands. Until then, nothing new
 * should be written against this route.
 */
import { Router } from 'express';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { authenticate, requireProvider } from '../middleware/auth.js';
import { ensureStarterTemplates, type TemplateItem } from '../workflow/starter-templates.js';

const router = Router();
router.use(authenticate, requireProvider);

const GONE = {
  error: 'Presets have been replaced by request templates. Use /api/templates.',
  code: 'use_templates',
};

/** Template items → the legacy `bins` shape, grouped by category. */
function itemsToBins(items: TemplateItem[]) {
  const byCategory = new Map<string, { id: string; label: string; items: Array<{ name: string }> }>();
  for (const item of items) {
    const label = item.category ?? 'Documents';
    const existing = byCategory.get(label) ?? { id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label, items: [] };
    existing.items.push({ name: item.title });
    byCategory.set(label, existing);
  }
  return [...byCategory.values()];
}

router.get('/', async (req, res) => {
  const providerId = req.auth!.providerId;
  await ensureStarterTemplates(providerId);

  const templates = await db
    .select()
    .from(schema.requestTemplates)
    .where(and(eq(schema.requestTemplates.providerId, providerId), isNull(schema.requestTemplates.archivedAt)))
    .orderBy(asc(schema.requestTemplates.name));

  res.json(
    templates.map((t) => ({
      id: t.id,
      providerId: t.providerId,
      name: t.name,
      bins: itemsToBins((t.items as TemplateItem[]) ?? []),
      createdAt: t.createdAt,
    }))
  );
});

router.post('/', (_req, res) => res.status(410).json(GONE));
router.delete('/:id', (_req, res) => res.status(410).json(GONE));

export default router;
