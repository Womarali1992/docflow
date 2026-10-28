/**
 * The advisor's home queue: five numbers and the ids behind them.
 *
 * Every figure is derived from live rows, never stored (invariant 15) — a
 * counter that can drift is a counter that will, and an advisor who stops
 * trusting the number stops using the screen.
 *
 * The five buckets, and why each one is its own question:
 *   readyToReview   — the client did their part; the ball is with the advisor.
 *   waitingOnClients— the ball is with the client.
 *   overdue         — waiting AND past the deadline. Deliberately overlaps.
 *   needsDecision   — the client said "I don't have this"; only the advisor
 *                     may take it off the list, so it needs a human.
 *   unreadMessages  — the thread, which is the other way work arrives.
 *
 * Each request row carries its `engagementId` so a queue row can open the
 * checklist it came from — without it the queue could only offer "here is a
 * client", which is one click short of the thing that needs doing. Since the
 * 2026-10-28 audit it also carries what a row needs to be read without opening
 * it: the engagement's title, when the line last moved (`since`), its status,
 * and — for a line ready to review — the first file to open (`documentId`),
 * so the queue goes straight to the review workspace. Rows are oldest first:
 * the client who sent something on Monday is ahead of the one from Thursday.
 *
 * Only open engagements count. A closed year is finished business, and its
 * leftover lines used to sit in "waiting on clients" forever.
 */
import { asyncRouter } from './async-router.js';
import { and, asc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { authenticate, requireProvider } from '../middleware/auth.js';
import { attachmentsByRequest } from '../workflow/attachments.js';

const router = asyncRouter();
router.use(authenticate, requireProvider);

router.get('/', async (req, res) => {
  const providerId = req.auth!.providerId;
  const now = new Date();

  const open = and(
    eq(schema.requests.providerId, providerId),
    isNull(schema.requests.archivedAt),
    eq(schema.engagements.status, 'open'),
    isNull(schema.engagements.archivedAt)
  );
  /* What every request row says about itself. */
  const row = {
    id: schema.requests.id,
    clientId: schema.requests.clientId,
    engagementId: schema.requests.engagementId,
    engagementTitle: schema.engagements.title,
    title: schema.requests.title,
    status: schema.requests.status,
    dueDate: schema.requests.dueDate,
    since: schema.requests.updatedAt,
  };
  const lines = () =>
    db
      .select(row)
      .from(schema.requests)
      .innerJoin(schema.engagements, eq(schema.engagements.id, schema.requests.engagementId));

  const [ready, waiting, needsDecision, unread] = await Promise.all([
    lines()
      .where(and(open, eq(schema.requests.status, 'submitted')))
      .orderBy(asc(schema.requests.updatedAt)),
    lines()
      .where(and(open, inArray(schema.requests.status, ['requested', 'needs_correction'])))
      .orderBy(asc(schema.requests.dueDate), asc(schema.requests.updatedAt)),
    db
      .select({ ...row, note: schema.requests.clientResponseNote })
      .from(schema.requests)
      .innerJoin(schema.engagements, eq(schema.engagements.id, schema.requests.engagementId))
      .where(
        and(
          open,
          isNotNull(schema.requests.clientResponseKind),
          // Once it has been accepted or waived the advisor has already decided.
          ne(schema.requests.status, 'accepted'),
          ne(schema.requests.status, 'waived')
        )
      )
      .orderBy(asc(schema.requests.updatedAt)),
    db
      .select({ id: schema.messages.id, clientId: schema.messages.clientId })
      .from(schema.messages)
      .where(and(eq(schema.messages.providerId, providerId), eq(schema.messages.senderKind, 'client'), isNull(schema.messages.readAt))),
  ]);

  /* The file a "ready" row opens: the line's first readable attachment, in
     the order the review workspace pages through them. One batched read. */
  const attachments = await attachmentsByRequest(ready.map((r) => r.id));
  const readyToReview = ready.map((r) => ({
    ...r,
    documentId: (attachments.get(r.id) ?? []).find((a) => a.state !== 'refused')?.documentId ?? null,
  }));

  // Overdue is a slice of "waiting", computed here so the definition lives in one place.
  const overdue = waiting.filter((r) => r.dueDate !== null && r.dueDate.getTime() < now.getTime());

  res.json({
    generatedAt: now.toISOString(),
    readyToReview: { count: readyToReview.length, ids: readyToReview.map((r) => r.id), items: readyToReview },
    waitingOnClients: { count: waiting.length, ids: waiting.map((r) => r.id), items: waiting },
    overdue: { count: overdue.length, ids: overdue.map((r) => r.id), items: overdue },
    needsDecision: { count: needsDecision.length, ids: needsDecision.map((r) => r.id), items: needsDecision },
    unreadMessages: { count: unread.length, ids: unread.map((m) => m.id), items: unread },
  });
});

export default router;
