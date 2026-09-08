/**
 * Requests — one line of a checklist, and the review loop that runs on it.
 *
 * The state machine, which is the whole point of this file:
 *
 *   requested ──upload──▶ submitted ──accept──────────▶ accepted
 *       ▲                     │                            │
 *       │                     └──request-correction──▶ needs_correction
 *       │                                                  │
 *       └──────────── reopen ◀── waived ◀──waive──── (any) ─┘
 *                                                     (upload again → submitted)
 *
 * Two rules worth stating plainly:
 *   - Only the advisor decides. A client's "I don't have this" is recorded as a
 *     *response*, and leaves the status alone, so nothing disappears from the
 *     advisor's list without them agreeing to it.
 *   - Waiving needs a written reason. "Why is this not on the list any more?"
 *     is a question the file has to be able to answer a year later.
 *
 * Every move is an explicit verb (invariant 5). PATCH only edits wording,
 * category, deadline and order.
 */
import { type Request as ExpressRequest, type Response as ExpressResponse } from 'express';
import { asyncRouter } from './async-router.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';
import { INSTRUCTIONS_MAX, NAME_MAX } from '../security/limits.js';
import { auditRequest } from '../db/audit.js';
import { decidableVersions, refusalBody, type DecisionRefusal } from '../workflow/publish.js';
import { attachmentsForRequest, documentsForRequest } from '../workflow/attachments.js';
import { recordActivity } from '../db/activity-log.js';
import { serializeRequest } from './serialize.js';
import { advisorOnly, badRequest, clientOnly, findRequest, notFound } from './scope.js';
import { notify } from '../notify.js';
import type { Request as RequestRow } from '../db/schema.js';

const router = asyncRouter();
router.use(authenticate);

/**
 * Load-then-check: a request the caller cannot see is 404 (the id is never
 * confirmed); only a visible one turns a wrong role into 403.
 */
async function loadForAdvisor(req: ExpressRequest, res: ExpressResponse) {
  const request = await findRequest(req.auth!, req.params.id);
  if (!request) {
    notFound(res);
    return null;
  }
  if (req.auth!.kind !== 'provider') {
    advisorOnly(res);
    return null;
  }
  return request;
}

/**
 * The version ids a decision is about.
 *
 * `versionIds` is the H5 form — a request holds several attachments and a
 * decision is about all of them — and `versionId` is still accepted as the
 * one-element spelling, so a client that has not been reloaded keeps working
 * against a request with one attachment.
 */
function namedVersions(body: { versionId?: string; versionIds?: string[] }): string[] {
  if (body.versionIds?.length) return body.versionIds;
  return body.versionId ? [body.versionId] : [];
}

/**
 * Accept and request-correction, which are the same transaction with a
 * different word in it: check that the decision names the versions the advisor
 * was actually reading, write a review per attachment, move the request, and
 * record it — all with the documents locked, all or nothing.
 *
 * Before H2 this was three unlocked steps, so an advisor deciding about v1
 * while v2 landed got a 200 and a review row pointing at a file nobody had
 * looked at (audit F5). `decidableVersions` is the guard; a 409 `stale_version`
 * is what the review workspace turns into "Refresh and read that one".
 *
 * H5 made it plural. Six receipts on one line are six attachments, and
 * accepting the line accepts all six — so there are six review rows, each
 * naming its own document and version, and one status change. A file arriving
 * on any of them while the advisor read is the same 409 as a replacement of the
 * one they were looking at: the set they decided is no longer the set on file.
 */
interface DecisionInput {
  request: RequestRow;
  decision: 'accepted' | 'needs_correction';
  nextStatus: 'accepted' | 'needs_correction';
  namedVersionIds: string[];
  note: string | null;
  action: 'request.accepted' | 'request.correction_requested';
}

type DecisionResult = { ok: true; versionIds: string[]; now: Date } | DecisionRefusal;

async function recordDecision(req: ExpressRequest, input: DecisionInput): Promise<DecisionResult> {
  const auth = req.auth!;
  const now = new Date();

  return db.transaction(async (tx): Promise<DecisionResult> => {
    const documents = await documentsForRequest(input.request.id, tx);

    const decidable = await decidableVersions(
      tx,
      documents.map((d) => d.id),
      input.namedVersionIds
    );
    if (!decidable.ok) return decidable;

    for (const decision of decidable.decisions) {
      await tx.insert(schema.reviews).values({
        documentId: decision.documentId,
        versionId: decision.versionId,
        requestId: input.request.id,
        reviewerId: auth.sub,
        decision: input.decision,
        note: input.note,
        createdAt: now,
      });
    }

    await tx
      .update(schema.requests)
      .set({ status: input.nextStatus, updatedAt: now })
      .where(eq(schema.requests.id, input.request.id));

    const versionIds = decidable.decisions.map((d) => d.versionId);

    // The decision and the record of it are one fact (F10): inside the
    // transaction, so a failed audit rolls the decision back rather than
    // leaving a change nobody can account for.
    await auditRequest(
      req,
      {
        action: input.action,
        targetType: 'request',
        targetId: input.request.id,
        clientId: input.request.clientId,
        // `versionId` stays for the single-attachment case, which is what every
        // audit line written before H5 looks like.
        meta: { versionId: versionIds[0] ?? null, versionIds },
      },
      tx
    );

    return { ok: true, versionIds, now };
  });
}

