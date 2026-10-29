/**
 * Staff invitations: how a second advisor joins a firm (FIRM-BOOK-PLAN F4).
 *
 * The owner adds the advisor by name and address; the account exists from that
 * moment, without a password, and the link is how its owner chooses one. The
 * rules are the client invitations' exactly (single use, 7 days, sha256 of the
 * token at rest, a new link retires an unused one), in a table of their own so
 * the client path is not touched by any of this.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { StaffInvitation } from '../db/schema.js';
import { INVITATION_TTL_MS } from './invitations.js';
import { hashPassword } from './passwords.js';
import { hashToken, revokeAllSessions } from './sessions.js';
import { appBaseUrl, newToken } from './tokens.js';

export function staffInvitationLink(token: string): string {
  return `${appBaseUrl()}/staff-invite/${token}`;
}

/** Issues a fresh single-use link for the advisor and retires every unused older one. */
export async function createStaffInvitation(
  providerId: string,
  createdById: string,
  now = new Date()
): Promise<{ token: string; expiresAt: Date }> {
  const { token, tokenHash } = newToken();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.staffInvitations)
      .where(and(eq(schema.staffInvitations.providerId, providerId), isNull(schema.staffInvitations.usedAt)));
    await tx.insert(schema.staffInvitations).values({ providerId, tokenHash, expiresAt, createdById, createdAt: now });
  });
  return { token, expiresAt };
}

export async function findStaffInvitation(token: string): Promise<StaffInvitation | null> {
  const [row] = await db.select().from(schema.staffInvitations).where(eq(schema.staffInvitations.tokenHash, hashToken(token)));
  return row ?? null;
}

/** Sets the advisor's first password and burns the link. */
export async function acceptStaffInvitation(invitation: StaffInvitation, password: string, now = new Date()): Promise<void> {
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const burned = await tx
      .update(schema.staffInvitations)
      .set({ usedAt: now })
      .where(and(eq(schema.staffInvitations.id, invitation.id), isNull(schema.staffInvitations.usedAt)))
      .returning({ id: schema.staffInvitations.id });
    if (burned.length !== 1) throw new Error('Invitation already used');
    await tx
      .update(schema.providers)
      .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
      .where(eq(schema.providers.id, invitation.providerId));
  });
  await revokeAllSessions('provider', invitation.providerId, {}, now);
}

/** A deactivated advisor's pending link dies with the account. */
export async function dropUnusedStaffInvitations(providerId: string): Promise<void> {
  await db
    .delete(schema.staffInvitations)
    .where(and(eq(schema.staffInvitations.providerId, providerId), isNull(schema.staffInvitations.usedAt)));
}
