/**
 * Client invitations (plan: Data model → invitations; R13 copy-link).
 *
 * The advisor creates a link; the client opens it, sets a password and lands
 * in MFA enrollment. A new invitation replaces any unused one for the client.
 * Email delivery arrives with the job queue (C1.4); the link is always
 * returned to the advisor so onboarding works without SMTP.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { Invitation } from '../db/schema.js';
import { hashPassword } from './passwords.js';
import { revokeAllSessions, hashToken } from './sessions.js';
import { appBaseUrl, newToken } from './tokens.js';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function invitationLink(token: string): string {
  return `${appBaseUrl()}/invite/${token}`;
}

/** Issues a fresh single-use link for the client and retires every unused older one. */
export async function createInvitation(clientId: string, createdById: string, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const { token, tokenHash } = newToken();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  await db.transaction(async (tx) => {
    await tx.delete(schema.invitations).where(and(eq(schema.invitations.clientId, clientId), isNull(schema.invitations.usedAt)));
    await tx.insert(schema.invitations).values({ clientId, tokenHash, expiresAt, createdById, createdAt: now });
  });
  return { token, expiresAt };
}

export async function findInvitation(token: string): Promise<Invitation | null> {
  const [row] = await db.select().from(schema.invitations).where(eq(schema.invitations.tokenHash, hashToken(token)));
  return row ?? null;
}

/** Sets the client's password, burns the invitation and ends any session the client already had. */
export async function acceptInvitation(invitation: Invitation, password: string, now = new Date()): Promise<void> {
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const burned = await tx
      .update(schema.invitations)
      .set({ usedAt: now })
      .where(and(eq(schema.invitations.id, invitation.id), isNull(schema.invitations.usedAt)))
      .returning({ id: schema.invitations.id });
    if (burned.length !== 1) throw new Error('Invitation already used');
    await tx
      .update(schema.clients)
      .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
      .where(eq(schema.clients.id, invitation.clientId));
  });
  await revokeAllSessions('client', invitation.clientId, {}, now);
}

/** Unused invitations are dropped when a client is deactivated; a stale link must not outlive the account. */
export async function dropUnusedInvitations(clientId: string): Promise<void> {
  await db.delete(schema.invitations).where(and(eq(schema.invitations.clientId, clientId), isNull(schema.invitations.usedAt)));
}
