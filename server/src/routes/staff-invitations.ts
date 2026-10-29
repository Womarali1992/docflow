/**
 * /api/staff-invitations — the public side of an advisor joining a firm
 * (FIRM-BOOK-PLAN F4). The same shape as the client invitations next door: the
 * link is the credential, single use, 7 days, per-IP throttled, and accepting
 * it sets the first password and opens a session that still owes its MFA
 * enrollment.
 */
import { asyncRouter } from './async-router.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { acceptStaffInvitation, findStaffInvitation } from '../auth/staff-invitations.js';
import { isRefusedDemoPassword, passwordSchema } from '../auth/passwords.js';
import { openSession, providerMe, type AuthState } from '../auth/signin.js';
import { looksLikeToken, tokenState, type TokenState } from '../auth/tokens.js';
import { auditRequest } from '../db/audit.js';
import { lookupLimiter } from '../security/limits.js';

const router = asyncRouter();

router.use(lookupLimiter);

const STATE_RESPONSES: Record<Exclude<TokenState, 'ok'>, { status: number; body: { error: string; code: string } }> = {
  missing: { status: 404, body: { error: 'This invitation link is not valid.', code: 'invalid_token' } },
  used: { status: 410, body: { error: 'This invitation was already used. Sign in, or ask the firm for a new link.', code: 'used' } },
  expired: { status: 410, body: { error: 'This invitation has expired. Ask the firm for a new link.', code: 'expired' } },
};

/** Loads a live invitation with the advisor it is for, or the error to answer with. */
async function resolve(token: string) {
  const invitation = looksLikeToken(token) ? await findStaffInvitation(token) : null;
  const state = tokenState(invitation);
  if (state !== 'ok' || !invitation) return { ok: false as const, ...STATE_RESPONSES[state === 'ok' ? 'missing' : state] };

  const [advisor] = await db
    .select({ id: schema.providers.id, name: schema.providers.name, email: schema.providers.email, deactivatedAt: schema.providers.deactivatedAt, firmName: schema.firms.name })
    .from(schema.providers)
    .innerJoin(schema.firms, eq(schema.firms.id, schema.providers.firmId))
    .where(eq(schema.providers.id, invitation.providerId));
  // Deactivated after the link went out: the link is simply not valid any more.
  if (!advisor || advisor.deactivatedAt) return { ok: false as const, ...STATE_RESPONSES.missing };
  const [inviter] = await db.select({ name: schema.providers.name }).from(schema.providers).where(eq(schema.providers.id, invitation.createdById));
  return { ok: true as const, invitation, advisor, inviterName: inviter?.name ?? '' };
}

/* What the page shows before asking for a password: who is asking whom to join what. */
router.get('/:token', async (req, res) => {
  const r = await resolve(req.params.token);
  if (!r.ok) return res.status(r.status).json(r.body);
  res.json({
    name: r.advisor.name,
    email: r.advisor.email,
    firmName: r.advisor.firmName,
    inviterName: r.inviterName,
    expiresAt: r.invitation.expiresAt,
  });
});

const acceptSchema = z.object({ password: passwordSchema });

/* Sets the first password, burns the link, opens a session (stage mfa_enroll). */
router.post('/:token/accept', async (req, res) => {
  const parsed = acceptSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  if (isRefusedDemoPassword(parsed.data.password)) {
    return res.status(400).json({ error: 'That password is not allowed here. Choose a different one.', code: 'demo_password' });
  }

  const r = await resolve(req.params.token);
  if (!r.ok) return res.status(r.status).json(r.body);

  await acceptStaffInvitation(r.invitation, parsed.data.password);
  // Public route: there is no session yet, so the actor is the link holder.
  await auditRequest(req, { action: 'staff.invitation_accepted', targetType: 'provider', targetId: r.advisor.id });
  const stage = await openSession(req, res, 'provider', r.advisor.id);
  const me = await providerMe(r.advisor.id);
  if (!me) return res.status(404).json({ error: 'Not found' });
  const state: AuthState = { stage, me };
  res.json(state);
});

export default router;
