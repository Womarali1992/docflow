/**
 * An advisor's decision about what a client sent: accept it, or ask for
 * another copy. There is one path for it, whatever is being decided.
 *
 * Before the 2026-11-11 audit a decision was written twice. The checklist
 * route wrote the reviews, moved the line, posted the note to the thread,
 * audited, notified and logged it. The document route, used for a file sent
 * outside the checklist, wrote the review and the audit row and stopped there,
 * so a correction on that file never reached the client (finding 1). It also
 * decided a checklist file without moving its line (smaller thing 5).
 *
 * Now both routes call `recordDecision`, which is one transaction, and then
 * `announceDecision`, which tells the client and writes the activity line. A
 * file that belongs to a checklist line is always decided through that line.
 */
import type { Request as ExpressRequest } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { auditRequest } from '../db/audit.js';
import { recordActivity } from '../db/activity-log.js';
import type { AuthPayload } from '../middleware/auth.js';
import { notify } from '../notify.js';
import type { Document, Request as RequestRow } from '../db/schema.js';
import { documentsForRequest } from './attachments.js';
import { decideLine } from './line-status.js';
import { decidableVersion, decidableVersions, type DecisionRefusal, type Tx } from './publish.js';

export type Decision = 'accepted' | 'needs_correction';

/** What is being decided: a checklist line (all its files at once), or one file sent outside the checklist. */
export type DecisionSubject = { kind: 'line'; request: RequestRow } | { kind: 'document'; document: Document };

export interface DecisionInput {
  subject: DecisionSubject;
  decision: Decision;
  /**
   * The versions the advisor was reading. A line names every attachment's
   * current version (H5); a lone document names its one.
   */
  namedVersionIds: string[];
  note: string | null;
}

export type DecisionResult = { ok: true; versionIds: string[]; now: Date } | DecisionRefusal;

/**
 * The version ids a decision is about.
 *
 * `versionIds` is the H5 form, because a request holds several attachments and
 * a decision is about all of them. `versionId` is still accepted as the
 * one-element spelling, so a client that has not been reloaded keeps working
 * against a request with one attachment.
 */
export function namedVersions(body: { versionId?: string; versionIds?: string[] }): string[] {
  if (body.versionIds?.length) return body.versionIds;
  return body.versionId ? [body.versionId] : [];
}

function nothingSubmitted(decision: Decision): DecisionRefusal {
  return {
    ok: false,
    status: 400,
    code: 'nothing_submitted',
    error:
      decision === 'accepted'
        ? 'There is nothing to accept yet — no document has been submitted.'
        : 'There is nothing to correct yet — no document has been submitted.',
  };
}

const auditAction = (decision: Decision) => (decision === 'accepted' ? 'request.accepted' : 'request.correction_requested');

/**
 * The decision as one transaction: check that it names the versions the
 * advisor was actually reading, write a review per file, move the line if
 * there is one, post a correction's note to the file's thread, and audit it,
 * all with the documents locked, all or nothing.
 *
 * Before H2 this was three unlocked steps, so an advisor deciding about v1
 * while v2 landed got a 200 and a review row pointing at a file nobody had
 * looked at. `decidableVersion(s)` is the guard; a 409 `stale_version` is what
 * the review workspace turns into "Refresh and read that one".
 */
export async function recordDecision(req: ExpressRequest, input: DecisionInput): Promise<DecisionResult> {
  if (input.subject.kind === 'line') {
    const { status } = input.subject.request;
    if (status === 'requested' || status === 'waived') return nothingSubmitted(input.decision);
  }

  const auth = req.auth!;
  const now = new Date();
  return db.transaction(async (tx): Promise<DecisionResult> =>
    input.subject.kind === 'line'
      ? decideOnLine(tx, req, auth, input.subject.request, input, now)
      : decideOnDocument(tx, req, auth, input.subject.document, input, now)
  );
}

/**
 * H5: six receipts on one line are six attachments, and accepting the line
 * accepts all six. So there are six review rows, each naming its own document
 * and version, and one status change. A file arriving on any of them while the
 * advisor read is the same 409 as a replacement of the one they were looking
 * at: the set they decided is no longer the set on file.
 */
async function decideOnLine(
  tx: Tx,
  req: ExpressRequest,
  auth: AuthPayload,
  request: RequestRow,
  input: DecisionInput,
  now: Date
): Promise<DecisionResult> {
  const documents = await documentsForRequest(request.id, tx);
  const decidable = await decidableVersions(
    tx,
    documents.map((d) => d.id),
    input.namedVersionIds
  );
  if (!decidable.ok) return decidable;

  /* Nothing has been written yet, so a refusal here leaves nothing behind.
     A line whose files have all left it is not accepted with no review behind
     it (finding 7). */
  if (!(await decideLine(tx, request.id, input.decision, now))) return nothingSubmitted(input.decision);

  for (const decision of decidable.decisions) {
    await tx.insert(schema.reviews).values({
      documentId: decision.documentId,
      versionId: decision.versionId,
      requestId: request.id,
      reviewerId: auth.sub,
      decision: input.decision,
      note: input.note,
      createdAt: now,
    });
  }
  const versionIds = decidable.decisions.map((d) => d.versionId);

  if (input.decision === 'needs_correction' && input.note) {
    await postCorrection(tx, auth, {
      clientId: request.clientId,
      firmId: request.firmId,
      documentId: decidable.decisions[0]?.documentId ?? null,
      about: request.title,
      note: input.note,
      now,
    });
  }

  // The decision and the record of it are one fact (F10): inside the
  // transaction, so a failed audit rolls the decision back rather than
  // leaving a change nobody can account for.
  await auditRequest(
    req,
    {
      action: auditAction(input.decision),
      targetType: 'request',
      targetId: request.id,
      clientId: request.clientId,
      // `versionId` stays for the single-attachment case, which is what every
      // audit line written before H5 looks like.
      meta: { versionId: versionIds[0] ?? null, versionIds },
    },
    tx
  );

  return { ok: true, versionIds, now };
}

