/**
 * Public shapes (invariant 6: serializers only — never `res.json(row)`).
 *
 * The rule these functions exist to enforce: where a file physically lives and
 * what it hashes to are server-side facts. `storageKey`, `sha256` and the legacy
 * `storagePath` never appear in a response, so a leaked API payload cannot be
 * turned into a path on the firm's disk.
 */
import type { Document, DocumentVersion, Engagement, Request as RequestRow, RequestTemplate, Review } from '../db/schema.js';

/** A request is overdue when it is still outstanding and its deadline has passed. Never stored. */
export function isOverdue(row: Pick<RequestRow, 'status' | 'dueDate'>, now = new Date()): boolean {
  if (row.status !== 'requested' && row.status !== 'needs_correction') return false;
  return row.dueDate !== null && row.dueDate.getTime() < now.getTime();
}

export function serializeEngagement(e: Engagement) {
  return {
    id: e.id,
    clientId: e.clientId,
    providerId: e.providerId,
    title: e.title,
    kind: e.kind,
    taxYear: e.taxYear,
    status: e.status,
    closedAt: e.closedAt,
    archivedAt: e.archivedAt,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export function serializeRequest(r: RequestRow, now = new Date()) {
  return {
    id: r.id,
    engagementId: r.engagementId,
    clientId: r.clientId,
    providerId: r.providerId,
    title: r.title,
    instructions: r.instructions,
    category: r.category,
    required: r.required,
    dueDate: r.dueDate,
    status: r.status,
    sortOrder: r.sortOrder,
    overdue: isOverdue(r, now),
    waivedReason: r.waivedReason,
    waivedAt: r.waivedAt,
    clientResponseKind: r.clientResponseKind,
    clientResponseNote: r.clientResponseNote,
    clientResponseAt: r.clientResponseAt,
    archivedAt: r.archivedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * A version, minus the two fields that must not travel: `storageKey` (where the
 * bytes are) and `sha256` (which would let a caller confirm content it cannot read).
 */
export function serializeVersion(v: DocumentVersion) {
  return {
    id: v.id,
    documentId: v.documentId,
    versionNo: v.versionNo,
    originalFilename: v.originalFilename,
    mimeType: v.mimeType,
    sizeBytes: v.sizeBytes,
    scanStatus: v.scanStatus,
    scannedAt: v.scannedAt,
    uploadedByKind: v.uploadedByKind,
    uploadedById: v.uploadedById,
    publishedAt: v.publishedAt,
    supersededAt: v.supersededAt,
    createdAt: v.createdAt,
    /* Only a clean, published version can actually be fetched (C2.4). */
    available: v.scanStatus === 'clean' && v.publishedAt !== null,
  };
}

export function serializeReview(r: Review) {
  return {
    id: r.id,
    documentId: r.documentId,
    versionId: r.versionId,
    requestId: r.requestId,
    reviewerId: r.reviewerId,
    decision: r.decision,
    note: r.note,
    createdAt: r.createdAt,
  };
}

/**
 * The document shape.
 *
 * Field-by-field rather than a spread, now that there is nothing to strip: the
 * legacy columns this used to carry went with C5.4, and `storagePath` — the one
 * the spread existed to remove — went with them. Listing the fields is what
 * keeps invariant 6 true by construction, so a column added to the table later
 * cannot reach the browser just because nobody thought about it here.
 */
export function serializeDocument(doc: Document) {
  return {
    id: doc.id,
    clientId: doc.clientId,
    providerId: doc.providerId,
    name: doc.name,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    uploadedByKind: doc.uploadedByKind,
    uploadedById: doc.uploadedById,
    uploadedAt: doc.uploadedAt,
    engagementId: doc.engagementId,
    requestId: doc.requestId,
    kind: doc.kind,
    displayName: doc.displayName,
    category: doc.category,
    currentVersionId: doc.currentVersionId,
    sharedAt: doc.sharedAt,
    sharedById: doc.sharedById,
    archivedAt: doc.archivedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    /* True once bytes exist to fetch; where they sit is a server-side fact. */
    hasFile: doc.currentVersionId !== null,
    /* Convenience for the client portal: a deliverable is only visible once shared. */
    shared: doc.sharedAt !== null,
  };
}

export function serializeTemplate(t: RequestTemplate) {
  return {
    id: t.id,
    providerId: t.providerId,
    name: t.name,
    kind: t.kind,
    items: t.items,
    archivedAt: t.archivedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}
