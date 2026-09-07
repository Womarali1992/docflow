import { type Request, type Response } from 'express';
import { asyncRouter } from './async-router.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { authenticate, authenticateAnyStage } from '../middleware/auth.js';
import {
  clearSessionCookie,
  findSessionByToken,
  listLiveSessions,
  readSessionToken,
  revokeAllSessions,
  revokeSession,
  toSessionDto,
} from '../auth/sessions.js';
import { hashPassword, isRefusedDemoPassword, passwordSchema, verifyPassword } from '../auth/passwords.js';
import { completePasswordReset, createPasswordReset, findPasswordReset, resetLink, setPassword } from '../auth/resets.js';
import { enqueueEmail, isMailConfigured } from '../jobs/mail.js';
import { clientMe, openSession, providerMe, type AuthState, type Me } from '../auth/signin.js';
import { audit, hashedEmail, ipOf } from '../db/audit.js';
import { looksLikeToken, tokenState } from '../auth/tokens.js';
import { NAME_MAX, loginEmailLimiter, loginIpLimiter, lookupLimiter } from '../security/limits.js';

const router = asyncRouter();

const loginSchema = z.object({
  email: z.string().email().max(NAME_MAX),
  password: z.string().min(1).max(1024),
  kind: z.enum(['provider', 'client']),
});

const INVALID = { error: 'Invalid credentials' };
const DEACTIVATED = { error: 'This account has been deactivated. Contact your advisor.', code: 'deactivated' };
const DEMO_REFUSED = { error: 'This demo password is not allowed here. Ask your administrator to set a real one.', code: 'demo_password' };

/**
 * Password step. The order matters: the password is checked before any account
 * state is revealed, so a deactivated or demo-password account only learns its
 * status with the right password in hand.
 */
/**
 * One refusal path for every way a sign-in can fail.
 *
 * The answer to the caller is unchanged and deliberately identical — a login
 * form that distinguishes "no such account" from "wrong password" is an account
 * enumerator. The *audit row* records which it was, because the person reading
 * the log later is the firm, and "someone tried an address we have never heard
 * of, forty times" is a different incident from "someone is guessing Sarah's
 * password". The email is hashed: this log must not become a mailing list.
 */
async function refuseLogin(
  req: Request,
  res: Response,
  email: string,
  kind: 'provider' | 'client',
  reason: string,
  targetId: string | null = null,
  body: unknown = INVALID
) {
  await audit({
    action: 'auth.login_failed',
    targetType: kind,
    targetId,
    actorKind: null,
    actorId: null,
    ip: ipOf(req),
    meta: { reason, emailHash: hashedEmail(email), kind },
  });
  return res.status(401).json(body);
}

router.post('/login', loginIpLimiter, loginEmailLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  }
  const { email, password, kind } = parsed.data;

  if (kind === 'provider') {
    const [provider] = await db.select().from(schema.providers).where(eq(schema.providers.email, email));
    if (!provider) return await refuseLogin(req, res, email, kind, 'no_such_account');
    const check = await verifyPassword(password, provider.passwordHash);
    if (!check.ok) return await refuseLogin(req, res, email, kind, 'wrong_password', provider.id);
    if (isRefusedDemoPassword(password)) return await refuseLogin(req, res, email, kind, 'demo_password', provider.id, DEMO_REFUSED);
    if (provider.deactivatedAt) return await refuseLogin(req, res, email, kind, 'deactivated', provider.id, DEACTIVATED);
    if (check.needsRehash) {
      await db.update(schema.providers).set({ passwordHash: await hashPassword(password) }).where(eq(schema.providers.id, provider.id));
    }

    const stage = await openSession(req, res, 'provider', provider.id);
    await audit({
      action: 'auth.login',
      targetType: 'provider',
      targetId: provider.id,
      actorKind: 'provider',
      actorId: provider.id,
      ip: ipOf(req),
      meta: { stage },
    });
    const me: Me = { kind: 'provider', id: provider.id, name: provider.name, email: provider.email, firmName: provider.firmName };
    const state: AuthState = { stage, me };
    return res.json(state);
  } else {
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.email, email));
    if (!client) return await refuseLogin(req, res, email, kind, 'no_such_account');
    const check = await verifyPassword(password, client.passwordHash);
    if (!check.ok) return await refuseLogin(req, res, email, kind, 'wrong_password', client.id);
    if (isRefusedDemoPassword(password)) return await refuseLogin(req, res, email, kind, 'demo_password', client.id, DEMO_REFUSED);
    if (client.deactivatedAt) return await refuseLogin(req, res, email, kind, 'deactivated', client.id, DEACTIVATED);
    if (check.needsRehash) {
      await db.update(schema.clients).set({ passwordHash: await hashPassword(password) }).where(eq(schema.clients.id, client.id));
    }

    const [prov] = await db.select({ name: schema.providers.name }).from(schema.providers).where(eq(schema.providers.id, client.providerId));

    const stage = await openSession(req, res, 'client', client.id);
    const me: Me = {
      kind: 'client',
      id: client.id,
      name: client.name,
      email: client.email,
      providerId: client.providerId,
      providerName: prov?.name ?? null,
    };
    const state: AuthState = { stage, me };
    return res.json(state);
  }
});

