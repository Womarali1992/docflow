/**
 * A checklist line's status, and the only module that moves it.
 *
 *   requested ──upload──▶ submitted ──accept──────────▶ accepted
 *       ▲                     │                            │
 *       │                     └──request-correction──▶ needs_correction
 *       │                                                  │
 *       └──────────── reopen ◀── waived ◀──waive──── (any) ─┘
 *                                                     (upload again → submitted)
 *
 * Before the 2026-11-11 audit the status column had six writers in three files,
 * and each rule about it ("a file leaving its line settles the line", "a closed
 * engagement takes no decision") had to be repeated at every one of them, and
 * was not. Every move is here now, each taking the caller's transaction so the
 * move and whatever caused it are one fact. A test in `hardening.test.ts` fails
 * when any other file under `src/` writes the column.
 *
 * Creating a line is not a move: it starts at the column's default,
 * `requested`, wherever it is inserted.
 */
import { desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { Document, Request as RequestRow } from '../db/schema.js';
import { attachmentsForRequest, documentsForRequest } from './attachments.js';
import type { Tx } from './publish.js';

type Writer = Tx | typeof db;

/**
 * Accept or request-correction: the advisor's ruling on what is on the line.
 *
 * Refused (false, nothing written) when no file is left on the line to rule
 * on. Before the 2026-11-11 audit (finding 7) a line whose only file had been
 * archived still said `submitted`, and accepting it answered 200 and marked it
 * accepted with no review behind it.
 */
export async function decideLine(
  tx: Writer,
  requestId: string,
  status: 'accepted' | 'needs_correction',
  now: Date
): Promise<boolean> {
  if ((await documentsForRequest(requestId, tx)).length === 0) return false;
  await tx.update(schema.requests).set({ status, updatedAt: now }).where(eq(schema.requests.id, requestId));
  return true;
}

/** Waive, with the reason that stays on the file and who gave it. */
export async function waiveLine(
  tx: Writer,
  requestId: string,
  waiver: { reason: string; byId: string },
  now: Date
): Promise<RequestRow> {
  const [updated] = await tx
    .update(schema.requests)
    .set({ status: 'waived', waivedReason: waiver.reason, waivedAt: now, waivedById: waiver.byId, updatedAt: now })
    .where(eq(schema.requests.id, requestId))
    .returning();
  return updated;
}

/** Puts a decided line back in play: `submitted` if an answer is on file, `requested` if not. */
export async function reopenLine(tx: Writer, requestId: string, now: Date): Promise<RequestRow> {
  const documents = await documentsForRequest(requestId, tx);
  const [updated] = await tx
    .update(schema.requests)
    .set({
      status: documents.some((d) => d.currentVersionId) ? 'submitted' : 'requested',
      waivedReason: null,
      waivedAt: null,
      waivedById: null,
      updatedAt: now,
    })
    .where(eq(schema.requests.id, requestId))
    .returning();
  return updated;
}

/**
 * A new answer means the advisor has to look again, whatever they decided last
 * time — and whichever path the answer arrived by. The old review row is left
 * exactly as it was: reviews are history, not current state.
 *
 * A waived line stays waived: the advisor closed it deliberately, and a late
 * upload is not an argument.
 *
 * Answers whether the line had been accepted, which is what the caller tells
 * the advisor ("reopened an accepted item").
 */
export async function resetLine(tx: Tx, requestId: string | null, now: Date): Promise<boolean> {
  if (!requestId) return false;
  const [request] = await tx.select().from(schema.requests).where(eq(schema.requests.id, requestId));
  if (!request || request.status === 'waived') return false;

  await tx
    .update(schema.requests)
    .set({
      status: 'submitted',
      // A fresh submission also clears a stale "I don't have this".
      clientResponseKind: null,
      clientResponseNote: null,
      clientResponseAt: null,
      updatedAt: now,
    })
    .where(eq(schema.requests.id, request.id));

  return request.status === 'accepted';
}

/**
 * The line's status once a file has left it: withdrawn by the client, archived
 * or deleted by the advisor, or condemned by a re-scan. No files left: back to
 * `requested`. Every file left already ruled on: back to that ruling, so a
 * stray upload on an accepted line, withdrawn, leaves it accepted. Anything
 * else is still waiting for the advisor, as it was.
 *
 * A file the scanner refused is not left on the line. It is still shown, so
 * the client is told to send it again, but there is nothing in it to review.
 */
export async function settleLine(tx: Tx, requestId: string, now: Date): Promise<void> {
  const [request] = await tx.select().from(schema.requests).where(eq(schema.requests.id, requestId)).for('update');
  if (!request || (request.status !== 'submitted' && request.status !== 'in_review')) return;

  const remaining = (await attachmentsForRequest(requestId, tx)).filter((a) => a.state !== 'refused');
  let status: 'requested' | 'accepted' | 'needs_correction' | null = null;
  if (remaining.length === 0) {
    status = 'requested';
  } else if (remaining.every((a) => a.decided)) {
    const versionIds = remaining.map((a) => a.currentVersion!.id);
    const [latest] = await tx
      .select({ decision: schema.reviews.decision })
      .from(schema.reviews)
      .where(inArray(schema.reviews.versionId, versionIds))
      .orderBy(desc(schema.reviews.createdAt))
      .limit(1);
    if (latest) status = latest.decision;
  }
  if (status) await tx.update(schema.requests).set({ status, updatedAt: now }).where(eq(schema.requests.id, requestId));
}

/**
 * A file brought back from the archive: the reverse of `settleLine`.
 *
 * A file nobody has ruled on puts its line back in front of the advisor,
 * whether the line had emptied (`requested`) or settled on the ruling of the
 * files that stayed. A file already ruled on changes nothing, unless the line
 * had emptied: then the line takes that ruling back. A waived line stays
 * waived, and a line already waiting for the advisor stays as it is.
 */
export async function reviveLine(tx: Tx, document: Document, now: Date): Promise<void> {
  if (!document.requestId || document.kind !== 'client_upload' || !document.currentVersionId) return;
  const [line] = await tx.select().from(schema.requests).where(eq(schema.requests.id, document.requestId)).for('update');
  if (!line || line.status === 'waived' || line.status === 'submitted' || line.status === 'in_review') return;

  const [ruling] = await tx
    .select({ decision: schema.reviews.decision })
    .from(schema.reviews)
    .where(eq(schema.reviews.versionId, document.currentVersionId))
    .orderBy(desc(schema.reviews.createdAt))
    .limit(1);
  const status = !ruling ? 'submitted' : line.status === 'requested' ? ruling.decision : null;
  if (status) await tx.update(schema.requests).set({ status, updatedAt: now }).where(eq(schema.requests.id, line.id));
}
