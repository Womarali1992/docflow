/**
 * Engagements — the unit of work a checklist hangs off ("2026 Individual Tax
 * Return"). The advisor creates and closes them; the client can read their own
 * and nothing else.
 *
 * State changes are explicit verbs, never a permissive PATCH (invariant 5):
 * PATCH edits wording and dates, `close` / `reopen` move the engagement.
 */
import { Router, type Request as ExpressRequest, type Response as ExpressResponse } from 'express';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { authenticate, requireProvider } from '../middleware/auth.js';
import { INSTRUCTIONS_MAX, NAME_MAX } from '../security/limits.js';
import { audit, auditRequest } from '../db/audit.js';
import { recordActivity } from '../db/activity-log.js';
import { itemsToRequests, type TemplateItem } from '../workflow/starter-templates.js';
import { serializeDocument, serializeEngagement, serializeRequest } from './serialize.js';
import { advisorOnly, badRequest, findClient, findEngagement, findTemplate, notFound } from './scope.js';

const router = Router();
router.use(authenticate);

/**
 * Load-then-check, in that order: an engagement the caller cannot see is 404 so
 * the id is never confirmed, and only a visible one turns a wrong role into 403.
 * (`POST /engagements` has no id to hide, so it keeps `requireProvider`.)
 */
async function loadForAdvisor(req: ExpressRequest, res: ExpressResponse) {
  const engagement = await findEngagement(req.auth!, req.params.id);
  if (!engagement) {
    notFound(res);
    return null;
  }
  if (req.auth!.kind !== 'provider') {
    advisorOnly(res);
    return null;
  }
  return engagement;
}

const KINDS = ['individual_tax', 'business_tax', 'other'] as const;

const createSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().min(1).max(NAME_MAX),
  kind: z.enum(KINDS).optional(),
  taxYear: z.number().int().min(1900).max(2200).nullable().optional(),
});

/* The advisor's engagements (optionally one client's); a client sees only their own. */
router.get('/', async (req, res) => {
  const auth = req.auth!;
  const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;

  const where =
    auth.kind === 'provider'
      ? clientId
        ? and(eq(schema.engagements.providerId, auth.providerId), eq(schema.engagements.clientId, clientId))
        : eq(schema.engagements.providerId, auth.providerId)
      : eq(schema.engagements.clientId, auth.sub);

  const list = await db.select().from(schema.engagements).where(where).orderBy(desc(schema.engagements.createdAt));
  res.json(list.map(serializeEngagement));
});

router.post('/', requireProvider, async (req, res) => {
  const auth = req.auth!;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });

  // A client outside the advisor's list is indistinguishable from a missing one.
  const client = await findClient(auth, parsed.data.clientId);
  if (!client) return notFound(res);

  const now = new Date();
  const [created] = await db
    .insert(schema.engagements)
    .values({
      providerId: auth.providerId,
      clientId: client.id,
      title: parsed.data.title,
      kind: parsed.data.kind ?? 'other',
      taxYear: parsed.data.taxYear ?? null,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await auditRequest(req, { action: 'engagement.created', targetType: 'engagement', targetId: created.id, clientId: client.id });
  await recordActivity({
    providerId: auth.providerId,
    clientId: client.id,
    type: 'update',
    description: `started engagement: ${created.title}`,
    actorKind: 'provider',
    actorId: auth.sub,
    actorName: auth.name,
    targetId: created.id,
  });

  res.status(201).json(serializeEngagement(created));
});

/**
 * One engagement with everything hanging off it: the checklist, the documents,
 * and each document's current version. One round trip, because this is the
 * screen both portals open on.
 */
router.get('/:id', async (req, res) => {
  const engagement = await findEngagement(req.auth!, req.params.id);
  if (!engagement) return notFound(res);
  const now = new Date();

  const requests = await db
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.engagementId, engagement.id))
    .orderBy(asc(schema.requests.sortOrder), asc(schema.requests.createdAt));

  const allDocuments = await db.select().from(schema.documents).where(eq(schema.documents.engagementId, engagement.id));
  // A client does not see a deliverable until it is shared (invariant: 404, not 403).
  const documents = req.auth!.kind === 'client' ? allDocuments.filter((d) => d.kind !== 'deliverable' || d.sharedAt !== null) : allDocuments;

  const versionIds = documents.map((d) => d.currentVersionId).filter((v): v is string => v !== null);
  const versions = versionIds.length
    ? await db.select().from(schema.documentVersions).where(inArray(schema.documentVersions.id, versionIds))
    : [];
  const versionById = new Map(versions.map((v) => [v.id, v]));

  res.json({
    engagement: serializeEngagement(engagement),
    requests: requests.map((r) => serializeRequest(r, now)),
    documents: documents.map((d) => ({
      ...serializeDocument(d),
      currentVersion: d.currentVersionId ? summarizeVersion(versionById.get(d.currentVersionId)) : null,
    })),
  });
});

/** Just enough of a version for a list row; the full shape is on /documents/:id/versions. */
function summarizeVersion(v: (typeof schema.documentVersions.$inferSelect) | undefined) {
  if (!v) return null;
  return {
    id: v.id,
    versionNo: v.versionNo,
    originalFilename: v.originalFilename,
    mimeType: v.mimeType,
    sizeBytes: v.sizeBytes,
    scanStatus: v.scanStatus,
    available: v.scanStatus === 'clean' && v.publishedAt !== null,
    createdAt: v.createdAt,
  };
}

