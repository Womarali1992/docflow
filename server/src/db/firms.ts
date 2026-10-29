import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from './client.js';
import { isMailConfigured } from '../jobs/mail.js';
import type { NewProvider, Provider } from './schema.js';

/**
 * A new advisor account founds a firm of its own and owns it.
 *
 * Until advisors can be invited into a firm (FIRM-BOOK-PLAN F4) this is the
 * only way one comes to exist: the admin CLI, the flag-gated signup, the seed
 * and the test fixtures all come through here. The firm is named the way
 * `0011_firms` named the firms it backfilled, which is also the fallback every
 * email sign-off already uses: the firm name, or else the advisor's own.
 */
export async function createFirmWithOwner(values: Omit<NewProvider, 'firmId' | 'role'>): Promise<Provider> {
  return db.transaction(async (tx) => {
    const [firm] = await tx
      .insert(schema.firms)
      .values({ name: values.firmName?.trim() || values.name })
      .returning({ id: schema.firms.id });
    const [provider] = await tx
      .insert(schema.providers)
      .values({ ...values, firmId: firm.id, role: 'owner' })
      .returning();
    return provider;
  });
}

/**
 * The join condition from `clients` to the advisor who actually looks after
 * them: the assigned advisor, while that account is in the client's firm, has
 * not been deactivated and has joined (set a password). Anything else reads as
 * unassigned, and then the whole firm is who hears about the client. Notices
 * (`advisorsFor`), the portal's name for the advisor, the client directory and
 * the queue's "mine" all go through this one definition.
 */
export const isEffectiveAdvisor = and(
  eq(schema.providers.id, schema.clients.assignedProviderId),
  eq(schema.providers.firmId, schema.clients.firmId),
  isNull(schema.providers.deactivatedAt),
  isNotNull(schema.providers.passwordHash)
);

/**
 * The firm's name for an email's sign-off ("from Meridian CPA"). Skipped while
 * no mail server is configured: the email it would sign is not going out, and
 * a query per invitation or reset for nothing is a query too many.
 */
export async function firmSignOff(firmId: string): Promise<string | undefined> {
  if (!isMailConfigured()) return undefined;
  const [firm] = await db.select({ name: schema.firms.name }).from(schema.firms).where(eq(schema.firms.id, firmId));
  return firm?.name;
}
