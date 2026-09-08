/**
 * The files answering a checklist line (H5).
 *
 * Before this, a request held exactly one document and a second upload became
 * version 2 of it — so a client with six receipts had to combine them into one
 * PDF, or the advisor had to make six checklist items. Now a request holds any
 * number of documents, each with its own version history, and "replace" is an
 * explicit act naming which one (`X-Replace-Document`) rather than the accident
 * of uploading twice.
 *
 * There is no schema change behind that: `documents.request_id` has always been
 * a plain index rather than a unique one, and the older one-document chains are
 * simply requests that happen to hold a single attachment. Nothing was migrated
 * and nothing reads differently for them.
 *
 * Everything that shows or decides a request loads its attachments through
 * here, so "what is filed against this line" has one definition: a
 * `client_upload` document, not archived, **that has at least one version**,
 * oldest first.
 *
 * That last clause is not pedantry. The legacy importer created a document row
 * beside the request it belonged to before any bytes existed, and those rows
 * are still on the file. Counting one as an attachment would put a file on the
 * screen that nobody can open — and, worse, `decidableVersions` would refuse
 * every decision about the request forever, because that attachment has no
 * current version to name. A document nothing was ever uploaded to is not an
 * answer to anything.
 */
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { toAttachment, type RequestAttachment } from '../routes/serialize.js';
import type { Tx } from './publish.js';
import type { Document } from '../db/schema.js';

/** Either handle reads the same way; a decision passes its transaction. */
type Reader = Tx | typeof db;

/**
 * What counts as an attachment, in one place so the readers cannot drift.
 * `hasAVersion` is an EXISTS rather than a join so a document with six versions
 * still yields one row.
 */
const hasAVersion: SQL = sql`EXISTS (
  SELECT 1 FROM ${schema.documentVersions}
  WHERE ${schema.documentVersions.documentId} = ${schema.documents.id}
)`;

/**
 * The documents filed against one request, oldest first.
 *
 * The order is the order they arrived and never changes, which is what lets a
 * reviewer page through "2 of 6" and mean the same thing on a refresh.
 */
export async function documentsForRequest(requestId: string, reader: Reader = db): Promise<Document[]> {
  return reader
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.requestId, requestId),
        eq(schema.documents.kind, 'client_upload'),
        isNull(schema.documents.archivedAt),
        hasAVersion
      )
    )
    .orderBy(asc(schema.documents.createdAt), asc(schema.documents.id));
}

/**
 * Attachments for many requests in two queries, not two per request.
 *
 * The engagement tree renders a whole checklist at once, so an N+1 here would
 * be felt on the screen a tax season is spent in.
 */
export async function attachmentsByRequest(
  requestIds: string[],
  reader: Reader = db
): Promise<Map<string, RequestAttachment[]>> {
  const byRequest = new Map<string, RequestAttachment[]>();
  if (requestIds.length === 0) return byRequest;

  const documents = await reader
    .select()
    .from(schema.documents)
    .where(
      and(
        inArray(schema.documents.requestId, requestIds),
        eq(schema.documents.kind, 'client_upload'),
        isNull(schema.documents.archivedAt),
        hasAVersion
      )
    )
    .orderBy(asc(schema.documents.createdAt), asc(schema.documents.id));
  if (documents.length === 0) return byRequest;

  const versionIds = documents.map((d) => d.currentVersionId).filter((id): id is string => id !== null);
  const versions = versionIds.length
    ? await reader.select().from(schema.documentVersions).where(inArray(schema.documentVersions.id, versionIds))
    : [];
  const versionById = new Map(versions.map((v) => [v.id, v]));

  for (const doc of documents) {
    if (!doc.requestId) continue;
    const list = byRequest.get(doc.requestId) ?? [];
    list.push(toAttachment(doc, doc.currentVersionId ? versionById.get(doc.currentVersionId) : undefined));
    byRequest.set(doc.requestId, list);
  }
  return byRequest;
}

/** The attachments of a single request — the one-request form of the above. */
export async function attachmentsForRequest(requestId: string, reader: Reader = db): Promise<RequestAttachment[]> {
  return (await attachmentsByRequest([requestId], reader)).get(requestId) ?? [];
}
