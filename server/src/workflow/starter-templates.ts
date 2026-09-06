/**
 * The two checklists a CPA starts from, seeded per provider the first time they
 * open Templates (plan: C2.2). They are ordinary templates once created — the
 * advisor renames, reorders and deletes items freely; nothing re-seeds them.
 *
 * The lists come from the plan and are deliberately plain-English: the client
 * reads these titles in their portal, so "Prior-year tax return" beats "PY 1040".
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { RequestTemplate } from '../db/schema.js';

export interface TemplateItem {
  key: string;
  title: string;
  category: string | null;
  instructions: string | null;
  required: boolean;
  dueOffsetDays?: number;
}

const individual: TemplateItem[] = [
  { key: 'w2', title: 'W-2s', category: 'Income', instructions: 'One from each employer you worked for during the year.', required: true },
  { key: '1099', title: '1099s', category: 'Income', instructions: 'Interest, dividends, retirement, contract work — send every one you received.', required: true },
  { key: 'prior-return', title: 'Prior-year tax return', category: 'Reference', instructions: 'Only needed if we did not prepare it.', required: true },
  { key: 'mortgage-1098', title: 'Mortgage interest statement (1098)', category: 'Deductions', instructions: null, required: true },
  { key: 'property-tax', title: 'Property tax records', category: 'Deductions', instructions: 'The amount you actually paid during the year.', required: true },
  { key: 'charitable', title: 'Charitable donation receipts', category: 'Deductions', instructions: 'Anything over $250 needs the written acknowledgement from the charity.', required: true },
  { key: 'hsa-ira', title: 'HSA and IRA statements', category: 'Deductions', instructions: 'Contributions and distributions for the year.', required: true },
  { key: 'estimated-payments', title: 'Estimated tax payments', category: 'Payments', instructions: 'Dates and amounts of anything you paid during the year.', required: true },
  { key: 'k1', title: 'K-1s', category: 'Income', instructions: 'Only if you hold a partnership, S-corp or trust interest.', required: false },
  { key: 'dependents', title: "Dependents' information", category: 'Household', instructions: 'Full name, date of birth and SSN for anyone new.', required: true },
];

const business: TemplateItem[] = [
  { key: 'prior-return', title: 'Prior-year tax return', category: 'Reference', instructions: 'Only needed if we did not prepare it.', required: true },
  { key: 'pnl', title: 'Profit and loss statement', category: 'Financials', instructions: 'For the full year.', required: true },
  { key: 'balance-sheet', title: 'Balance sheet', category: 'Financials', instructions: 'As at year end.', required: true },
  { key: 'bank-statements', title: 'Bank statements', category: 'Financials', instructions: 'All business accounts, including the December statement.', required: true },
  { key: 'payroll', title: 'Payroll reports', category: 'Payroll', instructions: 'Year-end summary and the quarterly filings.', required: true },
  { key: '1099-issued', title: '1099s you issued', category: 'Payroll', instructions: 'Copies of anything sent to contractors.', required: true },
  { key: 'fixed-assets', title: 'Fixed-asset purchases', category: 'Assets', instructions: 'Invoices for equipment or vehicles bought during the year.', required: true },
  { key: 'loans', title: 'Loan statements', category: 'Financials', instructions: 'Year-end balance and interest paid.', required: true },
  { key: 'sales-tax', title: 'Sales-tax filings', category: 'Filings', instructions: null, required: false },
  { key: 'owner-distributions', title: 'Owner distributions', category: 'Financials', instructions: 'Amounts taken out of the business during the year.', required: true },
];

export const STARTER_TEMPLATES: Array<{ name: string; kind: 'individual_tax' | 'business_tax'; items: TemplateItem[] }> = [
  { name: 'Individual tax return', kind: 'individual_tax', items: individual },
  { name: 'Business tax return', kind: 'business_tax', items: business },
];

/**
 * Creates the starters for a provider that has none of that kind yet. Runs on
 * the first `GET /templates`, so a new advisor never faces an empty screen —
 * and never gets them back once they have been deleted or renamed.
 */
export async function ensureStarterTemplates(providerId: string, now = new Date()): Promise<void> {
  const existing = await db
    .select({ kind: schema.requestTemplates.kind })
    .from(schema.requestTemplates)
    .where(eq(schema.requestTemplates.providerId, providerId));
  // Any template at all means this provider has been here before; seeding on top
  // of a deliberately cleared list would be the app arguing with the advisor.
  if (existing.length > 0) return;

  await db.insert(schema.requestTemplates).values(
    STARTER_TEMPLATES.map((t) => ({
      providerId,
      name: t.name,
      kind: t.kind,
      items: t.items,
      createdAt: now,
      updatedAt: now,
    }))
  );
}

/** Template items → the rows `POST /engagements/:id/requests` inserts. */
export function itemsToRequests(
  items: TemplateItem[],
  base: { providerId: string; clientId: string; engagementId: string },
  now = new Date()
) {
  return items.map((item, i) => ({
    providerId: base.providerId,
    clientId: base.clientId,
    engagementId: base.engagementId,
    title: item.title,
    instructions: item.instructions ?? null,
    category: item.category ?? null,
    required: item.required ?? true,
    dueDate: item.dueOffsetDays ? new Date(now.getTime() + item.dueOffsetDays * 86_400_000) : null,
    status: 'requested' as const,
    sortOrder: i,
    templateItemKey: item.key,
    createdAt: now,
    updatedAt: now,
  }));
}