/** The request as it stands, with its attachments, ready to answer with. */
async function freshRequest(requestId: string, now: Date) {
  const [updated] = await db.select().from(schema.requests).where(eq(schema.requests.id, requestId));
  return serializeRequest(updated, now, await attachmentsForRequest(requestId));
}

/* Wording, category, deadline and order. Never status. */
const patchSchema = z.object({
  title: z.string().min(1).max(NAME_MAX).optional(),
  instructions: z.string().max(INSTRUCTIONS_MAX).nullable().optional(),
  category: z.string().max(NAME_MAX).nullable().optional(),
  required: z.boolean().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

router.get('/:id', async (req, res) => {
  const request = await findRequest(req.auth!, req.params.id);
  if (!request) return notFound(res);
  res.json(serializeRequest(request, new Date(), await attachmentsForRequest(request.id)));
});

router.patch('/:id', async (req, res) => {
  const request = await loadForAdvisor(req, res);
  if (!request) return;

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });

  const { dueDate, ...rest } = parsed.data;
  const updates: Partial<typeof schema.requests.$inferInsert> = { ...rest, updatedAt: new Date() };
  if (dueDate !== undefined) updates.dueDate = dueDate === null ? null : new Date(dueDate);

  const [updated] = await db.update(schema.requests).set(updates).where(eq(schema.requests.id, request.id)).returning();
  res.json(serializeRequest(updated, new Date(), await attachmentsForRequest(request.id)));
});

/* ------------------------------------------------------------ advisor verbs */

const acceptSchema = z.object({
  versionId: z.string().uuid().optional(),
  versionIds: z.array(z.string().uuid()).max(200).optional(),
  note: z.string().max(INSTRUCTIONS_MAX).optional(),
});

router.post('/:id/accept', async (req, res) => {
  const auth = req.auth!;
  const request = await loadForAdvisor(req, res);
  if (!request) return;

  const parsed = acceptSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });

  if (request.status === 'requested' || request.status === 'waived') {
    return badRequest(res, 'There is nothing to accept yet — no document has been submitted.', 'nothing_submitted');
  }

  const outcome = await recordDecision(req, {
    request,
    decision: 'accepted',
    nextStatus: 'accepted',
    namedVersionIds: namedVersions(parsed.data),
    note: parsed.data.note ?? null,
    action: 'request.accepted',
  });
  if (!outcome.ok) return res.status(outcome.status).json(refusalBody(outcome));
  const { now } = outcome;

  await notify({
    userKind: 'client',
    userId: request.clientId,
    type: 'request.accepted',
    title: `Accepted: ${request.title}`,
    body: 'Nothing more to do for this one.',
    link: '/portal/requests',
  });
  await recordActivity({
    providerId: request.providerId,
    clientId: request.clientId,
    type: 'update',
    description: `accepted: ${request.title}`,
    actorKind: 'provider',
    actorId: auth.sub,
    actorName: auth.name,
    targetId: request.id,
  });

  res.json(await freshRequest(request.id, now));
});

const correctionSchema = z.object({
  versionId: z.string().uuid().optional(),
  versionIds: z.array(z.string().uuid()).max(200).optional(),
  note: z.string().min(1).max(INSTRUCTIONS_MAX),
});

