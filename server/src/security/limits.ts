/**
 * Request throttling and body/field limits (plan: Security design → Throttling, Sessions).
 *
 * Login is throttled per IP and per email; everything under /api is throttled
 * per session (per IP when anonymous). Field limits are shared with the zod
 * schemas so the numbers live in one place.
 */
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { readSessionToken } from '../auth/sessions.js';

export const JSON_BODY_LIMIT = '1mb';
export const NAME_MAX = 200;
export const INSTRUCTIONS_MAX = 2000;
export const MESSAGE_MAX = 5000;

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function limitFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const tooMany = { error: 'Too many requests. Please try again later.', code: 'rate_limited' };

/** 20 attempts / 15 min per IP. Successful logins do not count. */
export const loginIpLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: limitFromEnv('RATE_LIMIT_LOGIN_IP', 20),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Please try again later.', code: 'rate_limited' },
});

/** 10 attempts / 15 min per email (case-insensitive), so one account cannot be brute-forced from many addresses. */
export const loginEmailLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: limitFromEnv('RATE_LIMIT_LOGIN_EMAIL', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    return typeof email === 'string' ? `email:${email.trim().toLowerCase()}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
  },
  message: { error: 'Too many login attempts for this account. Please try again later.', code: 'rate_limited' },
});

/** Key: the session (hashed, so the token never sits in the store) or the client IP when anonymous. */
export function throttleKey(req: Request): string {
  const token = readSessionToken(req);
  if (token) return `s:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
  return `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

/** 600 requests / 15 min per session. Exported as a factory so the limit can be unit-tested. */
export function createGlobalLimiter(limit: number) {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: throttleKey,
    message: tooMany,
  });
}

export const globalLimiter = createGlobalLimiter(limitFromEnv('RATE_LIMIT_GLOBAL', 600));
