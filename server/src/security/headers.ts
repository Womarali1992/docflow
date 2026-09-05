/**
 * Response security headers (plan: Security design → Headers).
 *
 * The API only ever answers JSON, downloads and (from C2.4) previews, so the
 * policy is as tight as helmet allows. HSTS is Caddy's job; helmet's is off so
 * the two never disagree.
 */
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';

export const CONTENT_SECURITY_POLICY =
  // Exactly what helmet emits (directives joined with ';', no spaces).
  "default-src 'self';img-src 'self' data: blob:;font-src 'self';frame-src 'self';object-src 'none';base-uri 'none';form-action 'self'";

/** Photo capture in the client portal needs the camera; nothing else is granted. */
export const PERMISSIONS_POLICY = 'camera=(self), microphone=(), geolocation=(), payment=()';

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'self'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'"],
      'frame-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'self'"],
    },
  },
  referrerPolicy: { policy: 'no-referrer' },
  strictTransportSecurity: false,
  crossOriginEmbedderPolicy: false,
});

export function permissionsPolicy(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  next();
}
