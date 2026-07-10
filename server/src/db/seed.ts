import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db, pool, schema } from './client.js';
import { eq } from 'drizzle-orm';
import { makePlaceholderPdf } from './placeholder-pdf.js';
import { humanSize, writeStoredFileSync } from '../storage.js';

async function seed() {
  console.log('Seeding database...');

  const advisorEmail = 'sarah@meridiancpa.com';
  const advisorPassword = 'password123';

  let [provider] = await db
    .select()
    .from(schema.providers)
    .where(eq(schema.providers.email, advisorEmail));

  if (!provider) {
    const passwordHash = await bcrypt.hash(advisorPassword, 10);
    [provider] = await db
      .insert(schema.providers)
      .values({
        name: 'Sarah Johnson',
        email: advisorEmail,
        passwordHash,
        firmName: 'Meridian CPA',
        role: 'advisor',
      })
      .returning();
    console.log(`+ Provider: ${provider.name} <${provider.email}>`);
  } else {
    console.log(`= Provider already exists: ${provider.email}`);
  }

  const clientSeeds = [
    { name: 'Sarah Johnson', email: 'sarah.johnson@meridian.co', accountId: 'CL-04827', plan: 'Wealth Tier', clientSince: 'Mar 2021', aum: '2450000.00' },
    { name: 'Michael Chen',   email: 'm.chen@chenco.io',         accountId: 'CL-02941', plan: 'Wealth Tier', clientSince: 'Jan 2019', aum: '5120000.00' },
    { name: 'Emily Davis',    email: 'emily@davisventures.com',  accountId: 'CL-11203', plan: 'Core',        clientSince: 'Aug 2022', aum: '780000.00' },
  ];

  const clientPassword = 'client123';
  const clientHash = await bcrypt.hash(clientPassword, 10);

  for (const c of clientSeeds) {
    const existing = await db
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.email, c.email));
    if (existing.length === 0) {
      const [created] = await db
        .insert(schema.clients)
        .values({ ...c, providerId: provider.id, passwordHash: clientHash })
        .returning();
      console.log(`+ Client: ${created.name} <${created.email}>`);
    } else {
      // Self-heal AUM for clients seeded before the aum column existed.
      if (existing[0].aum === null) {
        await db.update(schema.clients).set({ aum: c.aum }).where(eq(schema.clients.id, existing[0].id));
        console.log(`~ Backfilled AUM for ${c.email}`);
      } else {
        console.log(`= Client already exists: ${c.email}`);
      }
    }
  }

  // Get the first client (Sarah Johnson the client) to attach documents to
  const allClients = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.providerId, provider.id));
  const firstClient = allClients[0];

  const existingDocs = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.clientId, firstClient.id));

  if (existingDocs.length === 0) {
    const docs: (typeof schema.documents.$inferInsert)[] = [
      {
        clientId: firstClient.id,
        providerId: provider.id,
        name: 'Bank Statement Jun 2025.pdf',
        type: 'pdf',
        folder: 'Statements',
        uploadedByKind: 'client',
        uploadedById: firstClient.id,
        uploadedAt: new Date(2025, 5, 5, 14, 30),
        requestFrequency: 'monthly',
        status: 'pending',
      },
      {
        clientId: firstClient.id,
        providerId: provider.id,
        name: 'Bank Statement Jun 2024.pdf',
        type: 'pdf',
        folder: 'Statements',
        uploadedByKind: 'client',
        uploadedById: firstClient.id,
        uploadedAt: new Date(2024, 5, 5, 14, 30),
        requestFrequency: 'monthly',
        status: 'reviewed',
      },
      {
        clientId: firstClient.id,
        providerId: provider.id,
        name: 'Tax Return 2024.pdf',
        type: 'pdf',
        folder: 'Documents',
        uploadedByKind: 'client',
        uploadedById: firstClient.id,
        uploadedAt: new Date(2024, 6, 3, 10, 15),
        requestFrequency: 'yearly',
        status: 'reviewed',
      },
      {
        clientId: firstClient.id,
        providerId: provider.id,
        name: 'Tax Return 2025.pdf',
        type: 'pdf',
        folder: 'Documents',
        uploadedByKind: 'client',
        uploadedById: firstClient.id,
        uploadedAt: new Date(2025, 6, 3, 10, 15),
        requestFrequency: 'yearly',
        status: 'pending',
      },
      {
        clientId: firstClient.id,
        providerId: provider.id,
        name: 'Q3 Portfolio Analysis 2025.pdf',
        type: 'pdf',
        folder: 'Reports',
        uploadedByKind: 'provider',
        uploadedById: provider.id,
        uploadedAt: new Date(2025, 8, 12, 9, 0),
        requestFrequency: 'quarterly',
      },
      {
        clientId: firstClient.id,
        providerId: provider.id,
        name: 'Insurance Policy 2025',
        type: 'pdf',
        folder: 'Documents',
        isRequested: true,
        requestedById: provider.id,
        requestedAt: new Date(2025, 7, 8),
        description: 'Current life and disability insurance policy documents.',
        requestFrequency: 'yearly',
      },
      {
        clientId: firstClient.id,
        providerId: provider.id,
        name: 'Q4 Financial Report',
        type: 'pdf',
        folder: 'Reports',
        isRequested: true,
        requestedById: provider.id,
        requestedAt: new Date(2025, 7, 8),
        description: 'Quarterly financial report.',
        requestFrequency: 'quarterly',
      },
    ];
    for (const d of docs) {
      const [created] = await db.insert(schema.documents).values(d).returning();
      console.log(`+ Document: ${created.name}`);
    }
  } else {
    console.log(`= Documents already seeded for ${firstClient.name}`);
  }

  // Backfill a real placeholder file for every non-requested document that lacks one.
  // Idempotent (skips docs that already have storagePath) and self-heals old /mock/* urls.
  const allDocs = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.providerId, provider.id));
  let backfilled = 0;
  for (const d of allDocs) {
    if (d.isRequested || d.storagePath) continue;
    const buf = makePlaceholderPdf(d.name);
    const fileName = `${d.id}.pdf`;
    writeStoredFileSync(fileName, buf);
    await db
      .update(schema.documents)
      .set({
        storagePath: fileName,
        mimeType: 'application/pdf',
        sizeBytes: buf.length,
        size: humanSize(buf.length),
        url: `/api/documents/${d.id}/download`,
      })
      .where(eq(schema.documents.id, d.id));
    backfilled++;
  }
  console.log(`Backfilled ${backfilled} placeholder PDF(s).`);

  // Seed two demo messages (one unread in each direction) so unread counters are non-zero.
  const existingMsgs = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.clientId, firstClient.id));
  if (existingMsgs.length === 0) {
    await db.insert(schema.messages).values([
      {
        clientId: firstClient.id,
        providerId: provider.id,
        senderKind: 'client',
        senderId: firstClient.id,
        senderName: firstClient.name,
        content: 'Hi — I just uploaded my latest bank statement. Let me know if anything else is needed.',
        readAt: null,
      },
      {
        clientId: firstClient.id,
        providerId: provider.id,
        senderKind: 'provider',
        senderId: provider.id,
        senderName: provider.name,
        content: "Thanks! I'll review it this week. Could you also send your Q4 insurance policy?",
        readAt: null,
      },
    ]);
    console.log('+ Seeded 2 demo messages');
  } else {
    console.log(`= Messages already seeded for ${firstClient.name}`);
  }

  console.log('\nSeed complete. Login credentials:');
  console.log(`  Advisor: ${advisorEmail} / ${advisorPassword}`);
  console.log(`  Clients: <client-email> / ${clientPassword}`);
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
