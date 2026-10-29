import { type Request, type Response } from 'express';
import { asyncRouter } from './async-router.js';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { authenticate, requireProvider } from '../middleware/auth.js';
import { revokeAllSessions } from '../auth/sessions.js';
import { createInvitation, dropUnusedInvitations, invitationLink } from '../auth/invitations.js';
import { hashPassword, passwordSchema } from '../auth/passwords.js';
import { normalizeEmail } from '../auth/email.js';
import { createPasswordReset, resetLink } from '../auth/resets.js';
import { enqueueEmail } from '../jobs/mail.js';
import { firmSignOff } from '../db/firms.js';
import { activeAdvisorInFirm, announceReassignments, reassignClients } from '../workflow/assignment.js';
import { NAME_MAX } from '../security/limits.js';
import { auditRequest, hashedEmail } from '../db/audit.js';

const router = asyncRouter();

router.use(authenticate);

/**
 * Column set for a client row including the three counters that used to be
 * stored columns — now computed on read via correlated subqueries so they can
 * never drift out of sync. `viewerKind` decides which side "unread" counts from.
 * Access state (`hasPassword`, `invitePendingUntil`, `deactivatedAt`) lets the
 * UI show Invite / Resend / Deactivated without ever seeing a hash or a token.
 */
function clientColumns(viewerKind: 'provider' | 'client') {
  return {
    id: schema.clients.id,
    firmId: schema.clients.firmId,
    /* Who looks after the client, as `advisorsFor` sees it (`isEffectiveAdvisor`):
       an assignment to an advisor who has since been deactivated reads as none,
       because the firm is who hears about this client now. */
    assignedAdvisorId: sql<string | null>`(
      SELECT p.id FROM ${schema.providers} p
      WHERE p.id = ${schema.clients}."assigned_provider_id" AND p.firm_id = ${schema.clients}."firm_id"
        AND p.deactivated_at IS NULL AND p.password_hash IS NOT NULL
    )`.as('assigned_advisor_id'),
    assignedAdvisorName: sql<string | null>`(
      SELECT p.name FROM ${schema.providers} p
      WHERE p.id = ${schema.clients}."assigned_provider_id" AND p.firm_id = ${schema.clients}."firm_id"
        AND p.deactivated_at IS NULL AND p.password_hash IS NOT NULL
    )`.as('assigned_advisor_name'),
    name: schema.clients.name,
    email: schema.clients.email,
    accountId: schema.clients.accountId,
    plan: schema.clients.plan,
    clientSince: schema.clients.clientSince,
    // Cast numeric → float8 so the API returns a JS number (not a string).
    aum: sql<number | null>`${schema.clients.aum}::float8`.as('aum'),
    lastActivity: schema.clients.lastActivity,
    deactivatedAt: schema.clients.deactivatedAt,
    hasPassword: sql<boolean>`(${schema.clients.passwordHash} IS NOT NULL)`.as('has_password'),
    createdAt: schema.clients.createdAt,
    updatedAt: schema.clients.updatedAt,
    // NOTE: the correlation must be fully qualified as "clients"."id" — a bare
    // ${schema.clients.id} renders as "id", which Postgres binds to the inner
    // table's own id column, silently making every count 0.
    /* Documents with bytes to open. Read `storage_path IS NOT NULL` until C5.4
       dropped that column; a current version is where bytes live now. Archived
       rows are excluded — the advisor filed them away, so counting them would
       keep a number high that the screen says nothing about. */
    documentsCount: sql<number>`(
      SELECT COUNT(*)::int FROM ${schema.documents} d
      WHERE d.client_id = ${schema.clients}."id" AND d.current_version_id IS NOT NULL AND d.archived_at IS NULL
    )`.as('documents_count'),
    /* What this client still owes: the "N pending" pill and half the attention
       sort on the client directory. This counted the legacy `is_requested` /
       `has_update_request` flags; asking is a checklist request now, and the two
       outstanding statuses are the ones sitting with the client. Matches
       `serialize.ts#isOverdue`'s idea of outstanding, and must move with it. */
    pendingUpdates: sql<number>`(
      SELECT COUNT(*)::int FROM ${schema.requests} r
      WHERE r.client_id = ${schema.clients}."id"
        AND r.status IN ('requested', 'needs_correction')
        AND r.archived_at IS NULL
    )`.as('pending_updates'),
    unreadMessages: sql<number>`(
      SELECT COUNT(*)::int FROM ${schema.messages} m
      WHERE m.client_id = ${schema.clients}."id" AND m.read_at IS NULL AND m.sender_kind::text <> ${viewerKind}
    )`.as('unread_messages'),
    invitePendingUntil: sql<Date | null>`(
      SELECT MAX(i.expires_at) FROM ${schema.invitations} i
      WHERE i.client_id = ${schema.clients}."id" AND i.used_at IS NULL AND i.expires_at > now()
    )`.as('invite_pending_until'),
  };
}

