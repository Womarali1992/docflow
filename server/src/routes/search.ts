/**
 * Search across a firm's file: documents and checklist lines.
 *
 * Scoping is not a filter the caller can widen — an advisor searches their own
 * firm, a client searches their own documents and never sees an unshared
 * deliverable. A `clientId` in the query narrows an advisor's search; from a
 * client it is ignored entirely rather than honoured or rejected.
 */
import { Router } from 'express';
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';
import { NAME_MAX } from '../security/limits.js';
import { serializeDocument, serializeRequest } from './serialize.js';
import { isId } from './scope.js';

const router = Router();
router.use(authenticate);

const LIMIT = 50;

/** Escapes the LIKE wildcards so a search for "100%" does not match everything. */
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

router.get('/', async (req, res) => {
  const auth = req.auth!;
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, NAME_MAX) : '';
  const category = typeof req.query.category === 'string' ? req.query.category.slice(0, NAME_MAX) : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const yearRaw = typeof req.query.year === 'string' ? Number.parseInt(req.query.year, 10) : NaN;
  const year = Number.isFinite(yearRaw) ? yearRaw : undefined;
  const clientIdParam = typeof req.query.clientId === 'string' && isId(req.query.clientId) ? req.query.clientId : undefined;

  if (!q && !category && !status && year === undefined) {
    return res.json({ query: '', documents: [], requests: [], truncated: false });
  }

  const term = q ? likeTerm(q) : null;

  /* -------------------------------------------------------------- documents */
  const docScope =
    auth.kind === 'provider'
      ? [eq(schema.documents.providerId, auth.providerId), ...(clientIdParam ? [eq(schema.documents.clientId, clientIdParam)] : [])]
      : [
          eq(schema.documents.clientId, auth.sub),
          or(eq(schema.documents.kind, 'client_upload'), isNull(schema.documents.kind), isNotNull(schema.documents.sharedAt))!,
        ];

  const docConditions = [...docScope, isNull(schema.documents.archivedAt)];
  if (term) {
    docConditions.push(
      or(ilike(schema.documents.displayName, term), ilike(schema.documents.name, term), ilike(schema.documents.category, term))!
    );
  }
  if (category) docConditions.push(eq(schema.documents.category, category));

  let documents = await db
    .select()
    .from(schema.documents)
    .where(and(...docConditions))
    .orderBy(desc(schema.documents.uploadedAt))
    .limit(LIMIT + 1);

  // Year filters on the engagement, so it needs the engagements those documents sit in.
  if (year !== undefined) {
    const engagementIds = documents.map((d) => d.engagementId).filter((id): id is string => id !== null);
    const matching = engagementIds.length
      ? await db
          .select({ id: schema.engagements.id })
          .from(schema.engagements)
          .where(and(inArray(schema.engagements.id, engagementIds), eq(schema.engagements.taxYear, year)))
      : [];
    const keep = new Set(matching.map((e) => e.id));
    documents = documents.filter((d) => d.engagementId !== null && keep.has(d.engagementId));
  }

  /* --------------------------------------------------------------- requests */
  const reqScope =
    auth.kind === 'provider'
      ? [eq(schema.requests.providerId, auth.providerId), ...(clientIdParam ? [eq(schema.requests.clientId, clientIdParam)] : [])]
      : [eq(schema.requests.clientId, auth.sub)];

  const reqConditions = [...reqScope, isNull(schema.requests.archivedAt)];
  if (term) reqConditions.push(or(ilike(schema.requests.title, term), ilike(schema.requests.category, term))!);
  if (category) reqConditions.push(eq(schema.requests.category, category));
  if (status && ['requested', 'submitted', 'in_review', 'needs_correction', 'accepted', 'waived'].includes(status)) {
    reqConditions.push(eq(schema.requests.status, status as 'requested'));
  }
  if (year !== undefined) {
    reqConditions.push(
      sql`${schema.requests.engagementId} IN (SELECT id FROM ${schema.engagements} WHERE tax_year = ${year})`
    );
  }

  const requests = await db
    .select()
    .from(schema.requests)
    .where(and(...reqConditions))
    .orderBy(desc(schema.requests.updatedAt))
    .limit(LIMIT + 1);

  const now = new Date();
  const truncated = documents.length > LIMIT || requests.length > LIMIT;

  res.json({
    query: q,
    truncated,
    documents: documents.slice(0, LIMIT).map(serializeDocument),
    requests: requests.slice(0, LIMIT).map((r) => serializeRequest(r, now)),
  });
});

export default router;
