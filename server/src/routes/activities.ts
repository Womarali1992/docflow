import { asyncRouter } from './async-router.js';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';
import type { Activity } from '../db/schema.js';

const router = asyncRouter();
router.use(authenticate);

/**
 * Where each line of the advisor's feed leads.
 *
 * Resolved here because only the server can tell what a `targetId` is: an
 * `update` names a request (accepted, corrected, waived) or an engagement
 * (started, checklist added, reminded), and both belong on the engagement
 * screen. Before the 2026-10-28 audit the browser sent every `update` to
 * `/documents/<id>`, so "View" on "accepted: W-2" landed on "That document is
 * not on your file".
 */
async function linksFor(list: Activity[]): Promise<Map<string, string | null>> {
  const targets = list.filter((a) => a.type === 'update' && a.targetId).map((a) => a.targetId as string);
  const engagementOfRequest = new Map<string, string>();
  const engagementIds = new Set<string>();
  if (targets.length) {
    const requests = await db
      .select({ id: schema.requests.id, engagementId: schema.requests.engagementId })
      .from(schema.requests)
      .where(inArray(schema.requests.id, targets));
    for (const r of requests) engagementOfRequest.set(r.id, r.engagementId);
    const engagements = await db
      .select({ id: schema.engagements.id })
      .from(schema.engagements)
      .where(inArray(schema.engagements.id, targets));
    for (const e of engagements) engagementIds.add(e.id);
  }

  const links = new Map<string, string | null>();
  for (const a of list) {
    let link: string | null = null;
    if (a.type === 'document' && a.targetId) link = `/documents/${a.targetId}`;
    else if (a.type === 'message' && a.clientId) link = `/clients/${a.clientId}`;
    else if (a.type === 'update' && a.targetId) {
      const engagementId = engagementOfRequest.get(a.targetId) ?? (engagementIds.has(a.targetId) ? a.targetId : null);
      link = engagementId ? `/engagements/${engagementId}` : a.clientId ? `/clients/${a.clientId}` : null;
    }
    links.set(a.id, link);
  }
  return links;
}

router.get('/', async (req, res) => {
  const auth = req.auth!;
  const limitRaw = parseInt((req.query.limit as string) || '50', 10);
  const limit = Math.min(Math.max(1, limitRaw), 200);
  const clientId = req.query.clientId as string | undefined;

  if (auth.kind === 'provider') {
    const conditions = [eq(schema.activities.firmId, auth.firmId)];
    if (clientId) conditions.push(eq(schema.activities.clientId, clientId));
    const list = await db
      .select()
      .from(schema.activities)
      .where(and(...conditions))
      .orderBy(desc(schema.activities.createdAt))
      .limit(limit);
    const links = await linksFor(list);
    return res.json(list.map((a) => ({ ...a, link: links.get(a.id) ?? null })));
  }

  // client: only their own activity, and no advisor links in it
  const list = await db
    .select()
    .from(schema.activities)
    .where(eq(schema.activities.clientId, auth.sub))
    .orderBy(desc(schema.activities.createdAt))
    .limit(limit);
  return res.json(list.map((a) => ({ ...a, link: null })));
});

export default router;
