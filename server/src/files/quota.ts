/**
 * How much of the volume one client may fill.
 *
 * The disk that holds the documents also holds the database and the backups, in
 * that order of consequence: it fills, uploads stop, then the nightly dump
 * stops, then Postgres stops. Nothing in the pilot stood between one client's
 * phone camera roll and that, and the per-file 25 MB limit does not help when
 * the same person sends two hundred files.
 *
 * So: a per-client ceiling, checked twice — once from `Content-Length` before a
 * single byte is staged, and once from the real size afterwards, because
 * `Content-Length` is the client's claim about a multipart body and not a
 * measurement. Quarantined versions do not count: their bytes were deleted.
 *
 * Advisors are exempt. They are the ones who would have to clear the space, and
 * a firm locked out of filing its own deliverables by its own quota is a worse
 * failure than a full disk.
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';

/** 2 GiB, which is a lot of tax documents and not much of a disk. */
export const DEFAULT_MAX_CLIENT_STORAGE_BYTES = 2 * 1024 * 1024 * 1024;

export function maxClientStorageBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.MAX_CLIENT_STORAGE_BYTES || '').trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_CLIENT_STORAGE_BYTES;
}

/** Bytes this client's documents currently occupy, quarantined versions aside. */
export async function clientStorageBytes(clientId: string): Promise<number> {
  const [row] = await db
    .select({ bytes: sql<string>`COALESCE(SUM(${schema.documentVersions.sizeBytes}), 0)` })
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(and(eq(schema.documents.clientId, clientId), ne(schema.documentVersions.scanStatus, 'infected')));
  return Number(row?.bytes ?? 0);
}

export interface QuotaRefusal {
  status: 413;
  code: 'quota_exceeded';
  error: string;
}

const gib = (n: number) => `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;

/**
 * Whether `incomingBytes` more would put this client over. Returns the refusal
 * to send, or null to carry on.
 *
 * The message names the limit and what is already stored, because "quota
 * exceeded" tells the person holding the file nothing they can act on.
 */
export async function quotaRefusal(clientId: string, incomingBytes: number): Promise<QuotaRefusal | null> {
  const limit = maxClientStorageBytes();
  const used = await clientStorageBytes(clientId);
  if (used + Math.max(0, incomingBytes) <= limit) return null;

  return {
    status: 413,
    code: 'quota_exceeded',
    error:
      `This would go over the ${gib(limit)} of storage for your documents (${gib(used)} is already stored). ` +
      'Ask your accountant to archive what has been dealt with, and try again.',
  };
}

/** At what share of the ceiling a client counts as "close to it". */
export const NEAR_QUOTA_RATIO = 0.8;

/**
 * How many clients are within reach of their ceiling (H7).
 *
 * A count, never who: this feeds the daily digest, which goes to an inbox. The
 * useful moment is before the first refusal, not after — a client whose upload
 * is rejected mid-tax-season phones the firm, and by then the fix (archive what
 * has been dealt with) takes longer than the call.
 *
 * `providerId` scopes it to one advisor's clients; the digest asks about the
 * whole box and passes none.
 */
export async function clientsNearQuota(providerId: string | null = null, ratio = NEAR_QUOTA_RATIO): Promise<number> {
  /* Whole bytes: the SUM is a bigint, and Postgres refuses to compare it with
     the fraction 0.8 of a quota produces. */
  const threshold = Math.floor(maxClientStorageBytes() * ratio);
  const rows = await db
    .select({ clientId: schema.documents.clientId })
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(
      providerId
        ? and(eq(schema.documents.providerId, providerId), ne(schema.documentVersions.scanStatus, 'infected'))
        : ne(schema.documentVersions.scanStatus, 'infected')
    )
    .groupBy(schema.documents.clientId)
    .having(sql`COALESCE(SUM(${schema.documentVersions.sizeBytes}), 0) >= ${threshold}`);
  return rows.length;
}

/** The clients using the most space, for the ops panel. Ids and bytes only. */
export async function topClientsByStorage(providerId: string, limit = 3) {
  const rows = await db
    .select({
      clientId: schema.documents.clientId,
      bytes: sql<string>`COALESCE(SUM(${schema.documentVersions.sizeBytes}), 0)`,
    })
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(and(eq(schema.documents.providerId, providerId), ne(schema.documentVersions.scanStatus, 'infected')))
    .groupBy(schema.documents.clientId)
    .orderBy(sql`SUM(${schema.documentVersions.sizeBytes}) DESC`)
    .limit(limit);

  const max = maxClientStorageBytes();
  return rows.map((r) => ({
    clientId: r.clientId,
    bytes: Number(r.bytes),
    percentOfQuota: max > 0 ? Math.round((Number(r.bytes) / max) * 100) : 0,
  }));
}
