/**
 * The daily nudge.
 *
 * Runs once per firm-local day (08:00, `schedule.ts`) and asks one question of
 * every outstanding checklist line with a deadline: does today earn a notice —
 * three days out, on the day, or a weekly one while it stays overdue?
 *
 * Everything else about this handler is about **not becoming noise**:
 *
 *  - **One notice per client per day**, however many items are due. Five
 *    separate emails about one tax return is how a client learns to filter the
 *    sender.
 *  - **Counts, never contents.** The notice says how many things are waiting
 *    and links to the portal. No titles, no filenames — the same rule the rest
 *    of the mail follows, and the in-app notification matches it so the two
 *    cannot drift.
 *  - **Answered items stop it.** The query only looks at `requested` and
 *    `needs_correction`; the moment something is submitted, accepted or waived
 *    it drops out, with no separate cancellation to forget.
 *  - **Idempotent.** The email carries `dedupeKey reminder:<clientId>:<date>`,
 *    so a retried job cannot send a second copy.
 */
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from '../../db/client.js';
import type { Job } from '../../db/schema.js';
import { notifyMany } from '../../notify.js';
import { enqueueEmail } from '../mail.js';
import { firmDate, firmTimezone, isReminderDay } from '../schedule.js';

export interface ReminderResult {
  date: string;
  /** Clients that got a notice today. */
  clients: number;
  /** Checklist lines that earned one (a client may have several). */
  items: number;
  emailsQueued: number;
}

interface DueRow {
  requestId: string;
  clientId: string;
  clientEmail: string;
  providerId: string;
  firmName: string | null;
  dueDate: Date;
}

export interface ReminderOptions {
  /** The firm-local day to send for. Defaults to the day it is now, there. */
  today?: string;
  timeZone?: string;
}

export async function runReminders(options: ReminderOptions = {}): Promise<ReminderResult> {
  const timeZone = options.timeZone ?? firmTimezone();
  /* The day is passed as a date, never derived from an instant inside here: a
     job that ran late must still send the day it was scheduled for. */
  const today = options.today ?? firmDate(new Date(), timeZone);

  const rows = await db
    .select({
      requestId: schema.requests.id,
      clientId: schema.requests.clientId,
      clientEmail: schema.clients.email,
      deactivatedAt: schema.clients.deactivatedAt,
      providerId: schema.requests.providerId,
      firmName: schema.providers.firmName,
      dueDate: schema.requests.dueDate,
    })
    .from(schema.requests)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.requests.clientId))
    .innerJoin(schema.providers, eq(schema.providers.id, schema.requests.providerId))
    .where(
      and(
        isNull(schema.requests.archivedAt),
        isNotNull(schema.requests.dueDate),
        inArray(schema.requests.status, ['requested', 'needs_correction'])
      )
    );

  // A deactivated client cannot sign in; chasing them is pointless and unkind.
  const due: DueRow[] = rows
    .filter((r) => r.dueDate !== null && r.deactivatedAt === null && isReminderDay(firmDate(r.dueDate, timeZone), today))
    .map((r) => ({
      requestId: r.requestId,
      clientId: r.clientId,
      clientEmail: r.clientEmail,
      providerId: r.providerId,
      firmName: r.firmName,
      dueDate: r.dueDate as Date,
    }));

  const byClient = new Map<string, DueRow[]>();
  for (const row of due) byClient.set(row.clientId, [...(byClient.get(row.clientId) ?? []), row]);

  let emailsQueued = 0;
  const notices = [...byClient.entries()].map(([clientId, items]) => {
    const overdue = items.filter((i) => firmDate(i.dueDate, timeZone) < today).length;
    return {
      userKind: 'client' as const,
      userId: clientId,
      type: 'reminder.due' as const,
      title:
        overdue > 0
          ? `${overdue} document${overdue === 1 ? ' is' : 's are'} overdue`
          : `${items.length} document${items.length === 1 ? ' is' : 's are'} due soon`,
      body: `You have ${items.length} item${items.length === 1 ? '' : 's'} waiting in your portal.`,
      link: '/portal',
    };
  });

  await notifyMany(notices);

  for (const [clientId, items] of byClient) {
    const queued = await enqueueEmail(
      { template: 'needs_attention', to: items[0].clientEmail, firmName: items[0].firmName ?? undefined },
      { dedupeKey: `reminder:${clientId}:${today}` }
    );
    if (queued) emailsQueued += 1;
  }

  return { date: today, clients: byClient.size, items: due.length, emailsQueued };
}

export async function remindersJob(job: Job): Promise<ReminderResult> {
  const payload = (job.payload ?? {}) as { date?: string; timeZone?: string };
  // The job's own date wins, so a run delayed past midnight still sends the day
  // it was scheduled for rather than silently skipping it.
  const result = await runReminders({ today: payload.date, timeZone: payload.timeZone });
  console.log(`[reminders] ${result.date}: ${result.items} item(s) across ${result.clients} client(s), ${result.emailsQueued} email(s) queued`);
  return result;
}
