import 'dotenv/config';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { db, pool, schema } from './client.js';
import { makePlaceholderPdf } from './placeholder-pdf.js';
import { ensureKeyDir, newStorageKey } from '../files/store.js';
import { recordNewVersion } from '../workflow/versions.js';
import { ensureStarterTemplates } from '../workflow/starter-templates.js';
import { notify } from '../notify.js';
import type { Document } from './schema.js';

/**
 * A tax season's worth of demo data, so the app can be looked at rather than
 * imagined (`npm run db:demo`).
 *
 * It writes through the *real* code path — `recordNewVersion`, the same function
 * the upload pipeline calls — so what appears on screen has the properties the
 * app promises: versions are published, superseding works, accepting one does
 * not touch the review on the last one. Data faked at the SQL level would look
 * right and behave wrong.
 *
 * Idempotent per engagement: an engagement whose title already exists for that
 * client is skipped whole, so running this twice does not double anything.
 *
 * The states are chosen so every screen has something to show — the queue's
 * five tiles are all non-zero, progress bars sit at different fractions, one
 * client has said "I don't have this", one item is overdue, one deliverable is
 * shared and one is still private.
 */

const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day);
const ahead = (days: number) => new Date(Date.now() + days * day);

type ItemState =
  | { kind: 'requested'; dueInDays?: number }
  | { kind: 'overdue'; overdueDays: number }
  | { kind: 'submitted'; uploadedDaysAgo: number }
  | { kind: 'accepted'; uploadedDaysAgo: number; note?: string }
  | { kind: 'needs_correction'; uploadedDaysAgo: number; note: string }
  | { kind: 'waived'; reason: string }
  | { kind: 'not_applicable'; note: string; dueInDays?: number };

interface ItemSpec {
  title: string;
  category: string;
  instructions?: string;
  state: ItemState;
}

interface DeliverableSpec {
  name: string;
  shared: boolean;
  daysAgo: number;
}

interface EngagementSpec {
  clientEmail: string;
  title: string;
  kind: 'individual_tax' | 'business_tax' | 'other';
  taxYear: number;
  closed?: boolean;
  createdDaysAgo: number;
  items: ItemSpec[];
  deliverables?: DeliverableSpec[];
  messages?: { from: 'client' | 'provider'; text: string; daysAgo: number; read?: boolean }[];
}

