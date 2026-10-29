/**
 * /api/firm — the firm and the advisors who share its book (FIRM-BOOK-PLAN F4).
 *
 * Reading the team is any advisor's: the Advisor select on a client and the
 * queue's Mine / Everyone toggle are built from it. Changing the team is an
 * owner's: inviting, resending a link, deactivating and reactivating. An id
 * that is not an advisor of the caller's firm is 404, like every other
 * cross-tenant id. A colleague who is not an owner is refused with 403 before
 * any id is looked at, so that answer says nothing about which ids exist.
 *
 * There is no open signup into a firm. `signup-provider` (off by default)
 * founds a new firm; a seat in an existing one comes only from its owner.
 */
import type { NextFunction, Request, Response } from 'express';
import { asyncRouter } from './async-router.js';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { authenticate, requireProvider } from '../middleware/auth.js';
import { revokeAllSessions } from '../auth/sessions.js';
import { createStaffInvitation, dropUnusedStaffInvitations, staffInvitationLink } from '../auth/staff-invitations.js';
import { providerEmailIsTaken } from '../auth/email.js';
import { enqueueEmail } from '../jobs/mail.js';
import { firmSignOff } from '../db/firms.js';
import { auditRequest, hashedEmail } from '../db/audit.js';
import { NAME_MAX } from '../security/limits.js';
import { activeAdvisorInFirm, announceReassignments, reassignClients } from '../workflow/assignment.js';
import { isId, notFound } from './scope.js';

const router = asyncRouter();

router.use(authenticate, requireProvider);

async function requireOwner(req: Request, res: Response, next: NextFunction) {
  const [me] = await db.select({ role: schema.providers.role }).from(schema.providers).where(eq(schema.providers.id, req.auth!.sub));
  if (me?.role !== 'owner') return res.status(403).json({ error: 'Only an owner of the firm can change its team.', code: 'owner_only' });
  next();
}

/** An advisor of the caller's firm, or null (the caller answers 404). */
async function findAdvisor(req: Request, id: string) {
  if (!isId(id)) return null;
  const [row] = await db.select().from(schema.providers).where(eq(schema.providers.id, id));
  return row && row.firmId === req.auth!.firmId ? row : null;
}

/** The team as the Settings card shows it. Never a hash or a token: only whether one exists. */
async function team(firmId: string) {
  return db
    .select({
      id: schema.providers.id,
      name: schema.providers.name,
      email: schema.providers.email,
      role: schema.providers.role,
      deactivatedAt: schema.providers.deactivatedAt,
      hasPassword: sql<boolean>`(${schema.providers.passwordHash} IS NOT NULL)`.as('has_password'),
      invitePendingUntil: sql<Date | null>`(
        SELECT MAX(i.expires_at) FROM ${schema.staffInvitations} i
        WHERE i.provider_id = ${schema.providers}."id" AND i.used_at IS NULL AND i.expires_at > now()
      )`.as('invite_pending_until'),
      assignedClients: sql<number>`(
        SELECT COUNT(*)::int FROM ${schema.clients} c
        WHERE c.assigned_provider_id = ${schema.providers}."id" AND c.deactivated_at IS NULL
      )`.as('assigned_clients'),
    })
    .from(schema.providers)
    .where(eq(schema.providers.firmId, firmId))
    .orderBy(desc(sql`${schema.providers.role} = 'owner'`), asc(schema.providers.name));
}

async function teamMember(firmId: string, id: string) {
  return (await team(firmId)).find((a) => a.id === id) ?? null;
}

router.get('/', async (req, res) => {
  const auth = req.auth!;
  const [firm] = await db.select({ id: schema.firms.id, name: schema.firms.name }).from(schema.firms).where(eq(schema.firms.id, auth.firmId));
  if (!firm) return notFound(res);
  const advisors = await team(auth.firmId);
  res.json({ ...firm, advisors });
});

/** A fresh link for an advisor who has not set a password yet; emailed when a mail server is configured. */
async function inviteLink(req: Request, advisor: { id: string; email: string }) {
  const { token, expiresAt } = await createStaffInvitation(advisor.id, req.auth!.sub);
  const link = staffInvitationLink(token);
  const emailQueued = await enqueueEmail({
    template: 'staff_invitation',
    to: advisor.email,
    link,
    firmName: await firmSignOff(req.auth!.firmId),
  });
  return { link, expiresAt, emailQueued };
}

const inviteSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX),
  email: z.string().trim().email().max(NAME_MAX),
});

/* Advisor sign-in is by address across the whole install, so the address is too. */
const EMAIL_TAKEN = { error: 'An advisor with that email address already exists.', code: 'email_taken' };

