/**
 * The audit log (invariant 11: append-only, enforced by a trigger in 0007).
 *
 * It records *that* something happened — who, to what, when, from where — and
 * never what was inside it. No passwords, tokens, document bytes, message text
 * or email addresses in the clear: an email is hashed, so a log can confirm
 * "this address failed to sign in eleven times" without carrying the address.
 *
 * Writing must never break the action being audited. `audit()` therefore logs
 * and swallows its own failures — a full disk should not stop a client from
 * uploading a document. Anything that truly must be transactional passes `tx`.
 */
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { db, schema } from './client.js';

/** Vocabulary of audited events. Extended as C2.2-C5.2 wire the rest of them up. */
export type AuditAction =
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.mfa_enrolled'
  | 'auth.mfa_failed'
  | 'auth.password_changed'
  | 'auth.password_reset'
  | 'session.revoked'
  | 'invitation.created'
  | 'invitation.accepted'
  | 'client.created'
  | 'client.deactivated'
  | 'client.reactivated'
  | 'engagement.created'
  | 'engagement.closed'
  | 'request.created'
  | 'request.accepted'
  | 'request.correction_requested'
  | 'request.waived'
  | 'document.published'
  | 'document.quarantined'
  | 'document.downloaded'
  | 'document.previewed'
  | 'document.shared'
  | 'document.unshared'
  | 'document.archived'
  | 'admin.action'
  | 'backup.run'
  | 'legacy.import';

export interface AuditEntry {
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  /** Which client's file this belongs to, so an advisor can read one client's history. */
  clientId?: string | null;
  actorKind?: 'provider' | 'client' | 'admin' | 'system' | null;
  actorId?: string | null;
  ip?: string | null;
  /** Small, non-confidential context: counts, statuses, reasons. Never content. */
  meta?: Record<string, unknown>;
}

/** Executor: the shared connection, or a transaction when the row must land with the change. */
type Executor = Pick<typeof db, 'insert'>;

/**
 * Hash an email before it goes anywhere near the log (plan: "login success /
 * failure (email hashed)"). Same address always yields the same digest, so
 * repeated failures are still countable.
 */
export function hashedEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

/** The caller's IP, or null. Behind Caddy this is the real client (TRUST_PROXY=1). */
export function ipOf(req: Pick<Request, 'ip'> | null | undefined): string | null {
  return req?.ip ?? null;
}

/**
 * Records one event. Never throws: an audit failure is logged to the console and
 * the caller carries on, because losing the action would be worse than losing
 * its record. Pass `tx` when the two must succeed or fail together.
 */
export async function audit(entry: AuditEntry, tx?: Executor): Promise<void> {
  try {
    await (tx ?? db).insert(schema.auditLog).values({
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      clientId: entry.clientId ?? null,
      actorKind: entry.actorKind ?? null,
      actorId: entry.actorId ?? null,
      ip: entry.ip ?? null,
      meta: entry.meta ?? {},
    });
  } catch (err) {
    if (tx) throw err; // Inside a transaction the caller asked for atomicity — honour it.
    console.error(`[audit] could not record ${entry.action} on ${entry.targetType}:`, err instanceof Error ? err.message : err);
  }
}

/** Convenience for routes: pulls actor and IP off the request. */
export async function auditRequest(
  req: Pick<Request, 'ip'> & { auth?: { sub: string; kind: 'provider' | 'client' } },
  entry: Omit<AuditEntry, 'actorKind' | 'actorId' | 'ip'>
): Promise<void> {
  await audit({
    ...entry,
    actorKind: req.auth?.kind ?? null,
    actorId: req.auth?.sub ?? null,
    ip: ipOf(req),
  });
}