const PLAN: EngagementSpec[] = [
  {
    clientEmail: 'sarah.johnson@meridian.co',
    title: '2026 Individual Tax Return',
    kind: 'individual_tax',
    taxYear: 2026,
    createdDaysAgo: 24,
    items: [
      { title: 'W-2 — employer wage statement', category: 'Income', state: { kind: 'accepted', uploadedDaysAgo: 20 } },
      { title: '1099-INT — bank interest', category: 'Income', state: { kind: 'accepted', uploadedDaysAgo: 19 } },
      {
        title: 'Form 1098 — mortgage interest',
        category: 'Deductions',
        instructions: 'The annual statement from your lender, not a monthly one.',
        state: {
          kind: 'needs_correction',
          uploadedDaysAgo: 9,
          note: 'This is the December statement rather than the annual 1098. Your lender usually posts it in January under "Tax documents".',
        },
      },
      { title: 'Charitable donation receipts', category: 'Deductions', state: { kind: 'submitted', uploadedDaysAgo: 2 } },
      { title: 'Brokerage year-end statement', category: 'Income', state: { kind: 'submitted', uploadedDaysAgo: 1 } },
      { title: 'Property tax receipt', category: 'Deductions', state: { kind: 'overdue', overdueDays: 5 } },
      {
        title: 'Form 1095-A — health insurance',
        category: 'Health',
        instructions: 'Only if you bought insurance through the marketplace.',
        state: { kind: 'requested', dueInDays: 6 },
      },
      { title: 'Form 1098-E — student loan interest', category: 'Deductions', state: { kind: 'requested' } },
      {
        title: 'Childcare provider statement',
        category: 'Credits',
        state: { kind: 'waived', reason: 'No dependents claimed for 2026 — confirmed by phone on the 3rd.' },
      },
      { title: 'Prior-year return (2025)', category: 'Reference', state: { kind: 'accepted', uploadedDaysAgo: 22 } },
    ],
    deliverables: [
      { name: '2026 Engagement letter.pdf', shared: true, daysAgo: 23 },
      { name: '2026 Form 1040 — draft.pdf', shared: false, daysAgo: 1 },
    ],
    messages: [
      { from: 'provider', text: 'Hi Sarah — the checklist for this year is up. Nothing urgent yet.', daysAgo: 23, read: true },
      { from: 'client', text: 'Got it. The mortgage one might take me a few days, the bank site is being difficult.', daysAgo: 22, read: true },
      { from: 'client', text: 'Sent the donation receipts — is the property tax one still needed?', daysAgo: 2, read: false },
    ],
  },
  {
    clientEmail: 'm.chen@chenco.io',
    title: '2026 Business Tax Return',
    kind: 'business_tax',
    taxYear: 2026,
    createdDaysAgo: 18,
    items: [
      { title: 'Profit & loss statement', category: 'Financials', state: { kind: 'submitted', uploadedDaysAgo: 3 } },
      { title: 'Balance sheet', category: 'Financials', state: { kind: 'submitted', uploadedDaysAgo: 3 } },
      { title: 'Payroll summary — Form 941s', category: 'Payroll', state: { kind: 'accepted', uploadedDaysAgo: 12 } },
      { title: 'Bank statements — December', category: 'Financials', state: { kind: 'overdue', overdueDays: 8 } },
      {
        title: 'Vehicle mileage log',
        category: 'Deductions',
        state: { kind: 'not_applicable', note: 'No business vehicle this year — I use my own car and do not claim it.', dueInDays: 3 },
      },
      { title: 'Equipment purchase invoices', category: 'Assets', state: { kind: 'requested', dueInDays: 4 } },
      {
        title: '1099s issued to contractors',
        category: 'Payroll',
        state: { kind: 'needs_correction', uploadedDaysAgo: 6, note: 'Two of these are missing the recipient TIN. Please send the corrected copies.' },
      },
    ],
    deliverables: [{ name: '2026 Form 1120-S — final.pdf', shared: true, daysAgo: 1 }],
    messages: [
      { from: 'client', text: 'P&L and balance sheet are in. The December bank statement is coming, the bank is slow.', daysAgo: 3, read: false },
    ],
  },
  {
    clientEmail: 'emily@davisventures.com',
    title: '2025 Individual Tax Return',
    kind: 'individual_tax',
    taxYear: 2025,
    closed: true,
    createdDaysAgo: 380,
    items: [
      { title: 'W-2 — employer wage statement', category: 'Income', state: { kind: 'accepted', uploadedDaysAgo: 360 } },
      { title: '1099-DIV — dividends', category: 'Income', state: { kind: 'accepted', uploadedDaysAgo: 358 } },
      { title: 'Form 1098 — mortgage interest', category: 'Deductions', state: { kind: 'accepted', uploadedDaysAgo: 357 } },
      { title: 'Charitable donation receipts', category: 'Deductions', state: { kind: 'accepted', uploadedDaysAgo: 355 } },
    ],
    deliverables: [{ name: '2025 Form 1040 — final.pdf', shared: true, daysAgo: 350 }],
  },
  {
    clientEmail: 'emily@davisventures.com',
    title: '2026 Individual Tax Return',
    kind: 'individual_tax',
    taxYear: 2026,
    createdDaysAgo: 11,
    items: [
      { title: 'W-2 — employer wage statement', category: 'Income', state: { kind: 'submitted', uploadedDaysAgo: 1 } },
      { title: '1099-DIV — dividends', category: 'Income', state: { kind: 'overdue', overdueDays: 2 } },
      { title: 'Form 1098 — mortgage interest', category: 'Deductions', state: { kind: 'requested', dueInDays: 9 } },
      { title: 'Charitable donation receipts', category: 'Deductions', state: { kind: 'requested', dueInDays: 9 } },
      { title: 'HSA contribution summary', category: 'Health', state: { kind: 'requested' } },
    ],
  },
];

