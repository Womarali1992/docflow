/**
 * The one place allowed to move a document's publication state.
 *
 * Three columns decide what a reader sees: `document_versions.published_at`,
 * `document_versions.superseded_at` and `documents.current_version_id`. Before
 * H2 two code paths wrote them — the upload pipeline and the scan-retry job —
 * and they disagreed. The retry repointed `currentVersionId` at whatever it had
 * just scanned, with no comparison, so a slow scan of version 6 could undo the
 * already-published version 7 and the advisor's screen silently went back in
 * time (audit F4). The upload path allocated `MAX(version_no) + 1` while holding
 * no lock, so two concurrent uploads computed the same number and one of them
 * became a 500 for a client whose file was fine (F3).
 *
 * So: **one publication path under a lock** (invariants 16–18).
 *
 *   - `lockDocument` / `lockRequest` — `SELECT … FOR UPDATE`, taken *first*, in
 *     that order, by everything that publishes or decides. Consistent lock order
 *     is what keeps two paths from deadlocking against each other.
 *   - `allocateVersionNo` — `MAX + 1`, only ever called with the lock held.
 *   - `publishVersion` — the only writer of the three columns, and the only
 *     place that knows the pointer must never move backwards.
 *   - `quarantineVersion` — the same, for a version that turned out infected.
 *   - `decidableVersion` — the read half of the same rule: a review decision
 *     names the version it is about, and that version has to be the current,
 *     clean, published one (invariant 19).
 *
 * A test in `hardening.test.ts` greps the tree and fails if any other file
 * writes those three columns.
 */
import { and, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { Document, DocumentVersion, Request, ScanStatus } from '../db/schema.js';

/** A drizzle transaction handle, as `db.transaction(async (tx) => …)` hands it out. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Why a version is being published — carried into logs so a late arrival is legible. */
export type PublishReason = 'upload' | 'scan_retry';

export interface PublishOutcome {
  /** The version row as it stands after publication. */
  version: DocumentVersion;
  /** The document row as it stands after publication. */
  document: Document;
  /** True when this publication moved `currentVersionId`. */
  currentChanged: boolean;
  /** True when moving it sent an already-accepted request back to the advisor. */
  reopened: boolean;
}

/**
 * The document row, locked for the rest of the transaction.
 *
 * Every version insert and every review decision starts here (invariant 17), so
 * the allocations, the pointer move and the request transition all happen with
 * nobody else in the middle of the same document.
 */
export async function lockDocument(tx: Tx, documentId: string): Promise<Document | null> {
  const [row] = await tx.select().from(schema.documents).where(eq(schema.documents.id, documentId)).for('update');
  return row ?? null;
}

/**
 * The request row, locked. Needed for the *first* upload against a request,
 * where there is no document row to lock yet and two concurrent uploads would
 * otherwise both create one.
 */
export async function lockRequest(tx: Tx, requestId: string): Promise<Request | null> {
  const [row] = await tx.select().from(schema.requests).where(eq(schema.requests.id, requestId)).for('update');
  return row ?? null;
}

/**
 * The next version number for a document. Only correct while the document is
 * locked — `MAX + 1` outside the lock is exactly the race F3 reproduced.
 */
export async function allocateVersionNo(tx: Tx, documentId: string): Promise<number> {
  const [{ maxNo }] = await tx
    .select({ maxNo: sql<number>`COALESCE(MAX(${schema.documentVersions.versionNo}), 0)` })
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, documentId));
  return Number(maxNo) + 1;
}

/**
 * Publishes one clean version and settles everything that depends on it.
 *
 * The caller must already have made the version `clean` (in this same
 * transaction, if it has just scanned it). What this does:
 *
 *  1. Locks the document and marks the version published.
 *  2. Works out which version *should* be current: the clean, published,
 *     non-superseded one with the highest `versionNo`.
 *  3. If that is not the version currently pointed at, it becomes current —
 *     everything else is superseded, and the request goes back in front of the
 *     advisor, whatever they decided last time (invariant: a new answer resets
 *     acceptance; a waived line is left closed).
 *  4. If it *is* already current — which is the case when an older version
 *     finishes scanning after a newer one has already been published — the
 *     late arrival is superseded on the spot. The pointer never moves backwards
 *     (invariant 18).
 */