const signupSchema = z.object({
  name: z.string().min(1).max(NAME_MAX),
  email: z.string().email().max(NAME_MAX),
  password: passwordSchema,
  firmName: z.string().max(NAME_MAX).optional(),
});

/* Self-service advisor signup is off unless explicitly enabled; the pilot
   provisions advisors with `npm run admin -- create-advisor`. Read at request
   time so tests can toggle it. */
router.post('/signup-provider', async (req, res) => {
  if (process.env.ALLOW_PROVIDER_SIGNUP !== 'true') {
    return res.status(403).json({ error: 'Advisor signup is disabled. Ask your administrator to create the account.' });
  }
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  }
  const { name, email, password, firmName } = parsed.data;

  const existing = await db.select().from(schema.providers).where(eq(schema.providers.email, email));
  if (existing.length > 0) return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = await hashPassword(password);
  const [provider] = await db
    .insert(schema.providers)
    .values({ name, email, passwordHash, firmName, role: 'advisor', passwordChangedAt: new Date() })
    .returning();

  const stage = await openSession(req, res, 'provider', provider.id);
  const me: Me = { kind: 'provider', id: provider.id, name: provider.name, email: provider.email, firmName: provider.firmName };
  const state: AuthState = { stage, me };
  res.status(201).json(state);
});

/* Logout revokes the current session row; an anonymous logout is a no-op that
   still clears the cookie, so a stale browser tab can always "sign out". */
