/**
 * Who looks after a client, and moving them to someone else (FIRM-BOOK-PLAN F5).
 *
 * Assignment lives on `clients.assigned_provider_id` and nowhere else, so a
 * move is one column on one row: no line, file or message is rewritten to
 * follow it. It decides who is told (`advisorsFor`) and whose "mine" the client
 * is in. It never decides who may look: every advisor in the firm sees the book.
 *
 * Two callers: `POST /clients/:id/assign` moves one client, and deactivating an
 * advisor (F4) moves all of theirs at once. Both write the same record of it —
 * a `client.reassigned` audit row per client, inside the transaction, because
 * a move and the record of it are one fact — and then the same human story: a
 * line on each client's activity and an in-app notice to whoever has them now.
 * The client is not told; their portal simply shows the new name.
 */
import type { Request } from 'express';
import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { auditRequest } from '../db/audit.js';
import { recordActivity } from '../db/activity-log.js';
import { notify } from '../notify.js';
import type { Tx } from './publish.js';

export interface Move {
  clientId: string;
  clientName: string;
  fromId: string | null;
  toId: string | null;
}

/**
 * An advisor of the firm who can sign in, or null: the only kind a client can
 * be given to. Someone invited who has not joined yet cannot be told anything.
 */
export async function activeAdvisorInFirm(firmId: string, providerId: string) {
  const [row] = await db
    .select({ id: schema.providers.id, name: schema.providers.name })
    .from(schema.providers)
    .where(
      and(
        eq(schema.providers.id, providerId),
        eq(schema.providers.firmId, firmId),
        isNull(schema.providers.deactivatedAt),
        isNotNull(schema.providers.passwordHash)
      )
    );
  return row ?? null;
}

/**
 * Gives `clientIds` (all of the firm's) to `toId`, or to nobody. A client who
 * already has `toId` is left alone and is not in the answer: moving someone to
 * where they already are is not a thing that happened.
 */
export async function reassignClients(
  tx: Tx,
  req: Parameters<typeof auditRequest>[0],
  input: { firmId: string; clientIds: string[]; toId: string | null; reason: 'assigned' | 'advisor_deactivated'; now?: Date }
): Promise<Move[]> {
  if (input.clientIds.length === 0) return [];
  const now = input.now ?? new Date();
  const notAlready =
    input.toId === null
      ? isNotNull(schema.clients.assignedProviderId)
      : or(isNull(schema.clients.assignedProviderId), ne(schema.clients.assignedProviderId, input.toId));
  const before = await tx
    .select({ id: schema.clients.id, name: schema.clients.name, fromId: schema.clients.assignedProviderId })
    .from(schema.clients)
    .where(and(eq(schema.clients.firmId, input.firmId), inArray(schema.clients.id, input.clientIds), notAlready))
    .for('update');
  if (before.length === 0) return [];

  await tx
    .update(schema.clients)
    .set({ assignedProviderId: input.toId, updatedAt: now })
    .where(inArray(schema.clients.id, before.map((c) => c.id)));
  for (const c of before) {
    await auditRequest(
      req,
      {
        action: 'client.reassigned',
        targetType: 'client',
        targetId: c.id,
        clientId: c.id,
        meta: { fromId: c.fromId, toId: input.toId, reason: input.reason },
      },
      tx
    );
  }
  return before.map((c) => ({ clientId: c.id, clientName: c.name, fromId: c.fromId, toId: input.toId }));
}

/** "Reassigned to James Okafor (was Sarah Mitchell)": what the client's activity says about a move. */
export function reassignmentLine(move: Pick<Move, 'fromId' | 'toId'>, names: ReadonlyMap<string, string>): string {
  const to = move.toId ? names.get(move.toId) ?? 'another advisor' : null;
  const from = move.fromId ? names.get(move.fromId) ?? 'another advisor' : null;
  if (to && from) return `Reassigned to ${to} (was ${from})`;
  if (to) return `Assigned to ${to}`;
  return from ? `Unassigned (was ${from})` : 'Unassigned';
}

/**
 * After the transaction: each moved client's activity line, and one in-app
 * notice to each advisor who now has clients they did not have before. No
 * email: nothing has arrived that needs them today, and the next upload from
 * that client will email them anyway.
 */
export async function announceReassignments(
  moves: Move[],
  actor: { firmId: string; kind: 'provider'; id: string; name: string }
): Promise<void> {
  if (moves.length === 0) return;
  const ids = [...new Set(moves.flatMap((m) => [m.fromId, m.toId]).filter((id): id is string => id !== null))];
  const names = new Map(
    ids.length === 0
      ? []
      : (await db.select({ id: schema.providers.id, name: schema.providers.name }).from(schema.providers).where(inArray(schema.providers.id, ids))).map(
          (p) => [p.id, p.name] as const
        )
  );

  for (const move of moves) {
    await recordActivity({
      firmId: actor.firmId,
      clientId: move.clientId,
      type: 'update',
      description: reassignmentLine(move, names),
      actorKind: actor.kind,
      actorId: actor.id,
      actorName: actor.name,
      targetId: move.clientId,
    });
  }

  const byRecipient = new Map<string, Move[]>();
  for (const move of moves) {
    // Nobody needs telling that they gave a client to themselves.
    if (move.toId && move.toId !== actor.id) byRecipient.set(move.toId, [...(byRecipient.get(move.toId) ?? []), move]);
  }
  for (const [userId, theirs] of byRecipient) {
    await notify(
      {
        userKind: 'provider',
        userId,
        type: 'client.assigned',
        title:
          theirs.length === 1
            ? `${actor.name} gave you ${theirs[0].clientName}`
            : `${actor.name} gave you ${theirs.length} clients`,
        link: theirs.length === 1 ? `/clients/${theirs[0].clientId}` : '/clients',
      },
      { email: false }
    );
  }
}
