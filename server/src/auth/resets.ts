/**
 * Password resets and changes (plan: Data model → password_resets; invariant 7).
 *
 * A reset link lives one hour and works once; completing it (or changing the
 * password while signed in) stamps `passwordChangedAt` and revokes sessions.
 * Links are returned to whoever may hand them over (the advisor for a client,
 * the admin CLI for an advisor); email delivery arrives with C1.4.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { PasswordReset } from '../db/schema.js';
import { hashPassword } from './passwords.js';
import { hashToken, revokeAllSessions } from './sessions.js';
import { appBaseUrl, newToken } from './tokens.js';

export const RESET_TTL_MS = 60 * 60 * 1000;

export type UserKind = 'provider' | 'client';

export function resetLink(token: string): string {
  return `${appBaseUrl()}/reset/${token}`;
}

/** Issues a fresh single-use reset link and retires every unused older one for the user. */
export async function createPasswordReset(userKind: UserKind, userId: string, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const { token, tokenHash } = newToken();
  const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.passwordResets)
      .where(and(eq(schema.passwordResets.userKind, userKind), eq(schema.passwordResets.userId, userId), isNull(schema.passwordResets.usedAt)));
    await tx.insert(schema.passwordResets).values({ userKind, userId, tokenHash, expiresAt, createdAt: now });
  });
  return { token, expiresAt };
}

export async function findPasswordReset(token: string): Promise<PasswordReset | null> {
  const [row] = await db.select().from(schema.passwordResets).where(eq(schema.passwordResets.tokenHash, hashToken(token)));
  return row ?? null;
}

/** Stores a new password hash and stamps the change; does not touch sessions (callers decide which to revoke). */
export async function setPassword(userKind: UserKind, userId: string, password: string, now = new Date()): Promise<void> {
  const passwordHash = await hashPassword(password);
  if (userKind === 'provider') {
    await db.update(schema.providers).set({ passwordHash, passwordChangedAt: now, updatedAt: now }).where(eq(schema.providers.id, userId));
  } else {
    await db.update(schema.clients).set({ passwordHash, passwordChangedAt: now, updatedAt: now }).where(eq(schema.clients.id, userId));
  }
}

/** Burns the reset, sets the password and ends every session of the user. */
export async function completePasswordReset(reset: PasswordReset, password: string, now = new Date()): Promise<void> {
  const burned = await db
    .update(schema.passwordResets)
    .set({ usedAt: now })
    .where(and(eq(schema.passwordResets.id, reset.id), isNull(schema.passwordResets.usedAt)))
    .returning({ id: schema.passwordResets.id });
  if (burned.length !== 1) throw new Error('Reset link already used');
  await setPassword(reset.userKind, reset.userId, password, now);
  await revokeAllSessions(reset.userKind, reset.userId, {}, now);
}