async function loadClientRow(id: string, viewerKind: 'provider' | 'client') {
  const [client] = await db.select(clientColumns(viewerKind)).from(schema.clients).where(eq(schema.clients.id, id));
  return client ?? null;
}

/** A client of the advisor's firm, or null (the caller answers 404 — out-of-scope ids look missing). */
async function ownClient(req: Request, id: string) {
  const [existing] = await db.select().from(schema.clients).where(eq(schema.clients.id, id));
  if (!existing || existing.firmId !== req.auth!.firmId) return null;
  return existing;
}

const notFound = (res: Response) => res.status(404).json({ error: 'Not found' });

router.get('/', requireProvider, async (req, res) => {
  const list = await db
    .select(clientColumns('provider'))
    .from(schema.clients)
    .where(eq(schema.clients.firmId, req.auth!.firmId));
  res.json(list);
});

router.get('/:id', async (req, res) => {
  const auth = req.auth!;
  const client = await loadClientRow(req.params.id, auth.kind);
  if (!client) return notFound(res);

  // An advisor sees their firm's clients; a client sees only themselves.
  // Out-of-scope ids are indistinguishable from missing ones.
  if (auth.kind === 'provider' && client.firmId !== auth.firmId) return notFound(res);
  if (auth.kind === 'client' && client.id !== auth.sub) return notFound(res);
  res.json(client);
});

const createClientSchema = z.object({
  name: z.string().min(1).max(NAME_MAX),
  email: z.string().email(),
  accountId: z.string().optional(),
  plan: z.string().optional(),
  aum: z.number().nonnegative().nullable().optional(),
  password: passwordSchema.optional(),
  /* Who looks after them; the advisor adding the client unless said otherwise, null for nobody yet. */
  assignedAdvisorId: z.string().uuid().nullable().optional(),
});

/* Says nothing about other firms: an id from elsewhere is refused exactly like a made-up one. */
const NOT_IN_FIRM = { error: 'Choose an active advisor of this firm.', code: 'not_in_firm' };

/**
 * One client per address within a firm, the same rule
 * `clients_firm_email_normalized_key` enforces in the database (F7). Checked
 * here so the advisor gets a sentence rather than a 500, and caught there as
 * well because two advisors typing at once is a race this check cannot win.
 *
 * Scoped to the firm, like the index: another firm's client at the same
 * address is a different account, and refusing it would tell this firm who
 * the other one's clients are.
 */
const EMAIL_TAKEN = { error: 'A client with that email address already exists.', code: 'email_taken' };

async function emailIsTaken(firmId: string, email: string, exceptId?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(and(eq(schema.clients.firmId, firmId), eq(schema.clients.emailNormalized, normalizeEmail(email))));
  return Boolean(row) && row.id !== exceptId;
}