router.post('/:id/request-correction', async (req, res) => {
  const auth = req.auth!;
  const request = await loadForAdvisor(req, res);
  if (!request) return;

  const parsed = correctionSchema.safeParse(req.body);
  if (!parsed.success) {
    // The note is the whole point: the client has to be told what to fix.
    return res.status(400).json({ error: 'Say what needs correcting — the client sees this note.', code: 'note_required', issues: parsed.error.issues });
  }

  if (request.status === 'requested' || request.status === 'waived') {
    return badRequest(res, 'There is nothing to correct yet — no document has been submitted.', 'nothing_submitted');
  }

  const outcome = await recordDecision(req, {
    request,
    decision: 'needs_correction',
    nextStatus: 'needs_correction',
    namedVersionIds: namedVersions(parsed.data),
    note: parsed.data.note,
    action: 'request.correction_requested',
  });
  if (!outcome.ok) return res.status(outcome.status).json(refusalBody(outcome));
  const { now } = outcome;

  await notify({
    userKind: 'client',
    userId: request.clientId,
    type: 'request.correction',
    title: `Another look needed: ${request.title}`,
    body: 'Your accountant has left a note about what to send instead.',
    link: '/portal',
  });
  await recordActivity({
    providerId: request.providerId,
    clientId: request.clientId,
    type: 'update',
    description: `asked for a correction: ${request.title}`,
    actorKind: 'provider',
    actorId: auth.sub,
    actorName: auth.name,
    targetId: request.id,
  });

  res.json(await freshRequest(request.id, now));
});

const waiveSchema = z.object({ reason: z.string().min(1).max(INSTRUCTIONS_MAX) });

router.post('/:id/waive', async (req, res) => {
  const auth = req.auth!;
  const request = await loadForAdvisor(req, res);
  if (!request) return;

  const parsed = waiveSchema.safeParse(req.body);
  if (!parsed.success) {
    // A year from now, "why isn't this on the list?" needs an answer.
    return res.status(400).json({ error: 'Give a reason for waiving this — it stays on the file.', code: 'reason_required' });
  }

  const now = new Date();
  const [updated] = await db
    .update(schema.requests)
    .set({ status: 'waived', waivedReason: parsed.data.reason, waivedAt: now, waivedById: auth.sub, updatedAt: now })
    .where(eq(schema.requests.id, request.id))
    .returning();

  await auditRequest(req, {
    action: 'request.waived',
    targetType: 'request',
    targetId: request.id,
    clientId: request.clientId,
    meta: { reason: parsed.data.reason },
  });
  await recordActivity({
    providerId: request.providerId,
    clientId: request.clientId,
    type: 'update',
    description: `waived: ${request.title}`,
    actorKind: 'provider',
    actorId: auth.sub,
    actorName: auth.name,
    targetId: request.id,
  });

  res.json(serializeRequest(updated, now, await attachmentsForRequest(request.id)));
});

/** Puts a decided request back in play — back to `submitted` if an answer is on file. */
router.post('/:id/reopen', async (req, res) => {
  const request = await loadForAdvisor(req, res);
  if (!request) return;

  const documents = await documentsForRequest(request.id);
  const now = new Date();
  const [updated] = await db
    .update(schema.requests)
    .set({
      status: documents.some((d) => d.currentVersionId) ? 'submitted' : 'requested',
      waivedReason: null,
      waivedAt: null,
      waivedById: null,
      updatedAt: now,
    })
    .where(eq(schema.requests.id, request.id))
    .returning();

  res.json(serializeRequest(updated, now, await attachmentsForRequest(request.id)));
});

/* ------------------------------------------------------------- client verbs */

const respondSchema = z.object({
  kind: z.literal('not_applicable'),
  note: z.string().max(INSTRUCTIONS_MAX).optional(),
});

/**
 * "I don't have this." Recorded against the request and surfaced to the advisor
 * under "Needs decision" — deliberately NOT a status change, because only the
 * advisor gets to take something off the checklist.
 */
router.post('/:id/respond', async (req, res) => {
  const auth = req.auth!;
  const request = await findRequest(auth, req.params.id);
  if (!request) return notFound(res);
  if (auth.kind !== 'client') return clientOnly(res);

  const parsed = respondSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });

  if (request.status === 'accepted' || request.status === 'waived') {
    return badRequest(res, 'This item is already closed.', 'request_closed');
  }

  const now = new Date();
  const [updated] = await db
    .update(schema.requests)
    .set({
      clientResponseKind: parsed.data.kind,
      clientResponseNote: parsed.data.note ?? null,
      clientResponseAt: now,
      updatedAt: now,
    })
    .where(eq(schema.requests.id, request.id))
    .returning();

  // Only the advisor can take a line off the list, so they have to hear about it.
  await notify({
    userKind: 'provider',
    userId: request.providerId,
    type: 'request.not_applicable',
    title: `${auth.name} says they do not have: ${request.title}`,
    body: parsed.data.note ?? null,
    link: `/engagements/${request.engagementId}`,
  });
  await recordActivity({
    providerId: request.providerId,
    clientId: request.clientId,
    type: 'update',
    description: `said they do not have: ${request.title}`,
    actorKind: 'client',
    actorId: auth.sub,
    actorName: auth.name,
    targetId: request.id,
  });

  res.json(serializeRequest(updated, now, await attachmentsForRequest(request.id)));
});

export default router;
