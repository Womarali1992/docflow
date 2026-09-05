/**
 * Origin check for every state-changing `/api` request (plan: Security design → CSRF).
 *
 * Cookie-authenticated APIs are reachable by any page the browser visits, so
 * a non-GET request must prove it came from the app itself:
 *   - if the browser sent `Sec-Fetch-Site`, it must be `same-origin` (or `none`
 *     for a user-initiated navigation);
 *   - otherwise `Origin` must equal the origin of `APP_BASE_URL`.
 * A request with neither header is refused — a browser always sends at least
 * one of them for a non-GET request, and API clients must set Origin.
 *
 * Mounted before every router so multipart routes are covered as well.
 */
import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Origin (scheme://host[:port]) the app is served from; the only Origin that may mutate state. */
export function appOrigin(): string {
  const raw = process.env.APP_BASE_URL || process.env.CORS_ORIGIN;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('APP_BASE_URL must be set in production (the public https origin, e.g. https://docs.example.com).');
    }
    return 'http://localhost:8080';
  }
  return new URL(raw).origin;
}

export type OriginVerdict = { ok: true } | { ok: false; reason: 'sec-fetch-site' | 'origin-mismatch' | 'missing' };

export function checkOrigin(headers: { 'sec-fetch-site'?: string; origin?: string }, allowedOrigin: string): OriginVerdict {
  const site = headers['sec-fetch-site'];
  if (site !== undefined) {
    return site === 'same-origin' || site === 'none' ? { ok: true } : { ok: false, reason: 'sec-fetch-site' };
  }
  const origin = headers.origin;
  if (origin === undefined) return { ok: false, reason: 'missing' };
  return origin === allowedOrigin ? { ok: true } : { ok: false, reason: 'origin-mismatch' };
}

export function originCheck(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  const verdict = checkOrigin(
    { 'sec-fetch-site': headerValue(req, 'sec-fetch-site'), origin: headerValue(req, 'origin') },
    appOrigin()
  );
  if (verdict.ok) return next();
  res.status(403).json({ error: 'Cross-site request refused', code: 'bad_origin' });
}

function headerValue(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}
