import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { SessionStage } from '../db/schema.js';
import {
  POLL_HEADER,
  clearSessionCookie,
  findSessionByToken,
  readSessionToken,
  revokeSession,
  sessionState,
  touchSession,
} from '../auth/sessions.js';

/**
 * The shape routes have relied on since the JWT era; kept verbatim so no route
 * changes (Compatibility ledger: "req.auth shape from the JWT era", kept).
 */
export interface AuthPayload {
  sub: string;
  kind: 'provider' | 'client';
  providerId: string;
  email: string;
  name: string;
}

export interface SessionInfo {
  id: string;
  stage: SessionStage;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
      session?: SessionInfo;
    }
  }
}

export type AuthFailure = 'missing' | 'invalid' | 'revoked' | 'expired' | 'idle';

const FAILURE_MESSAGE: Record<AuthFailure, string> = {
  missing: 'Not authenticated',
  invalid: 'Session ended',
  revoked: 'Session ended',
  expired: 'Session expired',
  idle: 'Signed out after 30 minutes of inactivity',
};

function reject(res: Response, reason: AuthFailure) {
  clearSessionCookie(res);
  return res.status(401).json({ error: FAILURE_MESSAGE[reason], reason });
}

/**
 * Resolves the account behind a session into the `req.auth` shape; null when
 * the account is gone or deactivated (the caller then revokes the session, so
 * a deactivation takes effect on the very next request).
 */
export async function loadAuth(kind: 'provider' | 'client', id: string): Promise<AuthPayload | null> {
  if (kind === 'provider') {
    const [p] = await db
      .select({ id: schema.providers.id, email: schema.providers.email, name: schema.providers.name, deactivatedAt: schema.providers.deactivatedAt })
      .from(schema.providers)
      .where(eq(schema.providers.id, id));
    if (!p || p.deactivatedAt) return null;
    return { sub: p.id, kind: 'provider', providerId: p.id, email: p.email, name: p.name };
  }
  const [c] = await db
    .select({
      id: schema.clients.id,
      providerId: schema.clients.providerId,
      email: schema.clients.email,
      name: schema.clients.name,
      deactivatedAt: schema.clients.deactivatedAt,
    })
    .from(schema.clients)
    .where(eq(schema.clients.id, id));
  if (!c || c.deactivatedAt) return null;
  return { sub: c.id, kind: 'client', providerId: c.providerId, email: c.email, name: c.name };
}

/**
 * Loads the session named by the cookie, refuses it when revoked / expired /
 * idle (401 with a `reason` the UI can explain), then extends the idle window
 * unless the request is a poll. With `requireActive` (the default everywhere
 * except the MFA, `me` and logout endpoints) a session that has not finished
 * its second factor is refused with 403 `mfa_required` (invariant 9).
 */
function makeAuthenticate(opts: { requireActive: boolean }) {
  return async function authenticate(req: Request, res: Response, next: NextFunction) {
    try {
      const token = readSessionToken(req);
      if (!token) return reject(res, 'missing');

      const session = await findSessionByToken(token);
      if (!session) return reject(res, 'invalid');

      const state = sessionState(session);
      if (state !== 'ok') return reject(res, state);

      const auth = await loadAuth(session.userKind, session.userId);
      if (!auth) {
        await revokeSession(session.id);
        return reject(res, 'revoked');
      }

      if (opts.requireActive && session.stage !== 'active') {
        return res.status(403).json({
          error: session.stage === 'mfa_enroll' ? 'Set up two-step verification to continue' : 'Enter your verification code to continue',
          code: 'mfa_required',
          stage: session.stage,
        });
      }

      await touchSession(session, { poll: req.headers[POLL_HEADER] === '1' });

      req.auth = auth;
      req.session = {
        id: session.id,
        stage: session.stage,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** The default: a live, fully verified (`active`) session. */
export const authenticate = makeAuthenticate({ requireActive: true });

/** Only for `/auth/me`, `/auth/mfa/*` and logout: a live session in any stage. */
export const authenticateAnyStage = makeAuthenticate({ requireActive: false });

export function requireProvider(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'Not authenticated' });
  if (req.auth.kind !== 'provider') return res.status(403).json({ error: 'Provider access required' });
  next();
}

export function requireClient(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'Not authenticated' });
  if (req.auth.kind !== 'client') return res.status(403).json({ error: 'Client access required' });
  next();
}