router.post('/advisors', requireOwner, async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  const { name, email } = parsed.data;
  if (await providerEmailIsTaken(email)) return res.status(409).json(EMAIL_TAKEN);

  let created: { id: string; email: string };
  try {
    [created] = await db
      .insert(schema.providers)
      // No password: the account is unusable until its owner accepts the link.
      .values({ firmId: req.auth!.firmId, name, email, role: 'advisor', passwordHash: null })
      .returning({ id: schema.providers.id, email: schema.providers.email });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return res.status(409).json(EMAIL_TAKEN);
    throw err;
  }
  const invitation = await inviteLink(req, created);
  await auditRequest(req, {
    action: 'staff.invited',
    targetType: 'provider',
    targetId: created.id,
    meta: { emailHash: hashedEmail(email), expiresAt: invitation.expiresAt.toISOString() },
  });
  res.status(201).json({ advisor: await teamMember(req.auth!.firmId, created.id), ...invitation });
});

router.post('/advisors/:id/invitations', requireOwner, async (req, res) => {
  const advisor = await findAdvisor(req, req.params.id);
  if (!advisor) return notFound(res);
  if (advisor.deactivatedAt) {
    return res.status(409).json({ error: 'This advisor is deactivated. Reactivate them first.', code: 'deactivated' });
  }
  if (advisor.passwordHash) {
    return res.status(409).json({ error: 'This advisor has already joined. They can reset their password from the sign-in page.', code: 'already_joined' });
  }
  const invitation = await inviteLink(req, advisor);
  await auditRequest(req, {
    action: 'staff.invited',
    targetType: 'provider',
    targetId: advisor.id,
    meta: { resent: true, expiresAt: invitation.expiresAt.toISOString() },
  });
  res.status(201).json(invitation);
});

const deactivateSchema = z.object({
  /* Who takes over their clients; null leaves them unassigned, and then the whole firm hears about them. */
  reassignTo: z.string().uuid().nullable().optional(),
});

router.post('/advisors/:id/deactivate', requireOwner, async (req, res) => {
  const auth = req.auth!;
  const parsed = deactivateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  const advisor = await findAdvisor(req, req.params.id);
  if (!advisor) return notFound(res);
  /* Only an active owner gets this far, and never about themselves, so a firm
     always keeps at least one owner: the caller. */
  if (advisor.id === auth.sub) {
    return res.status(409).json({ error: 'You cannot deactivate your own account.', code: 'self' });
  }
  const reassignTo = parsed.data.reassignTo ?? null;
  if (reassignTo !== null && (reassignTo === advisor.id || !(await activeAdvisorInFirm(auth.firmId, reassignTo)))) {
    return res.status(400).json({ error: 'Choose an active advisor of this firm to take over their clients.', code: 'not_in_firm' });
  }

  const now = new Date();
  const moves = await db.transaction(async (tx) => {
    await tx.update(schema.providers).set({ deactivatedAt: advisor.deactivatedAt ?? now, updatedAt: now }).where(eq(schema.providers.id, advisor.id));
    const theirs = await tx
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(eq(schema.clients.firmId, auth.firmId), eq(schema.clients.assignedProviderId, advisor.id)));
    return reassignClients(tx, req, {
      firmId: auth.firmId,
      clientIds: theirs.map((c) => c.id),
      toId: reassignTo,
      reason: 'advisor_deactivated',
      now,
    });
  });
  const revoked = await revokeAllSessions('provider', advisor.id);
  await dropUnusedStaffInvitations(advisor.id);
  await auditRequest(req, {
    action: 'staff.deactivated',
    targetType: 'provider',
    targetId: advisor.id,
    meta: { sessionsRevoked: revoked, clientsMoved: moves.length, reassignTo },
  });
  await announceReassignments(moves, { firmId: auth.firmId, kind: 'provider', id: auth.sub, name: auth.name });
  res.json({ advisor: await teamMember(auth.firmId, advisor.id), clientsMoved: moves.length });
});

router.post('/advisors/:id/reactivate', requireOwner, async (req, res) => {
  const advisor = await findAdvisor(req, req.params.id);
  if (!advisor) return notFound(res);
  if (advisor.deactivatedAt) {
    await db.update(schema.providers).set({ deactivatedAt: null, updatedAt: new Date() }).where(eq(schema.providers.id, advisor.id));
  }
  await auditRequest(req, { action: 'staff.reactivated', targetType: 'provider', targetId: advisor.id });
  res.json({ advisor: await teamMember(req.auth!.firmId, advisor.id) });
});

export default router;
