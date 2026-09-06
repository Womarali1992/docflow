/**
 * /api/invitations — the public side of client onboarding (plan: API surface →
 * Auth & sessions). The link is the credential: single use, 7 days, per-IP
 * throttled. Accepting sets the first password and opens a session that still
 * owes its MFA enrollment.
 */
import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { acceptInvitation, findInvitation } from '../auth/invitations.js';
import { isRefusedDemoPassword, passwordSchema } from '../auth/passwords.js';
import { clientMe, openSession, type AuthState } from '../auth/signin.js';
import { looksLikeToken, tokenState, type TokenState } from '../auth/tokens.js';
import { auditRequest } from '../db/audit.js';
import { lookupLimiter } from '../security/limits.js';

const router = Router();

router.use(lookupLimiter);

const STATE_RESPONSES: Record<Exclude<TokenState, 'ok'>, { status: number; body: { error: string; code: string } }> = {
  missing: { status: 404, body: { error: 'This invitation link is not valid.', code: 'invalid_token' } },
  used: { status: 410, body: { error: 'This invitation was already used. Sign in, or ask your advisor for a new link.', code: 'used' } },
  expired: { status: 410, body: { error: 'This invitation has expired. Ask your advisor for a new link.', code: 'expired' } },
};

interface Resolved {
  invitation: NonNullable<Awaited<ReturnType<typeof findInvitation>>>;
  client: typeof schema.clients.$inferSelect;
  providerName: string;
  firmName: string | null;
}

/** Loads a live invitation with its client and advisor, or the error to answer with. */
async function resolve(token: string): Promise<{ ok: true; value: Resolved } | { ok: false; status: number; body: { error: string; code: string } }> {
  const invitation = looksLikeToken(token) ? await findInvitation(token) : null;
  const state = tokenState(invitation);
  if (state !== 'ok' || !invitation) return { ok: false, ...STATE_RESPONSES[state === 'ok' ? 'missing' : state] };

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, invitation.clientId));
  // A client deactivated after the link went out: the link is simply not valid any more.
  if (!client || client.deactivatedAt) return { ok: false, ...STATE_RESPONSES.missing };
  const [provider] = await db
    .select({ name: schema.providers.name, firmName: schema.providers.firmName })
    .from(schema.providers)
    .where(eq(schema.providers.id, client.providerId));
  return { ok: true, value: { invitation, client, providerName: provider?.name ?? '', firmName: provider?.firmName ?? null } };
}

/* What the invite page shows before asking for a password: who invited whom. */
router.get('/:token', async (req, res) => {
  const r = await resolve(req.params.token);
  if (!r.ok) return res.status(r.status).json(r.body);
  const { client, providerName, firmName, invitation } = r.value;
  res.json({ clientName: client.name, email: client.email, providerName, firmName, expiresAt: invitation.expiresAt });
});

const acceptSchema = z.object({ password: passwordSchema });

/* Sets the first password, burns the link, opens a session (stage mfa_enroll or preauth). */
router.post('/:token/accept', async (req, res) => {
  const parsed = acceptSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  if (isRefusedDemoPassword(parsed.data.password)) {
    return res.status(400).json({ error: 'That password is not allowed here. Choose a different one.', code: 'demo_password' });
  }

  const r = await resolve(req.params.token);
  if (!r.ok) return res.status(r.status).json(r.body);

  await acceptInvitation(r.value.invitation, parsed.data.password);
  // Public route: there is no session yet, so the actor is the link holder.
  await auditRequest(req, {
    action: 'invitation.accepted',
    targetType: 'client',
    targetId: r.value.client.id,
    clientId: r.value.client.id,
  });
  const stage = await openSession(req, res, 'client', r.value.client.id);
  const me = await clientMe(r.value.client.id);
  if (!me) return res.status(404).json({ error: 'Not found' });
  const state: AuthState = { stage, me };
  res.json(state);
});

export default router;
