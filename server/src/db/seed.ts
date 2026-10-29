import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db, pool, schema } from './client.js';
import { and, eq } from 'drizzle-orm';
import { encryptSecret } from '../auth/crypto.js';
import { normalizeEmail } from '../auth/email.js';
import { createFirmWithOwner } from './firms.js';
import { type UserKind } from '../auth/mfa.js';

/**
 * The accounts a dev database needs before anything else will work: one advisor,
 * three clients, all enrolled in MFA with a published secret so signing in
 * locally is one command away.
 *
 * This used to seed documents too, in the pre-workflow shape — folders, a
 * `storage_path`, an `is_requested` flag. C5.4 dropped those columns, and
 * `npm run db:demo` had already taken over the job properly: it writes a whole
 * tax season through `recordNewVersion()`, the same function the upload pipeline
 * calls, so what appears on screen behaves the way the app promises. Seeding
 * rows straight into SQL made data that looked right and behaved wrong.
 *
 * So: `npm run db:seed` for the accounts, then `npm run db:demo` for something
 * to look at. Both are idempotent, and both refuse to run in production.
 */

/**
 * One well-known authenticator secret for every demo account so a local sign-in
 * is `npm run totp -- <secret>` away. Base32, as an authenticator app expects.
 */
const DEV_TOTP_SECRET = 'DOCFLOW2DEV2TOTP2SECRET2';

/** Enrolls a demo account with the shared dev secret unless it is already enrolled. */
async function enrollDevMfa(userKind: UserKind, userId: string, label: string) {
  const [existing] = await db
    .select()
    .from(schema.mfaTotp)
    .where(and(eq(schema.mfaTotp.userKind, userKind), eq(schema.mfaTotp.userId, userId)));
  if (existing?.enrolledAt) return;
  const now = new Date();
  if (existing) {
    await db
      .update(schema.mfaTotp)
      .set({ secretEnc: encryptSecret(DEV_TOTP_SECRET), enrolledAt: now, lastUsedStep: null, updatedAt: now })
      .where(eq(schema.mfaTotp.id, existing.id));
  } else {
    await db
      .insert(schema.mfaTotp)
      .values({ userKind, userId, secretEnc: encryptSecret(DEV_TOTP_SECRET), enrolledAt: now, createdAt: now, updatedAt: now });
  }
  console.log(`+ MFA enrolled (dev secret): ${label}`);
}

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    console.error('db:seed writes demo accounts with published passwords and a published MFA secret. Refusing in production.');
    process.exit(1);
  }
  console.log('Seeding accounts...');

  const advisorEmail = 'sarah@meridiancpa.com';
  const advisorPassword = 'password123';

  let [provider] = await db.select().from(schema.providers).where(eq(schema.providers.email, advisorEmail));

  if (!provider) {
    const passwordHash = await bcrypt.hash(advisorPassword, 10);
    provider = await createFirmWithOwner({
      /* Not "Sarah Johnson": that is the demo client, and a thread between
         two people with one name is unreadable (2026-10-28 audit). */
      name: 'Sarah Mitchell',
      email: advisorEmail,
      passwordHash,
      firmName: 'Meridian CPA',
    });
    console.log(`+ Provider: ${provider.name} <${provider.email}>`);
  } else {
    console.log(`= Provider already exists: ${provider.email}`);
  }

  /* A second advisor, so the firm's shared book has something to share
     (FIRM-BOOK-PLAN F8): Mine / Everyone, reassignment, and the notices that
     go to the whole firm while a client has nobody. */
  const colleagueEmail = 'james@meridiancpa.com';
  let [colleague] = await db.select().from(schema.providers).where(eq(schema.providers.email, colleagueEmail));
  if (!colleague) {
    [colleague] = await db
      .insert(schema.providers)
      .values({
        firmId: provider.firmId,
        name: 'James Okafor',
        email: colleagueEmail,
        passwordHash: await bcrypt.hash(advisorPassword, 10),
        role: 'advisor',
      })
      .returning();
    console.log(`+ Advisor: ${colleague.name} <${colleague.email}>`);
  } else {
    console.log(`= Advisor already exists: ${colleague.email}`);
  }

  /* Emily Davis has nobody: the whole firm hears from her until someone takes her. */
  const clientSeeds = [
    { name: 'Sarah Johnson', email: 'sarah.johnson@meridian.co', accountId: 'CL-04827', plan: 'Wealth Tier', clientSince: 'Mar 2021', aum: '2450000.00', advisor: provider.id },
    { name: 'Michael Chen',   email: 'm.chen@chenco.io',         accountId: 'CL-02941', plan: 'Wealth Tier', clientSince: 'Jan 2019', aum: '5120000.00', advisor: colleague.id },
    { name: 'Emily Davis',    email: 'emily@davisventures.com',  accountId: 'CL-11203', plan: 'Core',        clientSince: 'Aug 2022', aum: '780000.00',  advisor: null },
  ];

  const clientPassword = 'client123';
  const clientHash = await bcrypt.hash(clientPassword, 10);

  // An existing client keeps whatever advisor it has: the seed never reassigns.
  for (const { advisor, ...c } of clientSeeds) {
    // The same address may be a client of another firm (F7); only this firm's account counts.
    const existing = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.firmId, provider.firmId), eq(schema.clients.emailNormalized, normalizeEmail(c.email))));
    if (existing.length === 0) {
      const [created] = await db
        .insert(schema.clients)
        // `emailNormalized` is NOT NULL and unique within the firm (F7); every write path sets it.
        .values({
          ...c,
          emailNormalized: normalizeEmail(c.email),
          firmId: provider.firmId,
          assignedProviderId: advisor,
          passwordHash: clientHash,
        })
        .returning();
      console.log(`+ Client: ${created.name} <${created.email}>`);
    } else {
      console.log(`= Client already exists: ${c.email}`);
    }
  }

  await enrollDevMfa('provider', provider.id, provider.email);
  await enrollDevMfa('provider', colleague.id, colleague.email);
  const allClients = await db.select().from(schema.clients).where(eq(schema.clients.firmId, provider.firmId));
  for (const c of allClients) await enrollDevMfa('client', c.id, c.email);

  console.log('\nSeed complete.');
  console.log(`  Advisors: ${advisorEmail} (owner), ${colleagueEmail} / ${advisorPassword}`);
  console.log(`  Clients: ${clientSeeds.map((c) => c.email).join(', ')} / ${clientPassword}`);
  console.log(`  Authenticator code: npm run totp -- ${DEV_TOTP_SECRET}`);
  console.log('  Next: npm run db:demo — a tax season of documents to look at.');
  await pool.end();
}

seed().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
