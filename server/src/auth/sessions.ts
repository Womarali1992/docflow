/**
 * Opaque server-side sessions (plan: Security design → Sessions).
 *
 * The cookie carries 32 random bytes (base64url); the `sessions` row stores the
 * sha256 of that token, so a database read never yields a usable cookie. A
 * session ends when it is revoked, when it passes its absolute lifetime
 * (12 h from creation) or when it has been idle for 30 minutes. `lastSeenAt` is
 * bumped at most once a minute and never for polling requests, so an open tab
 * that only polls still times out.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { Session, SessionStage } from '../db/schema.js';

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
/** `lastSeenAt` is written at most this often. */
export const TOUCH_INTERVAL_MS = 60 * 1000;
/** Requests carrying this header keep the session alive without extending it. */
export const POLL_HEADER = 'x-docflow-poll';

const isProduction = () => process.env.NODE_ENV === 'production';

/** `__Host-` prefix in production: the browser then refuses the cookie unless it is Secure, Path=/ and host-only. */
export function sessionCookieName(): string {
  return isProduction() ? '__Host-docflow_session' : 'docflow_session';
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction(),
    path: '/',
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(sessionCookieName(), token, { ...cookieOptions(), maxAge: ABSOLUTE_TIMEOUT_MS });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(sessionCookieName(), cookieOptions());
}

export function readSessionToken(req: Request): string | null {
  const raw = (req.cookies as Record<string, unknown> | undefined)?.[sessionCookieName()];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export type SessionState = 'ok' | 'revoked' | 'expired' | 'idle';

/** Why a session is not usable, in the order the checks are applied. */
export function sessionState(session: Pick<Session, 'revokedAt' | 'expiresAt' | 'lastSeenAt'>, now = new Date()): SessionState {
  if (session.revokedAt) return 'revoked';
  if (now.getTime() > session.expiresAt.getTime()) return 'expired';
  if (now.getTime() - session.lastSeenAt.getTime() > IDLE_TIMEOUT_MS) return 'idle';
  return 'ok';
}

export interface CreateSessionInput {
  userKind: 'provider' | 'client';
  userId: string;
  /** preauth (second factor pending) or mfa_enroll (no authenticator yet); never active at login. */
  stage: SessionStage;
  ip?: string | null;
  userAgent?: string | null;
}

/** Inserts a session row and returns the raw token (only ever sent to the browser). */
export async function createSession(input: CreateSessionInput, now = new Date()): Promise<{ token: string; session: Session }> {
  const token = randomBytes(32).toString('base64url');
  const [session] = await db
    .insert(schema.sessions)
    .values({
      tokenHash: hashToken(token),
      userKind: input.userKind,
      userId: input.userId,
      stage: input.stage,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS),
      ip: input.ip ? input.ip.slice(0, 64) : null,
      userAgent: input.userAgent ? input.userAgent.slice(0, 256) : null,
    })
    .returning();
  return { token, session };
}

export async function findSessionByToken(token: string): Promise<Session | null> {
  const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
  return row ?? null;
}

/**
 * Extends the idle window. Skipped when the last write is younger than
 * TOUCH_INTERVAL_MS (cheap) or when the request is a poll (policy).
 */
export async function touchSession(session: Session, opts: { poll: boolean }, now = new Date()): Promise<boolean> {
  if (opts.poll) return false;
  if (now.getTime() - session.lastSeenAt.getTime() < TOUCH_INTERVAL_MS) return false;
  await db.update(schema.sessions).set({ lastSeenAt: now }).where(eq(schema.sessions.id, session.id));
  return true;
}

/** Moves a session between MFA stages (login → verify/enroll → active). */
export async function setSessionStage(id: string, stage: SessionStage, now = new Date()): Promise<void> {
  await db.update(schema.sessions).set({ stage, lastSeenAt: now }).where(eq(schema.sessions.id, id));
}

export async function revokeSession(id: string, now = new Date()): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: now })
    .where(and(eq(schema.sessions.id, id), isNull(schema.sessions.revokedAt)));
}

/** Revokes every live session of a user; `exceptId` keeps the caller's own session. */
export async function revokeAllSessions(
  userKind: 'provider' | 'client',
  userId: string,
  opts: { exceptId?: string } = {},
  now = new Date()
): Promise<number> {
  const conditions = [
    eq(schema.sessions.userKind, userKind),
    eq(schema.sessions.userId, userId),
    isNull(schema.sessions.revokedAt),
  ];
  if (opts.exceptId) conditions.push(ne(schema.sessions.id, opts.exceptId));
  const rows = await db
    .update(schema.sessions)
    .set({ revokedAt: now })
    .where(and(...conditions))
    .returning({ id: schema.sessions.id });
  return rows.length;
}

/** Live (unrevoked, unexpired, not idle) sessions of a user, newest first. */
export async function listLiveSessions(userKind: 'provider' | 'client', userId: string, now = new Date()): Promise<Session[]> {
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userKind, userKind), eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));
  return rows
    .filter((s) => sessionState(s, now) === 'ok')
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
}

export interface SessionDto {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

/** Explicit field list: the token hash never leaves the server. */
export function toSessionDto(session: Session, currentId: string | undefined): SessionDto {
  return {
    id: session.id,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    ip: session.ip,
    userAgent: session.userAgent,
    current: session.id === currentId,
  };
}
