/**
 * One-time links (invitations, password resets): 32 random bytes in the URL,
 * only the sha256 at rest, so a database copy cannot be turned into a link.
 */
import { randomBytes } from 'node:crypto';
import { hashToken } from './sessions.js';

export function newToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export type TokenState = 'ok' | 'used' | 'expired' | 'missing';

export function tokenState(row: { expiresAt: Date; usedAt: Date | null } | null | undefined, now = new Date()): TokenState {
  if (!row) return 'missing';
  if (row.usedAt) return 'used';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'ok';
}

/** Where links point: APP_BASE_URL (required in production; the origin check already enforces it). */
export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
}

/** Token-shaped input only: base64url of 32 bytes is 43 characters. */
export function looksLikeToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}
