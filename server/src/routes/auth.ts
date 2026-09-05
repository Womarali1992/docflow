import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { db, schema } from '../db/client.js';
import { authenticate, clearAuthCookie, setAuthCookie, signToken } from '../middleware/auth.js';

const router = Router();

// Throttle credential-guessing: 20 attempts / 15 min / IP. Successful logins don't count.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Please try again later.' },
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  kind: z.enum(['provider', 'client']),
});

router.post('/login', loginLimiter, async (req, res) => {
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

    const token = signToken({
      sub: provider.id,
      kind: 'provider',
      providerId: provider.id,
      email: provider.email,
      name: provider.name,
    });
    setAuthCookie(res, token);
    return res.json({
      kind: 'provider',
      id: provider.id,
      name: provider.name,
      email: provider.email,
      firmName: provider.firmName,
    });
  } else {
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.email, email));
    if (!client || !client.passwordHash) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, client.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const [prov] = await db.select({ name: schema.providers.name }).from(schema.providers).where(eq(schema.providers.id, client.providerId));

    const token = signToken({
      sub: client.id,
      kind: 'client',
      providerId: client.providerId,
      email: client.email,
      name: client.name,
    });
    setAuthCookie(res, token);
    return res.json({
      kind: 'client',
      id: client.id,
      name: client.name,
      email: client.email,
      providerId: client.providerId,
      providerName: prov?.name ?? null,
    });
  }
});

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  firmName: z.string().optional(),
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

  const token = signToken({
    sub: provider.id,
    kind: 'provider',
    providerId: provider.id,
    email: provider.email,
    name: provider.name,
  });
  setAuthCookie(res, token);
  res.status(201).json({
    kind: 'provider',
    id: provider.id,
    name: provider.name,
    email: provider.email,
    firmName: provider.firmName,
  });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', authenticate, async (req, res) => {
  const auth = req.auth!;
  if (auth.kind === 'provider') {
    const [p] = await db.select().from(schema.providers).where(eq(schema.providers.id, auth.sub));
    if (!p) return res.status(404).json({ error: 'Not found' });
    return res.json({
      kind: 'provider',
      id: p.id,
      name: p.name,
      email: p.email,
      firmName: p.firmName,
    });
  } else {
    const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, auth.sub));
    if (!c) return res.status(404).json({ error: 'Not found' });
    const [prov] = await db.select({ name: schema.providers.name }).from(schema.providers).where(eq(schema.providers.id, c.providerId));
    return res.json({
      kind: 'client',
      id: c.id,
      name: c.name,
      email: c.email,
      providerId: c.providerId,
      providerName: prov?.name ?? null,
    });
  }
});

export default router;