router.post('/logout', async (req, res) => {
  const token = readSessionToken(req);
  if (token) {
    const session = await findSessionByToken(token);
    if (session) {
      await revokeSession(session.id);
      await audit({
        action: 'auth.logout',
        targetType: session.userKind,
        targetId: session.userId,
        actorKind: session.userKind,
        actorId: session.userId,
        ip: ipOf(req),
      });
    }
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

/* Sign out everywhere: every session of the caller, including this one. */
router.post('/logout-all', authenticate, async (req, res) => {
  const auth = req.auth!;
  const revoked = await revokeAllSessions(auth.kind, auth.sub);
  await audit({
    action: 'session.revoked',
    targetType: auth.kind,
    targetId: auth.sub,
    actorKind: auth.kind,
    actorId: auth.sub,
    ip: ipOf(req),
    meta: { revoked, reason: 'signed out everywhere' },
  });
  clearSessionCookie(res);
  res.json({ ok: true, revoked });
});

/* Live sessions of the caller (for the security card); `current` marks this one. */
router.get('/sessions', authenticate, async (req, res) => {
  const auth = req.auth!;
  const rows = await listLiveSessions(auth.kind, auth.sub);
  res.json(rows.map((s) => toSessionDto(s, req.session?.id)));
});

/* Who am I and where does this session stand. Reachable in every stage so a
   reload during the second step lands back on the right screen. */
router.get('/me', authenticateAnyStage, async (req, res) => {
  const auth = req.auth!;
  const me = auth.kind === 'provider' ? await providerMe(auth.sub) : await clientMe(auth.sub);
  if (!me) return res.status(404).json({ error: 'Not found' });
  const state: AuthState = { stage: req.session!.stage, me };
  res.json(state);
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: passwordSchema,
});

/* Change the password while signed in. Every other session ends; this one stays.
   A wrong current password is 400, not 401 — the session itself is fine. */
router.post('/password', authenticate, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  const auth = req.auth!;
  const { currentPassword, newPassword } = parsed.data;

  const hash =
    auth.kind === 'provider'
      ? (await db.select({ h: schema.providers.passwordHash }).from(schema.providers).where(eq(schema.providers.id, auth.sub)))[0]?.h ?? null
      : (await db.select({ h: schema.clients.passwordHash }).from(schema.clients).where(eq(schema.clients.id, auth.sub)))[0]?.h ?? null;
  const check = await verifyPassword(currentPassword, hash);
  if (!check.ok) return res.status(400).json({ error: 'The current password is not right.', code: 'wrong_password' });
  if (isRefusedDemoPassword(newPassword)) return res.status(400).json(DEMO_REFUSED);

  await setPassword(auth.kind, auth.sub, newPassword);
  const revoked = await revokeAllSessions(auth.kind, auth.sub, { exceptId: req.session!.id });
  await audit({
    action: 'auth.password_changed',
    targetType: auth.kind,
    targetId: auth.sub,
    actorKind: auth.kind,
    actorId: auth.sub,
    ip: ipOf(req),
    meta: { otherSessionsRevoked: revoked },
  });
  res.json({ ok: true, revoked });
});

const resetRequestSchema = z.object({
  email: z.string().email().max(NAME_MAX),
  kind: z.enum(['provider', 'client']),
});

/* Always 202: the answer never says whether the account exists, so the response
   is identical whether or not a row (and an email) was created. This is the one
   reset path with no copy-link — without SMTP the advisor or the admin CLI still
   has to hand the link over, which is why `emailQueued` is never leaked here. */
router.post('/password-reset/request', lookupLimiter, async (req, res) => {
  const parsed = resetRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  const { email, kind } = parsed.data;

  if (kind === 'provider') {
    const [p] = await db.select({ id: schema.providers.id, deactivatedAt: schema.providers.deactivatedAt, firmName: schema.providers.firmName }).from(schema.providers).where(eq(schema.providers.email, email));
    if (p && !p.deactivatedAt) {
      const { token } = await createPasswordReset('provider', p.id);
      await enqueueEmail({ template: 'password_reset', to: email, link: resetLink(token), firmName: p.firmName ?? undefined });
    }
  } else {
    const [c] = await db
      .select({ id: schema.clients.id, deactivatedAt: schema.clients.deactivatedAt, passwordHash: schema.clients.passwordHash, providerId: schema.clients.providerId })
      .from(schema.clients)
      .where(eq(schema.clients.email, email));
    if (c && !c.deactivatedAt && c.passwordHash) {
      const { token } = await createPasswordReset('client', c.id);
      // Only worth a second query when there is a mail server to send it through.
      const [p] = isMailConfigured()
        ? await db.select({ firmName: schema.providers.firmName, name: schema.providers.name }).from(schema.providers).where(eq(schema.providers.id, c.providerId))
        : [undefined];
      await enqueueEmail({ template: 'password_reset', to: email, link: resetLink(token), firmName: p?.firmName ?? p?.name ?? undefined });
    }
  }
  res.status(202).json({ ok: true });
});

const resetConfirmSchema = z.object({
  token: z.string().min(1).max(128),
  password: passwordSchema,
});

const RESET_STATE_ERRORS = {
  missing: { error: 'This reset link is not valid.', code: 'invalid_token' },
  used: { error: 'This reset link was already used. Ask for a new one.', code: 'used' },
  expired: { error: 'This reset link has expired. Ask for a new one.', code: 'expired' },
} as const;

/* Completing a reset sets the password and ends every session; the user signs in again (with MFA). */
router.post('/password-reset/confirm', lookupLimiter, async (req, res) => {
  const parsed = resetConfirmSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  const { token, password } = parsed.data;

  const reset = looksLikeToken(token) ? await findPasswordReset(token) : null;
  const state = tokenState(reset);
  if (state !== 'ok' || !reset) return res.status(400).json(RESET_STATE_ERRORS[state === 'ok' ? 'missing' : state]);
  if (isRefusedDemoPassword(password)) return res.status(400).json(DEMO_REFUSED);

  await completePasswordReset(reset, password);
  // The actor is whoever held the link; the account is what the firm needs to see.
  await audit({
    action: 'auth.password_reset',
    targetType: reset.userKind,
    targetId: reset.userId,
    actorKind: reset.userKind,
    actorId: reset.userId,
    ip: ipOf(req),
    meta: { viaLink: true },
  });
  res.json({ ok: true });
});

export default router;
