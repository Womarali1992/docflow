/**
 * What every sign-in path (login, signup, invitation acceptance) shares: the
 * identity envelope the UI routes on and the rule that a fresh session is
 * never `active` — an enrolled account owes a code, anyone else an enrollment.
 */
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { SessionStage } from '../db/schema.js';
import { getMfa, isEnrolled } from './mfa.js';
import { createSession, setSessionCookie } from './sessions.js';

export type Me =
  | { kind: 'provider'; id: string; name: string; email: string; firmName: string | null }
  | { kind: 'client'; id: string; name: string; email: string; providerId: string; providerName: string | null };

/** Every auth answer says where the session stands (invariant 9): the UI routes on `stage`, not on `me`. */
export interface AuthState {
  stage: SessionStage;
  me: Me;
}

export async function providerMe(id: string): Promise<Me | null> {
  const [p] = await db.select().from(schema.providers).where(eq(schema.providers.id, id));
  if (!p) return null;
  return { kind: 'provider', id: p.id, name: p.name, email: p.email, firmName: p.firmName };
}

export async function clientMe(id: string): Promise<Me | null> {
  const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, id));
  if (!c) return null;
  const [prov] = await db.select({ name: schema.providers.name }).from(schema.providers).where(eq(schema.providers.id, c.providerId));
  return { kind: 'client', id: c.id, name: c.name, email: c.email, providerId: c.providerId, providerName: prov?.name ?? null };
}

export async function openSession(req: Request, res: Response, userKind: 'provider' | 'client', userId: string): Promise<SessionStage> {
  const stage: SessionStage = isEnrolled(await getMfa(userKind, userId)) ? 'preauth' : 'mfa_enroll';
  const { token } = await createSession({
    userKind,
    userId,
    stage,
    ip: req.ip ?? null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  });
  setSessionCookie(res, token);
  return stage;
}
