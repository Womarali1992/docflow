/**
 * What the advisor asked for when they sent a line back.
 *
 * The note lives on the review rows (one per attachment, all carrying the same
 * words), and until the 2026-10-28 audit nothing ever read it back out: the
 * portal told the client "their note is in the messages for this item" and no
 * such message existed. The note now travels on the request itself, so the card
 * the client is looking at says what to fix, and the decision also posts it to
 * the item's thread (`routes/requests.ts`) so there is somewhere to reply.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { Tx } from './publish.js';

type Reader = Tx | typeof db;

export interface RequestCorrection {
  note: string;
  createdAt: Date;
}

/** The most recent correction note per request, for many requests in one query. */
export async function correctionsByRequest(
  requestIds: string[],
  reader: Reader = db
): Promise<Map<string, RequestCorrection>> {
  const byRequest = new Map<string, RequestCorrection>();
  if (requestIds.length === 0) return byRequest;

  const rows = await reader
    .select({ requestId: schema.reviews.requestId, note: schema.reviews.note, createdAt: schema.reviews.createdAt })
    .from(schema.reviews)
    .where(and(inArray(schema.reviews.requestId, requestIds), eq(schema.reviews.decision, 'needs_correction')))
    .orderBy(desc(schema.reviews.createdAt));

  for (const row of rows) {
    if (!row.requestId || !row.note || byRequest.has(row.requestId)) continue;
    byRequest.set(row.requestId, { note: row.note, createdAt: row.createdAt });
  }
  return byRequest;
}