/* Wording and dates only. Status moves through close/reopen. */
const patchSchema = z.object({
  title: z.string().min(1).max(NAME_MAX).optional(),
  kind: z.enum(KINDS).optional(),
  taxYear: z.number().int().min(1900).max(2200).nullable().optional(),
});

router.patch('/:id', async (req, res) => {
  const engagement = await loadForAdvisor(req, res);
  if (!engagement) return;

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });

  const [updated] = await db
    .update(schema.engagements)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(schema.engagements.id, engagement.id))
    .returning();
  res.json(serializeEngagement(updated));
});

router.post('/:id/close', async (req, res) => {
  const engagement = await loadForAdvisor(req, res);
  if (!engagement) return;

  const now = new Date();
  const [updated] = await db
    .update(schema.engagements)
    .set({ status: 'closed', closedAt: engagement.closedAt ?? now, updatedAt: now })
    .where(eq(schema.engagements.id, engagement.id))
    .returning();

  await auditRequest(req, {
    action: 'engagement.closed',
    targetType: 'engagement',
    targetId: engagement.id,
    clientId: engagement.clientId,
  });
  res.json(serializeEngagement(updated));
});

router.post('/:id/reopen', async (req, res) => {
  const engagement = await loadForAdvisor(req, res);
  if (!engagement) return;

  const [updated] = await db
    .update(schema.engagements)
    .set({ status: 'open', closedAt: null, updatedAt: new Date() })
    .where(eq(schema.engagements.id, engagement.id))
    .returning();
  res.json(serializeEngagement(updated));
});

/**
 * Add checklist lines: either from a template or as explicit items. Both forms
 * append, so applying a second template to an engagement adds to the list
 * rather than replacing what the client may already have answered.
 */
const itemSchema = z.object({
  key: z.string().max(NAME_MAX).optional(),
  title: z.string().min(1).max(NAME_MAX),
  category: z.string().max(NAME_MAX).nullable().optional(),
  instructions: z.string().max(INSTRUCTIONS_MAX).nullable().optional(),
  required: z.boolean().optional(),
  dueOffsetDays: z.number().int().min(0).max(3650).optional(),
});

const bulkSchema = z
  .object({
    templateId: z.string().uuid().optional(),
    items: z.array(itemSchema).max(200).optional(),
    dueDate: z.string().datetime().nullable().optional(),
  })
  .refine((v) => Boolean(v.templateId) !== Boolean(v.items), {
    message: 'Provide exactly one of templateId or items',
  });

router.post('/:id/requests', async (req, res) => {
  const auth = req.auth!;
  const engagement = await loadForAdvisor(req, res);
  if (!engagement) return;
  if (engagement.status === 'closed') {
    return badRequest(res, 'This engagement is closed. Reopen it before adding requests.', 'engagement_closed');
  }

  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });

  let items: TemplateItem[];
  if (parsed.data.templateId) {
    const template = await findTemplate(auth, parsed.data.templateId);
    if (!template) return notFound(res);
    items = (template.items as TemplateItem[]) ?? [];
  } else {
    items = (parsed.data.items ?? []).map((i, index) => ({
      key: i.key ?? `item-${index}`,
      title: i.title,
      category: i.category ?? null,
      instructions: i.instructions ?? null,
      required: i.required ?? true,
      dueOffsetDays: i.dueOffsetDays,
    }));
  }
  if (items.length === 0) return badRequest(res, 'Nothing to add: the template has no items.', 'no_items');

  const now = new Date();
  // Append after whatever is already on the list, so a second template does not
  // renumber lines the client has already been answering.
  const [last] = await db
    .select({ sortOrder: schema.requests.sortOrder })
    .from(schema.requests)
    .where(eq(schema.requests.engagementId, engagement.id))
    .orderBy(desc(schema.requests.sortOrder))
    .limit(1);
  const nextOrder = (last?.sortOrder ?? -1) + 1;

  const dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
  const values = itemsToRequests(items, { providerId: auth.providerId, clientId: engagement.clientId, engagementId: engagement.id }, now).map(
    (v, i) => ({
      ...v,
      sortOrder: nextOrder + i,
      // An explicit deadline on the call wins over the template's offset.
      dueDate: dueDate ?? v.dueDate,
    })
  );

  const created = await db.insert(schema.requests).values(values).returning();

  await audit({
    action: 'request.created',
    targetType: 'engagement',
    targetId: engagement.id,
    clientId: engagement.clientId,
    actorKind: 'provider',
    actorId: auth.sub,
    meta: { count: created.length, fromTemplate: parsed.data.templateId ?? null },
  });
  await recordActivity({
    providerId: auth.providerId,
    clientId: engagement.clientId,
    type: 'update',
    description: `requested ${created.length} document${created.length === 1 ? '' : 's'}`,
    actorKind: 'provider',
    actorId: auth.sub,
    actorName: auth.name,
    targetId: engagement.id,
  });

  res.status(201).json(created.map((r) => serializeRequest(r, now)));
});

export default router;
