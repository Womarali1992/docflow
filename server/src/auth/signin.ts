/**
 * What every sign-in path (login, signup, invitation acceptance) shares: the
 * identity envelope the UI routes on and the rule that a fresh session is
 * never `active` — an enrolled account owes a code, anyone else an enrollment.
 */
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { isEffectiveAdvisor } from '../db/firms.js';
import type { SessionStage } from '../db/schema.js';
import { getMfa, isEnrolled } from './mfa.js';
import { createSession, setSessionCookie } from './sessions.js';

export type Me =
  | { kind: 'provider'; id: string; name: string; email: string; firmName: string | null; role: string }
  | { kind: 'client'; id: string; name: string; email: string; firmId: string; providerName: string | null };

/** Every auth answer says where the session stands (invariant 9): the UI routes on `stage`, not on `me`. */
export interface AuthState {
  stage: SessionStage;
  me: Me;
}

export async function providerMe(id: string): Promise<Me | null> {
  const [p] = await db
    .select({
      id: schema.providers.id,
      name: schema.providers.name,
      email: schema.providers.email,
      firmName: schema.firms.name,
      role: schema.providers.role,
    })
    .from(schema.providers)
    .innerJoin(schema.firms, eq(schema.firms.id, schema.providers.firmId))
    .where(eq(schema.providers.id, id));
  if (!p) return null;
  return { kind: 'provider', ...p };
}

/**
 * `providerName` is who the portal says looks after the client: their assigned
 * advisor, or the firm while they have none (or theirs has left). It names a
 * person the client can ask for, never one who cannot answer.
 */
export async function clientMe(id: string): Promise<Me | null> {
  const [c] = await db
    .select({
      id: schema.clients.id,
      name: schema.clients.name,
      email: schema.clients.email,
      firmId: schema.clients.firmId,
      firmName: schema.firms.name,
      advisorName: schema.providers.name,
    })
    .from(schema.clients)
    .innerJoin(schema.firms, eq(schema.firms.id, schema.clients.firmId))
    .leftJoin(schema.providers, isEffectiveAdvisor)
    .where(eq(schema.clients.id, id));
  if (!c) return null;
  return {
    kind: 'client',
    id: c.id,
    name: c.name,
    email: c.email,
    firmId: c.firmId,
    providerName: c.advisorName ?? c.firmName,
  };
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