export async function publishVersion(
  tx: Tx,
  input: { versionId: string; now?: Date; reason: PublishReason }
): Promise<PublishOutcome> {
  const now = input.now ?? new Date();

  const [version] = await tx
    .select()
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.id, input.versionId));
  if (!version) throw new Error(`publishVersion: version ${input.versionId} does not exist`);
  if (version.scanStatus !== 'clean') {
    // Publishing something nobody has scanned is the one thing this must never
    // do (invariant 3). A caller that gets here has a bug, not a bad input.
    throw new Error(`publishVersion: version ${version.id} is ${version.scanStatus}, not clean`);
  }

  const document = await lockDocument(tx, version.documentId);
  if (!document) throw new Error(`publishVersion: document ${version.documentId} does not exist`);

  const publishedAt = version.publishedAt ?? now;
  if (version.publishedAt === null) {
    await tx
      .update(schema.documentVersions)
      .set({ publishedAt })
      .where(eq(schema.documentVersions.id, version.id));
  }

  /* Which version should be on screen? The newest readable one. The version we
     have just published counts even if it was superseded earlier — that is how
     a late scan of an old version is compared against the newer one rather than
     quietly winning. */
  const [candidate] = await tx
    .select()
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.documentId, document.id),
        eq(schema.documentVersions.scanStatus, 'clean'),
        or(isNull(schema.documentVersions.supersededAt), eq(schema.documentVersions.id, version.id))
      )
    )
    .orderBy(desc(schema.documentVersions.versionNo))
    .limit(1);

  /* An older version arriving late: recorded, readable in its own right, and
     explicitly out of the way rather than silently newest. */
  if (!candidate || candidate.id !== version.id) {
    const supersededAt = version.supersededAt ?? now;
    const [superseded] = await tx
      .update(schema.documentVersions)
      .set({ supersededAt })
      .where(eq(schema.documentVersions.id, version.id))
      .returning();
    console.log(
      `[publish] version ${version.id} (v${version.versionNo}, ${input.reason}) scanned clean after ` +
        `v${candidate?.versionNo ?? '?'} was already current; superseded on arrival`
    );
    return { version: superseded, document, currentChanged: false, reopened: false };
  }

  if (document.currentVersionId === version.id) {
    // Already the current one — re-publishing changes nothing (a retry of a job
    // that had already succeeded, for instance).
    const [fresh] = await tx.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, version.id));
    return { version: fresh, document, currentChanged: false, reopened: false };
  }

  /* Exactly one live version per document. */
  await tx
    .update(schema.documentVersions)
    .set({ supersededAt: now })
    .where(
      and(
        eq(schema.documentVersions.documentId, document.id),
        isNull(schema.documentVersions.supersededAt),
        ne(schema.documentVersions.id, version.id)
      )
    );
  const [current] = await tx
    .update(schema.documentVersions)
    // Defensive: whatever it was before, the version being served is not superseded.
    .set({ supersededAt: null })
    .where(eq(schema.documentVersions.id, version.id))
    .returning();

  const [updatedDocument] = await tx
    .update(schema.documents)
    .set({ currentVersionId: version.id, updatedAt: now })
    .where(eq(schema.documents.id, document.id))
    .returning();

  const reopened = await resetRequest(tx, updatedDocument.requestId, now);
  return { version: current, document: updatedDocument, currentChanged: true, reopened };
}

/**
 * A new answer means the advisor has to look again, whatever they decided last
 * time — and whichever path the answer arrived by. The old review row is left
 * exactly as it was: reviews are history, not current state.
 *
 * A waived line stays waived: the advisor closed it deliberately, and a late
 * upload is not an argument.
 */
