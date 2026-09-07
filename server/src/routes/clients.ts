import { type Request, type Response } from 'express';
import { asyncRouter } from './async-router.js';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { authenticate, requireProvider } from '../middleware/auth.js';
import { revokeAllSessions } from '../auth/sessions.js';
import { createInvitation, dropUnusedInvitations, invitationLink } from '../auth/invitations.js';
import { hashPassword, passwordSchema } from '../auth/passwords.js';
import { normalizeEmail } from '../auth/email.js';
import { createPasswordReset, resetLink } from '../auth/resets.js';
import { enqueueEmail, isMailConfigured } from '../jobs/mail.js';
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
    providerId: schema.clients.providerId,
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

/** The advisor's own client, or null (the caller answers 404 — out-of-scope ids look missing). */
async function ownClient(req: Request, id: string) {
  const [existing] = await db.select().from(schema.clients).where(eq(schema.clients.id, id));
  if (!existing || existing.providerId !== req.auth!.providerId) return null;
  return existing;
}

const notFound = (res: Response) => res.status(404).json({ error: 'Not found' });

router.get('/', requireProvider, async (req, res) => {
  const list = await db
    .select(clientColumns('provider'))
    .from(schema.clients)
    .where(eq(schema.clients.providerId, req.auth!.providerId));
  res.json(list);
});

router.get('/:id', async (req, res) => {
  const auth = req.auth!;
  const client = await loadClientRow(req.params.id, auth.kind);
  if (!client) return notFound(res);

  // Provider can only see their own clients; client can only see themselves.
  // Out-of-scope ids are indistinguishable from missing ones.
  if (auth.kind === 'provider' && client.providerId !== auth.providerId) return notFound(res);
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
});

/**
 * One client per address, the same rule `clients_email_normalized_key` enforces
 * in the database (C5.4). Checked here so the advisor gets a sentence rather
 * than a 500, and caught there as well because two advisors typing at once is a
 * race this check cannot win.
 *
 * Deliberately NOT scoped to the calling provider: the index is global, so a
 * per-provider check would pass and the insert would still fail. Answering
 * "already in use" without saying whose keeps one firm from probing another's
 * client list — the pilot has a single advisor, and this stays true if it grows.
 */
const EMAIL_TAKEN = { error: 'A client with that email address already exists.', code: 'email_taken' };

async function emailIsTaken(email: string, exceptId?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(eq(schema.clients.emailNormalized, normalizeEmail(email)));
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

  if (await emailIsTaken(email)) return res.status(409).json(EMAIL_TAKEN);

  const passwordHash = password ? await hashPassword(password) : null;
  let created: { id: string };
  try {
    [created] = await db
      .insert(schema.clients)
      .values({
        providerId: req.auth!.providerId,
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
  if (email !== undefined && (await emailIsTaken(email, existing.id))) return res.status(409).json(EMAIL_TAKEN);

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

  res.json(await loadClientRow(req.params.id, 'provider'));
});

const DEACTIVATED = { error: 'This client is deactivated. Reactivate them first.', code: 'deactivated' };

/**
 * For the email sign-off, so a notice says who it is from without naming anything
 * else. Skipped entirely while no mail server is configured — the whole pilot runs
 * that way today, and this would be a query per invitation for nothing.
 */
async function firmNameFor(providerId: string): Promise<string | undefined> {
  if (!isMailConfigured()) return undefined;
  const [p] = await db.select({ firmName: schema.providers.firmName, name: schema.providers.name }).from(schema.providers).where(eq(schema.providers.id, providerId));
  return p?.firmName ?? p?.name ?? undefined;
}

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
    firmName: await firmNameFor(req.auth!.providerId),
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
    firmName: await firmNameFor(req.auth!.providerId),
  });
  res.json({ link, expiresAt, emailQueued });
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
