/**
 * Tenant scoping for every workflow resource (invariant 4: cross-tenant → 404).
 *
 * Each loader answers "may this caller see this row, and which row is it?" in
 * one place. They return null for *both* "does not exist" and "belongs to
 * someone else", so a 404 never confirms that an id exists in another firm —
 * an advisor probing ids learns nothing, and neither does a client.
 *
 * Visibility rules that live here rather than in each route:
 *   - a client sees only their own rows;
 *   - a client sees a deliverable only once it has been shared;
 *   - an advisor sees only their own firm's rows.
 */
import type { Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { AuthPayload } from '../middleware/auth.js';
import type { Document, DocumentVersion, Engagement, Request as RequestRow, RequestTemplate } from '../db/schema.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const notFound = (res: Response) => res.status(404).json({ error: 'Not found' });
export const advisorOnly = (res: Response) => res.status(403).json({ error: 'Only your advisor can do that.' });
export const clientOnly = (res: Response) => res.status(403).json({ error: 'Only the client can do that.' });

export function badRequest(res: Response, error: string, code?: string) {
  return res.status(400).json(code ? { error, code } : { error });
}

/** Rejects a malformed id before it reaches the database. */
export function isId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export async function findEngagement(auth: AuthPayload, id: string): Promise<Engagement | null> {
  if (!isId(id)) return null;
  const [row] = await db.select().from(schema.engagements).where(eq(schema.engagements.id, id));
  if (!row) return null;
  if (auth.kind === 'provider' && row.providerId !== auth.providerId) return null;
  if (auth.kind === 'client' && row.clientId !== auth.sub) return null;
  return row;
}

export async function findRequest(auth: AuthPayload, id: string): Promise<RequestRow | null> {
  if (!isId(id)) return null;
  const [row] = await db.select().from(schema.requests).where(eq(schema.requests.id, id));
  if (!row) return null;
  if (auth.kind === 'provider' && row.providerId !== auth.providerId) return null;
  if (auth.kind === 'client' && row.clientId !== auth.sub) return null;
  return row;
}

/**
 * A document the caller may see. The extra rule over the others: a deliverable
 * that has not been shared does not exist as far as the client is concerned —
 * an advisor can prepare a return without the client watching it appear.
 */
export async function findDocument(auth: AuthPayload, id: string): Promise<Document | null> {
  if (!isId(id)) return null;
  const [row] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
  if (!row) return null;
  if (auth.kind === 'provider') return row.providerId === auth.providerId ? row : null;
  if (row.clientId !== auth.sub) return null;
  if (row.kind === 'deliverable' && row.sharedAt === null) return null;
  return row;
}

/** A version, via the document that owns it — so the document's rules apply to it too. */
export async function findVersion(
  auth: AuthPayload,
  documentId: string,
  versionId: string
): Promise<{ document: Document; version: DocumentVersion } | null> {
  const document = await findDocument(auth, documentId);
  if (!document || !isId(versionId)) return null;
  const [version] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, versionId));
  if (!version || version.documentId !== document.id) return null;
  return { document, version };
}

export async function findTemplate(auth: AuthPayload, id: string): Promise<RequestTemplate | null> {
  if (!isId(id) || auth.kind !== 'provider') return null;
  const [row] = await db.select().from(schema.requestTemplates).where(eq(schema.requestTemplates.id, id));
  if (!row || row.providerId !== auth.providerId) return null;
  return row;
}

/** The advisor's own client, or null (the caller answers 404). */
export async function findClient(auth: AuthPayload, id: string) {
  if (!isId(id)) return null;
  const [row] = await db.select().from(schema.clients).where(eq(schema.clients.id, id));
  if (!row) return null;
  if (auth.kind === 'provider' && row.providerId !== auth.providerId) return null;
  if (auth.kind === 'client' && row.id !== auth.sub) return null;
  return row;
}
