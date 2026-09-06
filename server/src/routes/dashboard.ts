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
 */
import { Router } from 'express';
import { and, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { authenticate, requireProvider } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireProvider);

router.get('/', async (req, res) => {
  const providerId = req.auth!.providerId;
  const now = new Date();

  const open = and(eq(schema.requests.providerId, providerId), isNull(schema.requests.archivedAt));

  const [readyToReview, waiting, needsDecision, unread] = await Promise.all([
    db
      .select({ id: schema.requests.id, clientId: schema.requests.clientId, title: schema.requests.title })
      .from(schema.requests)
      .where(and(open, eq(schema.requests.status, 'submitted'))),
    db
      .select({ id: schema.requests.id, clientId: schema.requests.clientId, title: schema.requests.title, dueDate: schema.requests.dueDate })
      .from(schema.requests)
      .where(and(open, inArray(schema.requests.status, ['requested', 'needs_correction']))),
    db
      .select({ id: schema.requests.id, clientId: schema.requests.clientId, title: schema.requests.title, note: schema.requests.clientResponseNote })
      .from(schema.requests)
      .where(
        and(
          open,
          isNotNull(schema.requests.clientResponseKind),
          // Once it has been accepted or waived the advisor has already decided.
          ne(schema.requests.status, 'accepted'),
          ne(schema.requests.status, 'waived')
        )
      ),
    db
      .select({ id: schema.messages.id, clientId: schema.messages.clientId })
      .from(schema.messages)
      .where(and(eq(schema.messages.providerId, providerId), eq(schema.messages.senderKind, 'client'), isNull(schema.messages.readAt))),
  ]);

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
