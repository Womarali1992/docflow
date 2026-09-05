import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';
import {
  clearSessionCookie,
  createSession,
  findSessionByToken,
  listLiveSessions,
  readSessionToken,
  revokeAllSessions,
  revokeSession,
  setSessionCookie,
  toSessionDto,
} from '../auth/sessions.js';
import { NAME_MAX, loginEmailLimiter, loginIpLimiter } from '../security/limits.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email().max(NAME_MAX),
  password: z.string().min(1).max(1024),
  kind: z.enum(['provider', 'client']),
});

type Me =
  | { kind: 'provider'; id: string; name: string; email: string; firmName: string | null }
  | { kind: 'client'; id: string; name: string; email: string; providerId: string; providerName: string | null };

async function startSession(req: Request, res: Response, userKind: 'provider' | 'client', userId: string) {
  const { token } = await createSession({
    userKind,
    userId,
    ip: req.ip ?? null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  });
  setSessionCookie(res, token);
}

router.post('/login', loginIpLimiter, loginEmailLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  }
  const { email, password, kind } = parsed.data;

  if (kind === 'provider') {
    const [provider] = await db.select().from(schema.providers).where(eq(schema.providers.email, email));
    if (!provider) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, provider.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    await startSession(req, res, 'provider', provider.id);
    const me: Me = { kind: 'provider', id: provider.id, name: provider.name, email: provider.email, firmName: provider.firmName };
    return res.json(me);
  } else {
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.email, email));
    if (!client || !client.passwordHash) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, client.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const [prov] = await db.select({ name: schema.providers.name }).from(schema.providers).where(eq(schema.providers.id, client.providerId));

    await startSession(req, res, 'client', client.id);
    const me: Me = {
      kind: 'client',
      id: client.id,
      name: client.name,
      email: client.email,
      providerId: client.providerId,
      providerName: prov?.name ?? null,
    };
    return res.json(me);
  }
});

const signupSchema = z.object({
  name: z.string().min(1).max(NAME_MAX),
  email: z.string().email().max(NAME_MAX),
  password: z.string().min(6).max(1024),
  firmName: z.string().max(NAME_MAX).optional(),
});

/* Self-service advisor signup is off unless explicitly enabled; the pilot
   provisions advisors locally. Read at request time so tests can toggle it. */
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

  const passwordHash = await bcrypt.hash(password, 10);
  const [provider] = await db
    .insert(schema.providers)
    .values({ name, email, passwordHash, firmName, role: 'advisor' })
    .returning();

  await startSession(req, res, 'provider', provider.id);
  const me: Me = { kind: 'provider', id: provider.id, name: provider.name, email: provider.email, firmName: provider.firmName };
  res.status(201).json(me);
});

/* Logout revokes the current session row; an anonymous logout is a no-op that
   still clears the cookie, so a stale browser tab can always "sign out". */
router.post('/logout', async (req, res) => {
  const token = readSessionToken(req);
  if (token) {
    const session = await findSessionByToken(token);
    if (session) await revokeSession(session.id);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

/* Sign out everywhere: every session of the caller, including this one. */
router.post('/logout-all', authenticate, async (req, res) => {
  const auth = req.auth!;
  const revoked = await revokeAllSessions(auth.kind, auth.sub);
  clearSessionCookie(res);
  res.json({ ok: true, revoked });
});

/* Live sessions of the caller (for the security card); `current` marks this one. */
router.get('/sessions', authenticate, async (req, res) => {
  const auth = req.auth!;
  const rows = await listLiveSessions(auth.kind, auth.sub);
  res.json(rows.map((s) => toSessionDto(s, req.session?.id)));
});

router.get('/me', authenticate, async (req, res) => {
  const auth = req.auth!;
  if (auth.kind === 'provider') {
    const [p] = await db.select().from(schema.providers).where(eq(schema.providers.id, auth.sub));
    if (!p) return res.status(404).json({ error: 'Not found' });
    const me: Me = { kind: 'provider', id: p.id, name: p.name, email: p.email, firmName: p.firmName };
    return res.json(me);
  } else {
    const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, auth.sub));
    if (!c) return res.status(404).json({ error: 'Not found' });
    const [prov] = await db.select({ name: schema.providers.name }).from(schema.providers).where(eq(schema.providers.id, c.providerId));
    const me: Me = {
      kind: 'client',
      id: c.id,
      name: c.name,
      email: c.email,
      providerId: c.providerId,
      providerName: prov?.name ?? null,
    };
    return res.json(me);
  }
});

export default router;