/** Postgres unique-violation, i.e. the race above actually happened. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

router.post('/', requireProvider, async (req, res) => {
  const parsed = createClientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  const { name, email, accountId, plan, aum, password } = parsed.data;
  const assignedProviderId = parsed.data.assignedAdvisorId === undefined ? req.auth!.sub : parsed.data.assignedAdvisorId;
  if (assignedProviderId && !(await activeAdvisorInFirm(req.auth!.firmId, assignedProviderId))) {
    return res.status(400).json(NOT_IN_FIRM);
  }

  if (await emailIsTaken(req.auth!.firmId, email)) return res.status(409).json(EMAIL_TAKEN);

  const passwordHash = password ? await hashPassword(password) : null;
  let created: { id: string };
  try {
    [created] = await db
      .insert(schema.clients)
      .values({
        firmId: req.auth!.firmId,
        assignedProviderId,
        name,
        email,
        emailNormalized: normalizeEmail(email),
        passwordHash,
        passwordChangedAt: passwordHash ? new Date() : null,
        accountId: accountId || `CL-${Date.now().toString().slice(-5)}`,
        plan: plan || 'Core',
        aum: aum === null || aum === undefined ? null : String(aum),
      })
      .returning({ id: schema.clients.id });
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json(EMAIL_TAKEN);
    throw err;
  }

  await auditRequest(req, {
    action: 'client.created',
    targetType: 'client',
    targetId: created.id,
    clientId: created.id,
    // The address is hashed: an audit log is not a place to keep contact details.
    meta: { emailHash: hashedEmail(email), withPassword: Boolean(passwordHash) },
  });
  res.status(201).json(await loadClientRow(created.id, 'provider'));
});

const updateClientSchema = z.object({
  name: z.string().min(1).max(NAME_MAX).optional(),
  email: z.string().email().optional(),
  plan: z.string().optional(),
  aum: z.number().nonnegative().nullable().optional(),
  password: passwordSchema.optional(),
});

router.patch('/:id', requireProvider, async (req, res) => {
  const parsed = updateClientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });

  const existing = await ownClient(req, req.params.id);
  if (!existing) return notFound(res);

  const { name, email, plan, aum, password } = parsed.data;
  if (email !== undefined && (await emailIsTaken(existing.firmId, email, existing.id))) return res.status(409).json(EMAIL_TAKEN);

  const now = new Date();
  const updates: Partial<typeof schema.clients.$inferInsert> = { updatedAt: now };
  if (name !== undefined) updates.name = name;
  if (email !== undefined) {
    updates.email = email;
    updates.emailNormalized = normalizeEmail(email);
  }
  if (plan !== undefined) updates.plan = plan;
  if (aum !== undefined) updates.aum = aum === null ? null : String(aum);
  if (password !== undefined) {
    updates.passwordHash = await hashPassword(password);
    updates.passwordChangedAt = now;
  }

  try {
    await db.update(schema.clients).set(updates).where(eq(schema.clients.id, req.params.id));
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json(EMAIL_TAKEN);
    throw err;
  }
  // A new password ends every session the client had (plan: revocation paths).
  if (password !== undefined) await revokeAllSessions('client', req.params.id);

  // The sign-in address decides who receives the reset links, so moving it is
  // on the record — hashed, like every address in the log (2026-10-28 audit).
  if (email !== undefined && normalizeEmail(email) !== existing.emailNormalized) {
    await auditRequest(req, {
      action: 'client.email_changed',
      targetType: 'client',
      targetId: existing.id,
      clientId: existing.id,
      meta: { fromHash: hashedEmail(existing.email), toHash: hashedEmail(email) },
    });
  }

  res.json(await loadClientRow(req.params.id, 'provider'));
});

const DEACTIVATED = { error: 'This client is deactivated. Reactivate them first.', code: 'deactivated' };

/* A fresh invitation link (replaces any unused one). The email is queued when a mail
   server is configured; the link comes back either way so onboarding never depends on it. */
router.post('/:id/invitations', requireProvider, async (req, res) => {
  const existing = await ownClient(req, req.params.id);
  if (!existing) return notFound(res);
  if (existing.deactivatedAt) return res.status(409).json(DEACTIVATED);

  const { token, expiresAt } = await createInvitation(existing.id, req.auth!.sub);
  await auditRequest(req, {
    action: 'invitation.created',
    targetType: 'client',
    targetId: existing.id,
    clientId: existing.id,
    meta: { expiresAt: expiresAt.toISOString() },
  });
  const link = invitationLink(token);
  const emailQueued = await enqueueEmail({
    template: 'invitation',
    to: existing.email,
    link,
    firmName: await firmSignOff(req.auth!.firmId),
  });
  res.status(201).json({ link, expiresAt, emailQueued });
});

/* A copy-link password reset for a client who already has a password (otherwise: invite them). */
router.post('/:id/password-reset', requireProvider, async (req, res) => {
  const existing = await ownClient(req, req.params.id);
  if (!existing) return notFound(res);
  if (existing.deactivatedAt) return res.status(409).json(DEACTIVATED);
  if (!existing.passwordHash) {
    return res.status(409).json({ error: 'This client has not accepted an invitation yet. Send an invitation instead.', code: 'not_invited' });
  }

  const { token, expiresAt } = await createPasswordReset('client', existing.id);
  const link = resetLink(token);
  const emailQueued = await enqueueEmail({
    template: 'password_reset',
    to: existing.email,
    link,
    firmName: await firmSignOff(req.auth!.firmId),
  });
  res.json({ link, expiresAt, emailQueued });
});