/** Writes a real, openable PDF under DATA_ROOT and returns what a version needs. */
function storePdf(title: string) {
  const bytes = makePlaceholderPdf(title);
  const storageKey = newStorageKey(new Date(), 'pdf');
  fs.writeFileSync(ensureKeyDir(storageKey), bytes);
  return {
    storageKey,
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    mimeType: 'application/pdf',
  };
}

const fileNameFor = (title: string) =>
  `${title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)}.pdf`;

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('db:demo writes invented clients, documents and messages. Refusing in production.');
    process.exit(1);
  }

  const [provider] = await db.select().from(schema.providers).limit(1);
  if (!provider) {
    console.error('No advisor in this database. Run `npm run db:seed` first.');
    process.exit(1);
  }
  console.log(`Advisor: ${provider.name} <${provider.email}>`);

  // The templates screen seeds itself on first read; do it now so it is not empty.
  await ensureStarterTemplates(provider.id);

  let made = 0;
  let skipped = 0;

  for (const spec of PLAN) {
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.email, spec.clientEmail));
    if (!client) {
      console.log(`- no client ${spec.clientEmail}; skipping "${spec.title}"`);
      continue;
    }

    const [existing] = await db
      .select()
      .from(schema.engagements)
      .where(and(eq(schema.engagements.clientId, client.id), eq(schema.engagements.title, spec.title)));
    if (existing) {
      console.log(`= ${client.name}: "${spec.title}" already exists, left alone`);
      skipped += 1;
      continue;
    }

    const createdAt = ago(spec.createdDaysAgo);
    const [engagement] = await db
      .insert(schema.engagements)
      .values({
        providerId: provider.id,
        clientId: client.id,
        title: spec.title,
        kind: spec.kind,
        taxYear: spec.taxYear,
        status: spec.closed ? 'closed' : 'open',
        closedAt: spec.closed ? ago(Math.max(1, spec.createdDaysAgo - 60)) : null,
        createdAt,
        updatedAt: createdAt,
      })
      .returning();

    console.log(`+ ${client.name}: ${spec.title}`);

    for (const [index, item] of spec.items.entries()) {
      const dueDate =
        item.state.kind === 'overdue'
          ? ago(item.state.overdueDays)
          : 'dueInDays' in item.state && item.state.dueInDays !== undefined
            ? ahead(item.state.dueInDays)
            : null;

      const [request] = await db
        .insert(schema.requests)
        .values({
          providerId: provider.id,
          clientId: client.id,
          engagementId: engagement.id,
          title: item.title,
          instructions: item.instructions ?? null,
          category: item.category,
          required: true,
          dueDate,
          status: 'requested',
          sortOrder: index,
          createdAt,
          updatedAt: createdAt,
        })
        .returning();

      const uploads = ['submitted', 'accepted', 'needs_correction'] as const;
      if ((uploads as readonly string[]).includes(item.state.kind)) {
        const uploadedDaysAgo = 'uploadedDaysAgo' in item.state ? item.state.uploadedDaysAgo : 1;
        const uploadedAt = ago(uploadedDaysAgo);
        const stored = storePdf(item.title);

        const [document] = await db
          .insert(schema.documents)
          .values({
            clientId: client.id,
            providerId: provider.id,
            engagementId: engagement.id,
            requestId: request.id,
            kind: 'client_upload',
            displayName: item.title,
            category: item.category,
            name: item.title,
            folder: item.category,
            type: 'pdf',
            uploadedByKind: 'client',
            uploadedById: client.id,
            uploadedAt,
            createdAt: uploadedAt,
            updatedAt: uploadedAt,
          })
          .returning();

        // The same call the upload pipeline makes: publishes, supersedes,
        // and moves the request to `submitted`.
        const { version } = await recordNewVersion({
          document: document as Document,
          originalFilename: fileNameFor(item.title),
          uploadedByKind: 'client',
          uploadedById: client.id,
          now: uploadedAt,
          ...stored,
        });

        if (item.state.kind === 'accepted' || item.state.kind === 'needs_correction') {
          const decidedAt = ago(Math.max(0, uploadedDaysAgo - 1));
          await db.insert(schema.reviews).values({
            documentId: document.id,
            versionId: version.id,
            requestId: request.id,
            reviewerId: provider.id,
            decision: item.state.kind === 'accepted' ? 'accepted' : 'needs_correction',
            note: 'note' in item.state ? item.state.note ?? null : null,
            createdAt: decidedAt,
          });
          await db
            .update(schema.requests)
            .set({ status: item.state.kind, updatedAt: decidedAt })
            .where(eq(schema.requests.id, request.id));
        }
      }

      if (item.state.kind === 'waived') {
        await db
          .update(schema.requests)
          .set({
            status: 'waived',
            waivedReason: item.state.reason,
            waivedAt: ago(3),
            waivedById: provider.id,
            updatedAt: ago(3),
          })
          .where(eq(schema.requests.id, request.id));
      }

      if (item.state.kind === 'not_applicable') {
        // Recorded as the client's answer, and deliberately NOT a status change:
        // only the advisor takes something off the list.
        await db
          .update(schema.requests)
          .set({
            clientResponseKind: 'not_applicable',
            clientResponseNote: item.state.note,
            clientResponseAt: ago(2),
            updatedAt: ago(2),
          })
          .where(eq(schema.requests.id, request.id));
        await notify({
          userKind: 'provider',
          userId: provider.id,
          type: 'request.not_applicable',
          title: `${client.name} says they do not have: ${item.title}`,
          body: item.state.note,
          link: `/engagements/${engagement.id}`,
        });
      }
    }

    for (const deliverable of spec.deliverables ?? []) {
      const at = ago(deliverable.daysAgo);
      const stored = storePdf(deliverable.name.replace(/\.pdf$/i, ''));
      const [document] = await db
        .insert(schema.documents)
        .values({
          clientId: client.id,
          providerId: provider.id,
          engagementId: engagement.id,
          kind: 'deliverable',
          displayName: deliverable.name,
          category: 'Reports',
          name: deliverable.name,
          folder: 'Reports',
          type: 'pdf',
          uploadedByKind: 'provider',
          uploadedById: provider.id,
          uploadedAt: at,
          sharedAt: deliverable.shared ? at : null,
          sharedById: deliverable.shared ? provider.id : null,
          createdAt: at,
          updatedAt: at,
        })
        .returning();

      await recordNewVersion({
        document: document as Document,
        originalFilename: deliverable.name,
        uploadedByKind: 'provider',
        uploadedById: provider.id,
        now: at,
        ...stored,
      });

      if (deliverable.shared) {
        await notify({
          userKind: 'client',
          userId: client.id,
          type: 'deliverable.shared',
          title: `Your accountant shared: ${deliverable.name}`,
          body: 'It is ready to download from your portal.',
          link: '/portal/shared',
        });
      }
    }

    for (const message of spec.messages ?? []) {
      const at = ago(message.daysAgo);
      await db.insert(schema.messages).values({
        clientId: client.id,
        providerId: provider.id,
        senderKind: message.from,
        senderId: message.from === 'client' ? client.id : provider.id,
        senderName: message.from === 'client' ? client.name : provider.name,
        content: message.text,
        readAt: message.read ? at : null,
        createdAt: at,
      });
      if (message.from === 'client' && !message.read) {
        await notify({
          userKind: 'provider',
          userId: provider.id,
          type: 'message.new',
          title: `New message from ${client.name}`,
          link: `/clients/${client.id}`,
        });
      }
    }

    made += 1;
  }

  console.log('');
  console.log(`Done: ${made} engagement(s) created, ${skipped} already existed.`);
  console.log('Sign in as the advisor and look at / (the queue), a client, an engagement, /review/<id>, /templates.');
  console.log('Then sign in as a client for /portal.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
