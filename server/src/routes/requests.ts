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
 * Every move is an explicit verb (invariant 5), and the move itself is made in
 * `workflow/line-status.ts`, the one module that writes the status column.
 * PATCH only edits wording, category, deadline and order.
 *
 * Beside the state machine is `remove` / `restore`: a line asked for by mistake
 * comes off the checklist without a waiver the client would read. It is only
 * for a line nothing was ever sent against. Once the client has sent a file,
 * the line is part of the record and waiving is the way to close it.
 */
import { type Request as ExpressRequest, type Response as ExpressResponse } from 'express';
import { asyncRouter } from './async-router.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';
import { INSTRUCTIONS_MAX, NAME_MAX } from '../security/limits.js';
import { auditRequest } from '../db/audit.js';
import { refusalBody } from '../workflow/publish.js';
import { attachmentsForRequest } from '../workflow/attachments.js';
import { announceDecision, namedVersions, recordDecision } from '../workflow/decisions.js';
import { correctionsByRequest } from '../workflow/corrections.js';
import { reopenLine, waiveLine } from '../workflow/line-status.js';
import { recordActivity } from '../db/activity-log.js';
import { serializeRequest } from './serialize.js';
import { advisorOnly, badRequest, clientOnly, findRequest, notFound, REQUEST_REMOVED, requireOpenEngagement } from './scope.js';
import { notifyAdvisors } from '../notify.js';
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

/** A request row in its public shape, with what hangs off it: its attachments and any open correction. */
async function present(row: RequestRow, now = new Date()) {
  const corrections = row.status === 'needs_correction' ? await correctionsByRequest([row.id]) : null;
  return serializeRequest(row, now, await attachmentsForRequest(row.id), corrections?.get(row.id) ?? null);
}

/** The request as it stands, re-read, ready to answer with. */
async function freshRequest(requestId: string, now: Date) {
  const [updated] = await db.select().from(schema.requests).where(eq(schema.requests.id, requestId));
  return present(updated, now);
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
  res.json(await present(request));
});

router.patch('/:id', async (req, res) => {
  const request = await loadForAdvisor(req, res);
  if (!request) return;
  if (!(await requireOpenEngagement(res, req.auth!, request.engagementId))) return;

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });

  const { dueDate, ...rest } = parsed.data;
  const updates: Partial<typeof schema.requests.$inferInsert> = { ...rest, updatedAt: new Date() };
  if (dueDate !== undefined) updates.dueDate = dueDate === null ? null : new Date(dueDate);

  const [updated] = await db.update(schema.requests).set(updates).where(eq(schema.requests.id, request.id)).returning();
  res.json(await present(updated));
});

/* ------------------------------------------------------------ advisor verbs */

const acceptSchema = z.object({
  versionId: z.string().uuid().optional(),
  versionIds: z.array(z.string().uuid()).max(200).optional(),
  note: z.string().max(INSTRUCTIONS_MAX).optional(),
});

router.post('/:id/accept', async (req, res) => {
  const request = await loadForAdvisor(req, res);
  if (!request) return;
  if (!(await requireOpenEngagement(res, req.auth!, request.engagementId))) return;

  const parsed = acceptSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });

  const subject = { kind: 'line', request } as const;
  const outcome = await recordDecision(req, {
    subject,
    decision: 'accepted',
    namedVersionIds: namedVersions(parsed.data),
    note: parsed.data.note ?? null,
  });
  if (!outcome.ok) return res.status(outcome.status).json(refusalBody(outcome));

  await announceDecision(req.auth!, subject, 'accepted');
  res.json(await freshRequest(request.id, outcome.now));
});

const correctionSchema = z.object({
  versionId: z.string().uuid().optional(),
  versionIds: z.array(z.string().uuid()).max(200).optional(),
  note: z.string().min(1).max(INSTRUCTIONS_MAX),
});

router.post('/:id/request-correction', async (req, res) => {
  const request = await loadForAdvisor(req, res);
  if (!request) return;
  if (!(await requireOpenEngagement(res, req.auth!, request.engagementId))) return;

  const parsed = correctionSchema.safeParse(req.body);
  if (!parsed.success) {
    // The note is the whole point: the client has to be told what to fix.
    return res.status(400).json({ error: 'Say what needs correcting — the client sees this note.', code: 'note_required', issues: parsed.error.issues });
  }

  const subject = { kind: 'line', request } as const;
  const outcome = await recordDecision(req, {
    subject,
    decision: 'needs_correction',
    namedVersionIds: namedVersions(parsed.data),
    note: parsed.data.note,
  });
  if (!outcome.ok) return res.status(outcome.status).json(refusalBody(outcome));

  await announceDecision(req.auth!, subject, 'needs_correction');
  res.json(await freshRequest(request.id, outcome.now));
});

const waiveSchema = z.object({ reason: z.string().min(1).max(INSTRUCTIONS_MAX) });

