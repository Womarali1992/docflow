import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';

/**
 * The canonical form of an email address.
 *
 * `clients.email` keeps the address as the person typed it — that is what an
 * advisor recognises in a list and what invitations are addressed to. Identity
 * questions ("is this the same client?", "how many attempts from this address?")
 * are asked of the canonical form instead, so `Sarah@Example.COM ` and
 * `sarah@example.com` cannot become two clients or two rate-limit buckets.
 *
 * Deliberately conservative: case and surrounding whitespace only. Provider
 * tricks like stripping dots or `+tags` would make two addresses the firm
 * considers different collide, and `clients_firm_email_normalized_key` turns a
 * collision into a refused create.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Every advisor whose address is this one, whatever case either was typed in. */
async function providersWithEmail(email: string) {
  return db.select().from(schema.providers).where(sql`lower(trim(${schema.providers.email})) = ${normalizeEmail(email)}`);
}

/**
 * The advisor who signs in with this address. Advisor addresses are unique
 * only as written, so two could differ by case alone; then the one written
 * exactly as typed is the answer, and without one nobody is.
 */
export async function findProviderByEmail(email: string) {
  const rows = await providersWithEmail(email);
  return rows.length === 1 ? rows[0] : rows.find((p) => p.email === email);
}

/** Whether a new advisor account would collide with an existing one. */
export async function providerEmailIsTaken(email: string): Promise<boolean> {
  return (await providersWithEmail(email)).length > 0;
}

/**
 * The most client accounts one address is looked up across. Sign-in checks the
 * password against each, and every check is a bcrypt, so the work one request
 * can cause is bounded; nobody is a client of this many firms on one install.
 */
export const MAX_CLIENT_ACCOUNTS = 10;

/**
 * Every client account at this address, oldest first: at most one per firm
 * since F7 (`clients_firm_email_normalized_key`), so the same person can be a
 * client of two firms. `firmId` narrows it to that firm's account.
 */
export async function findClientsByEmail(email: string, firmId?: string) {
  return db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.emailNormalized, normalizeEmail(email)), firmId ? eq(schema.clients.firmId, firmId) : undefined))
    .orderBy(asc(schema.clients.createdAt), asc(schema.clients.id))
    .limit(MAX_CLIENT_ACCOUNTS);
}