/** A file sent outside the checklist: the same rule (invariant 19), on its one version. */
async function decideOnDocument(
  tx: Tx,
  req: ExpressRequest,
  auth: AuthPayload,
  document: Document,
  input: DecisionInput,
  now: Date
): Promise<DecisionResult> {
  const decidable = await decidableVersion(tx, document.id, input.namedVersionIds[0] ?? null);
  if (!decidable.ok) return decidable;

  await tx.insert(schema.reviews).values({
    documentId: document.id,
    versionId: decidable.versionId,
    // Null for a file sent outside the checklist; an imported or archived file
    // keeps the line it was filed under.
    requestId: document.requestId,
    reviewerId: auth.sub,
    decision: input.decision,
    note: input.note,
    createdAt: now,
  });
  await tx.update(schema.documents).set({ updatedAt: now }).where(eq(schema.documents.id, document.id));

  if (input.decision === 'needs_correction' && input.note) {
    await postCorrection(tx, auth, {
      clientId: document.clientId,
      firmId: document.firmId,
      documentId: document.id,
      about: document.displayName ?? document.name,
      note: input.note,
      now,
    });
  }

  await auditRequest(
    req,
    {
      action: auditAction(input.decision),
      targetType: 'document',
      targetId: document.id,
      clientId: document.clientId,
      meta: { versionId: decidable.versionId },
    },
    tx
  );

  return { ok: true, versionIds: [decidable.versionId], now };
}

/**
 * A correction is a question to the client, so it goes where questions go:
 * the file's own thread, in the advisor's words, where the client can answer
 * it. Before the 2026-10-28 audit the portal promised the note was "in the
 * messages for this item" and it was only ever on the review rows.
 */
async function postCorrection(
  tx: Tx,
  auth: AuthPayload,
  input: { clientId: string; firmId: string; documentId: string | null; about: string; note: string; now: Date }
): Promise<void> {
  await tx.insert(schema.messages).values({
    clientId: input.clientId,
    firmId: input.firmId,
    documentId: input.documentId,
    senderKind: 'provider',
    senderId: auth.sub,
    senderName: auth.name,
    content: `Re: ${input.about}\n\n${input.note}`,
    createdAt: input.now,
  });
}

/**
 * Tells the client, and writes the activity line. After the transaction, as
 * every notification is: a notice about a decision that rolled back would be
 * a lie.
 */
export async function announceDecision(auth: AuthPayload, subject: DecisionSubject, decision: Decision): Promise<void> {
  const owner =
    subject.kind === 'line'
      ? { clientId: subject.request.clientId, firmId: subject.request.firmId, targetId: subject.request.id }
      : { clientId: subject.document.clientId, firmId: subject.document.firmId, targetId: subject.document.id };
  const about = subject.kind === 'line' ? subject.request.title : subject.document.displayName ?? subject.document.name;

  if (decision === 'accepted') {
    await notify({
      userKind: 'client',
      userId: owner.clientId,
      type: 'request.accepted',
      title: `Accepted: ${about}`,
      body: 'Nothing more to do for this one.',
      link: subject.kind === 'line' ? '/portal/requests' : '/portal/documents',
    });
  } else {
    await notify({
      userKind: 'client',
      userId: owner.clientId,
      type: 'request.correction',
      title: `Another look needed: ${about}`,
      body: 'Your accountant has left a note about what to send instead.',
      link: subject.kind === 'line' ? '/portal' : '/portal/documents',
    });
  }

  await recordActivity({
    firmId: owner.firmId,
    clientId: owner.clientId,
    type: 'update',
    description: `${decision === 'accepted' ? 'accepted' : 'asked for a correction'}: ${about}`,
    actorKind: 'provider',
    actorId: auth.sub,
    actorName: auth.name,
    targetId: owner.targetId,
  });
}

/** The ruling on a file as it stands: the newest review of its current version. */
export interface LatestDecision {
  decision: Decision;
  note: string | null;
  decidedAt: Date;
}

/**
 * The newest decision about each document's *current* version. A decision
 * about an older version is history: once the client has sent another copy,
 * "Another copy needed" is no longer true.
 */
export async function latestDecisions(
  documents: Pick<Document, 'id' | 'currentVersionId'>[],
  reader: Tx | typeof db = db
): Promise<Map<string, LatestDecision>> {
  const current = documents.filter((d) => d.currentVersionId !== null);
  if (current.length === 0) return new Map();

  const rows = await reader
    .select({
      documentId: schema.reviews.documentId,
      decision: schema.reviews.decision,
      note: schema.reviews.note,
      createdAt: schema.reviews.createdAt,
    })
    .from(schema.reviews)
    .where(
      and(
        inArray(
          schema.reviews.documentId,
          current.map((d) => d.id)
        ),
        inArray(
          schema.reviews.versionId,
          current.map((d) => d.currentVersionId!)
        )
      )
    )
    .orderBy(desc(schema.reviews.createdAt));

  const latest = new Map<string, LatestDecision>();
  for (const row of rows) {
    if (!row.documentId || latest.has(row.documentId)) continue;
    latest.set(row.documentId, { decision: row.decision, note: row.note, decidedAt: row.createdAt });
  }
  return latest;
}