router.post('/:id/waive', async (req, res) => {
  const auth = req.auth!;
  const request = await loadForAdvisor(req, res);
  if (!request) return;
  if (!(await requireOpenEngagement(res, req.auth!, request.engagementId))) return;

  const parsed = waiveSchema.safeParse(req.body);
  if (!parsed.success) {
    // A year from now, "why isn't this on the list?" needs an answer.
    return res.status(400).json({ error: 'Give a reason for waiving this — it stays on the file.', code: 'reason_required' });
  }

  const now = new Date();
  const updated = await waiveLine(db, request.id, { reason: parsed.data.reason, byId: auth.sub }, now);

  await auditRequest(req, {
    action: 'request.waived',
    targetType: 'request',
    targetId: request.id,
    clientId: request.clientId,
    meta: { reason: parsed.data.reason },
  });
  await recordActivity({
    firmId: request.firmId,
    clientId: request.clientId,
    type: 'update',
    description: `waived: ${request.title}`,
    actorKind: 'provider',
    actorId: auth.sub,
    actorName: auth.name,
    targetId: request.id,
  });

  res.json(await present(updated, now));
});

/** Puts a decided request back in play — back to `submitted` if an answer is on file. */
router.post('/:id/reopen', async (req, res) => {
  const request = await loadForAdvisor(req, res);
  if (!request) return;
  if (!(await requireOpenEngagement(res, req.auth!, request.engagementId))) return;

  const now = new Date();
  const updated = await reopenLine(db, request.id, now);

  res.json(await present(updated, now));
});

/**
 * Take a line off the checklist: a template line that does not apply to this
 * client, or one added twice. The client stops seeing it and is not chased for
 * it, and nothing is said to them. They never had anything to do for it.
 *
 * Refused once any file has been sent against it, including one still being
 * checked or one the scanner refused (an importer's empty document row is not
 * a file). That file is the client's answer, and
 * the line it answers stays on the record. The request row is locked first,
 * the same lock the upload path takes before attaching a file, so a removal
 * and a first upload cannot both win (see `documentForRequest`).
 */
router.post('/:id/remove', async (req, res) => {
  const auth = req.auth!;
  const request = await loadForAdvisor(req, res);
  if (!request) return;
  if (!(await requireOpenEngagement(res, req.auth!, request.engagementId))) return;

  const now = new Date();
  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.requests).where(eq(schema.requests.id, request.id)).for('update');
    if (row.archivedAt) return { ok: true as const, row, changed: false };

    // "A file on this line" means what the checklist shows as one (attachments.ts).
    if ((await attachmentsForRequest(request.id, tx)).length > 0) return { ok: false as const };

    const [updated] = await tx
      .update(schema.requests)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(schema.requests.id, request.id))
      .returning();
    await auditRequest(
      req,
      { action: 'request.removed', targetType: 'request', targetId: request.id, clientId: request.clientId, meta: { status: row.status } },
      tx
    );
    return { ok: true as const, row: updated, changed: true };
  });

  if (!outcome.ok) {
    return res.status(409).json({
      error: 'The client has sent a file for this item, so it stays on the record. Waive it instead.',
      code: 'has_files',
    });
  }
  if (outcome.changed) {
    await recordActivity({
      firmId: request.firmId,
      clientId: request.clientId,
      type: 'update',
      description: `removed from the checklist: ${request.title}`,
      actorKind: 'provider',
      actorId: auth.sub,
      actorName: auth.name,
      targetId: request.id,
    });
  }

  res.json(await present(outcome.row, now));
});

/** Puts a removed line back on the checklist, in the state it was removed in. */
router.post('/:id/restore', async (req, res) => {
  const auth = req.auth!;
  const request = await loadForAdvisor(req, res);
  if (!request) return;
  if (!(await requireOpenEngagement(res, req.auth!, request.engagementId))) return;
  if (!request.archivedAt) return res.json(await present(request));

  const now = new Date();
  const [updated] = await db
    .update(schema.requests)
    .set({ archivedAt: null, updatedAt: now })
    .where(eq(schema.requests.id, request.id))
    .returning();

  await auditRequest(req, { action: 'request.restored', targetType: 'request', targetId: request.id, clientId: request.clientId });
  await recordActivity({
    firmId: request.firmId,
    clientId: request.clientId,
    type: 'update',
    description: `put back on the checklist: ${request.title}`,
    actorKind: 'provider',
    actorId: auth.sub,
    actorName: auth.name,
    targetId: request.id,
  });

  res.json(await present(updated, now));
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
  if (!(await requireOpenEngagement(res, auth, request.engagementId))) return;

  const parsed = respondSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });

  if (request.archivedAt) return badRequest(res, REQUEST_REMOVED, 'request_removed');
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
  await notifyAdvisors(request.clientId, {
    type: 'request.not_applicable',
    title: `${auth.name} says they do not have: ${request.title}`,
    body: parsed.data.note ?? null,
    link: `/engagements/${request.engagementId}`,
  });
  await recordActivity({
    firmId: request.firmId,
    clientId: request.clientId,
    type: 'update',
    description: `said they do not have: ${request.title}`,
    actorKind: 'client',
    actorId: auth.sub,
    actorName: auth.name,
    targetId: request.id,
  });

  res.json(await present(updated, now));
});

export default router;
