import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthPayload {
  sub: string;
  kind: 'provider' | 'client';
  providerId: string;
  email: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

const DEV_FALLBACK_SECRET = 'dev_only_secret';

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!secret || secret === DEV_FALLBACK_SECRET || secret === 'dev_only_secret_change_me_in_production') {
      throw new Error(
        'JWT_SECRET must be set to a strong, non-default value in production. Refusing to start.'
      );
    }
    return secret;
  }
  return secret || DEV_FALLBACK_SECRET;
}

const JWT_SECRET = resolveJwtSecret();
const COOKIE_NAME = 'docflow_session';

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 3600 * 1000,
    path: '/',
  });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.auth = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid session' });
  }
}

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