async function resetRequest(tx: Tx, requestId: string | null, now: Date): Promise<boolean> {
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
 * A version the scanner condemned. The row stays as the record — the bytes are
 * the caller's to delete — and nothing points at it any more.
 */
export async function quarantineVersion(
  tx: Tx,
  input: { versionId: string; detail: string | null; now?: Date }
): Promise<{ version: DocumentVersion; document: Document | null; wasCurrent: boolean }> {
  const now = input.now ?? new Date();

  const [existing] = await tx
    .select()
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.id, input.versionId));
  if (!existing) throw new Error(`quarantineVersion: version ${input.versionId} does not exist`);

  const document = await lockDocument(tx, existing.documentId);

  const [version] = await tx
    .update(schema.documentVersions)
    .set({ scanStatus: 'infected', scanDetail: input.detail, scannedAt: now, publishedAt: null })
    .where(eq(schema.documentVersions.id, existing.id))
    .returning();

  const wasCurrent = document?.currentVersionId === version.id;
  if (wasCurrent && document) {
    await tx
      .update(schema.documents)
      .set({ currentVersionId: null, updatedAt: now })
      .where(eq(schema.documents.id, document.id));
  }

  return { version, document, wasCurrent };
}

/* ------------------------------------------------------- deciding on a version */

export interface StaleVersion {
  ok: false;
  status: 409;
  code: 'stale_version';
  error: string;
  currentVersionId: string | null;
  scanStatus: ScanStatus | null;
}

/** Everything a route has to turn into a response when a decision is refused. */
export type DecisionRefusal =
  | { ok: false; status: 400; code: 'version_required'; error: string }
  | StaleVersion;

export type DecidableVersion = { ok: true; document: Document; versionId: string } | DecisionRefusal;

/** The refusal, as JSON. `currentVersionId` is what a Refresh will bring into view. */
export function refusalBody(refusal: DecisionRefusal): Record<string, unknown> {
  return refusal.code === 'stale_version'
    ? { error: refusal.error, code: refusal.code, currentVersionId: refusal.currentVersionId, scanStatus: refusal.scanStatus }
    : { error: refusal.error, code: refusal.code };
}

/**
 * The version a decision is allowed to be about: the current one, clean and
 * published, named explicitly by the caller (invariant 19).
 *
 * Before H2, accept only checked that the version belonged to the request, so
 * an advisor reading v1 while v2 landed accepted a file they never opened — a
 * 200, with no hint that anything had moved (audit F5). Worse, nothing required
 * the named version to have been *scanned*.
 *
 * Locks the document, so the answer cannot go stale between this check and the
 * review row the caller is about to write.
 */
export async function decidableVersion(
  tx: Tx,
  documentId: string,
  namedVersionId: string | null | undefined
): Promise<DecidableVersion> {
  const document = await lockDocument(tx, documentId);
  if (!document) throw new Error(`decidableVersion: document ${documentId} does not exist`);

  const current = document.currentVersionId
    ? (await tx.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, document.currentVersionId)))[0]
    : undefined;

  const stale = (error: string): StaleVersion => ({
    ok: false,
    status: 409,
    code: 'stale_version',
    error,
    currentVersionId: document.currentVersionId,
    scanStatus: current?.scanStatus ?? null,
  });

  if (!current) {
    return stale('There is nothing readable to decide about yet — the newest file is still being checked.');
  }
  if (!namedVersionId) {
    return {
      ok: false,
      status: 400,
      code: 'version_required',
      error: 'A decision has to say which version it is about.',
    };
  }
  if (namedVersionId !== current.id) {
    return stale('A newer file arrived while you were looking. Refresh and read that one before deciding.');
  }
  if (current.scanStatus !== 'clean' || current.publishedAt === null) {
    return stale('That file is still being checked — you can decide once the virus check has passed.');
  }

  return { ok: true, document, versionId: current.id };
}