/**
 * A client who lost their phone. Removes their authenticator and recovery
 * codes and ends their sessions; their next sign-in (password first, as
 * always) sets up a new authenticator.
 *
 * Before the 2026-10-28 audit the only way back was `npm run admin --
 * reset-mfa` on the server console, which a client locked out on a Saturday in
 * April does not have. The screen asks the advisor to confirm it is really
 * them first: this is the help-desk step an attacker who has the password
 * would try to talk their way through.
 */
router.post('/:id/mfa-reset', requireProvider, async (req, res) => {
  const existing = await ownClient(req, req.params.id);
  if (!existing) return notFound(res);
  if (existing.deactivatedAt) return res.status(409).json(DEACTIVATED);

  const removed = await db.transaction(async (tx) => {
    const totp = await tx
      .delete(schema.mfaTotp)
      .where(and(eq(schema.mfaTotp.userKind, 'client'), eq(schema.mfaTotp.userId, existing.id)))
      .returning({ id: schema.mfaTotp.id });
    await tx
      .delete(schema.recoveryCodes)
      .where(and(eq(schema.recoveryCodes.userKind, 'client'), eq(schema.recoveryCodes.userId, existing.id)));
    await auditRequest(
      req,
      { action: 'client.mfa_reset', targetType: 'client', targetId: existing.id, clientId: existing.id },
      tx
    );
    return totp.length;
  });
  const sessionsRevoked = await revokeAllSessions('client', existing.id);
  res.json({ reset: removed > 0, sessionsRevoked });
});

/* Reversible: sign-in refused, every session ended, pending invitations dropped. Data untouched. */
router.post('/:id/deactivate', requireProvider, async (req, res) => {
  const existing = await ownClient(req, req.params.id);
  if (!existing) return notFound(res);

  if (!existing.deactivatedAt) {
    const now = new Date();
    await db.update(schema.clients).set({ deactivatedAt: now, updatedAt: now }).where(eq(schema.clients.id, existing.id));
  }
  const revoked = await revokeAllSessions('client', existing.id);
  await dropUnusedInvitations(existing.id);
  await auditRequest(req, {
    action: 'client.deactivated',
    targetType: 'client',
    targetId: existing.id,
    clientId: existing.id,
    meta: { sessionsRevoked: revoked },
  });
  res.json(await loadClientRow(existing.id, 'provider'));
});

const assignSchema = z.object({ advisorId: z.string().uuid().nullable() });

/**
 * Gives the client to another advisor of the firm, or to nobody (FIRM-BOOK-PLAN
 * F5). Any advisor of the firm may: the book is shared, and every move is
 * audited and shows on the client's activity. Assigning the advisor they
 * already have is a 200 that records nothing, because nothing happened.
 */
router.post('/:id/assign', requireProvider, async (req, res) => {
  const auth = req.auth!;
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  const existing = await ownClient(req, req.params.id);
  if (!existing) return notFound(res);
  const { advisorId } = parsed.data;
  if (advisorId && !(await activeAdvisorInFirm(auth.firmId, advisorId))) return res.status(400).json(NOT_IN_FIRM);

  const moves = await db.transaction((tx) =>
    reassignClients(tx, req, { firmId: auth.firmId, clientIds: [existing.id], toId: advisorId, reason: 'assigned' })
  );
  await announceReassignments(moves, { firmId: auth.firmId, kind: 'provider', id: auth.sub, name: auth.name });
  res.json(await loadClientRow(existing.id, 'provider'));
});

router.post('/:id/reactivate', requireProvider, async (req, res) => {
  const existing = await ownClient(req, req.params.id);
  if (!existing) return notFound(res);

  if (existing.deactivatedAt) {
    await db.update(schema.clients).set({ deactivatedAt: null, updatedAt: new Date() }).where(eq(schema.clients.id, existing.id));
  }
  await auditRequest(req, {
    action: 'client.reactivated',
    targetType: 'client',
    targetId: existing.id,
    clientId: existing.id,
  });
  res.json(await loadClientRow(existing.id, 'provider'));
});

export default router;
