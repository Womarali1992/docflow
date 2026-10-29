/**
 * The daily nudge.
 *
 * Runs once per firm-local day (08:00, `schedule.ts`) and asks one question of
 * every outstanding checklist line: does today earn a notice? A line with a
 * deadline is nudged three days out, on the day, and weekly while it stays
 * overdue. A *required* line with no deadline is nudged once a week, counted
 * from when it was last asked for (`isUndatedReminderDay`) — before the
 * 2026-10-28 audit those were never chased at all, though due dates are
 * optional everywhere and the Required box promised the client would be.
 *
 * Only lines in an open engagement count: a closed year is finished business.
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
import { and, eq, gte, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '../../db/client.js';
import type { Engagement, Job } from '../../db/schema.js';
import { notifyMany } from '../../notify.js';
import { enqueueEmail } from '../mail.js';
import { firmDate, firmInstant, firmTimezone, isReminderDay, isUndatedReminderDay } from '../schedule.js';

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
  firmName: string;
  dueDate: Date | null;
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
      firmName: schema.firms.name,
      dueDate: schema.requests.dueDate,
      required: schema.requests.required,
      askedAt: schema.requests.updatedAt,
    })
    .from(schema.requests)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.requests.clientId))
    .innerJoin(schema.firms, eq(schema.firms.id, schema.requests.firmId))
    .innerJoin(schema.engagements, eq(schema.engagements.id, schema.requests.engagementId))
    .where(
      and(
        isNull(schema.requests.archivedAt),
        inArray(schema.requests.status, ['requested', 'needs_correction']),
        eq(schema.engagements.status, 'open'),
        isNull(schema.engagements.archivedAt)
      )
    );

  /* A deactivated client cannot sign in; chasing them is pointless and unkind.
     Only required lines are chased, which is what the Required box on the
     checklist and the template editor both say: an optional line is the
     advisor saying "if you have it". */
  const earnsANotice = (r: (typeof rows)[number]) =>
    r.required &&
    (r.dueDate !== null
      ? isReminderDay(firmDate(r.dueDate, timeZone), today)
      : isUndatedReminderDay(firmDate(r.askedAt, timeZone), today));

  const due: DueRow[] = rows
    .filter((r) => r.deactivatedAt === null && earnsANotice(r))
    .map((r) => ({
      requestId: r.requestId,
      clientId: r.clientId,
      clientEmail: r.clientEmail,
      firmName: r.firmName,
      dueDate: r.dueDate,
    }));

  const byClient = new Map<string, DueRow[]>();
  for (const row of due) byClient.set(row.clientId, [...(byClient.get(row.clientId) ?? []), row]);

  let emailsQueued = 0;
  const notices = [...byClient.entries()].map(([clientId, items]) => ({
    userKind: 'client' as const,
    userId: clientId,
    type: 'reminder.due' as const,
    title: reminderTitle(items, today, timeZone),
    body: `You have ${items.length} item${items.length === 1 ? '' : 's'} waiting in your portal.`,
    link: '/portal',
  }));

  await notifyMany(notices);

  for (const [clientId, items] of byClient) {
    const queued = await enqueueEmail(
      { template: 'needs_attention', to: items[0].clientEmail, firmName: items[0].firmName },
      { dedupeKey: `reminder:${clientId}:${today}` }
    );
    if (queued) emailsQueued += 1;
  }

  return { date: today, clients: byClient.size, items: due.length, emailsQueued };
}

const documents = (n: number, one: string, many: string) => `${n} document${n === 1 ? one : many}`;

/** What the notice says: the worst thing that is true, as a count. */
function reminderTitle(items: Array<Pick<DueRow, 'dueDate'>>, today: string, timeZone: string): string {
  const overdue = items.filter((i) => i.dueDate && firmDate(i.dueDate, timeZone) < today).length;
  if (overdue > 0) return `${documents(overdue, ' is', 's are')} overdue`;
  if (items.some((i) => i.dueDate)) return `${documents(items.length, ' is', 's are')} due soon`;
  return `${documents(items.length, ' is', 's are')} still needed`;
}

export type RemindNowResult =
  | { ok: true; items: number; emailQueued: boolean }
  | { ok: false; code: 'nothing_outstanding' | 'already_reminded' | 'engagement_closed' };

/**
 * "Remind them now", from the engagement screen: the same notice the morning
 * run sends, for one engagement's outstanding lines, today.
 *
 * At most one reminder per client per firm-local day, whoever sends it. The
 * email shares the morning run's key (`reminder:<client>:<date>`), so a manual
 * reminder at 07:00 and the scheduled one at 08:00 are one email, and the
 * in-app check refuses a second press the same day — a client reminded twice
 * before lunch has been nagged, not reminded.
 */
export async function remindNow(engagement: Engagement, options: ReminderOptions = {}): Promise<RemindNowResult> {
  if (engagement.status !== 'open') return { ok: false, code: 'engagement_closed' };
  const timeZone = options.timeZone ?? firmTimezone();
  const today = options.today ?? firmDate(new Date(), timeZone);

  const outstanding = await db
    .select({ id: schema.requests.id, dueDate: schema.requests.dueDate })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.engagementId, engagement.id),
        isNull(schema.requests.archivedAt),
        inArray(schema.requests.status, ['requested', 'needs_correction'])
      )
    );
  if (outstanding.length === 0) return { ok: false, code: 'nothing_outstanding' };

  const [already] = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userKind, 'client'),
        eq(schema.notifications.userId, engagement.clientId),
        eq(schema.notifications.type, 'reminder.due'),
        gte(schema.notifications.createdAt, firmInstant(today, 0, timeZone))
      )
    )
    .limit(1);
  if (already) return { ok: false, code: 'already_reminded' };

  const [client] = await db
    .select({ email: schema.clients.email, firmName: schema.firms.name })
    .from(schema.clients)
    .innerJoin(schema.firms, eq(schema.firms.id, schema.clients.firmId))
    .where(eq(schema.clients.id, engagement.clientId));

  await notifyMany([
    {
      userKind: 'client',
      userId: engagement.clientId,
      type: 'reminder.due',
      title: reminderTitle(outstanding, today, timeZone),
      body: `You have ${outstanding.length} item${outstanding.length === 1 ? '' : 's'} waiting in your portal.`,
      link: '/portal',
    },
  ]);
  const emailQueued = client
    ? await enqueueEmail(
        { template: 'needs_attention', to: client.email, firmName: client.firmName },
        { dedupeKey: `reminder:${engagement.clientId}:${today}` }
      )
    : false;

  return { ok: true, items: outstanding.length, emailQueued };
}

export async function remindersJob(job: Job): Promise<ReminderResult> {
  const payload = (job.payload ?? {}) as { date?: string; timeZone?: string };
  // The job's own date wins, so a run delayed past midnight still sends the day
  // it was scheduled for rather than silently skipping it.
  const result = await runReminders({ today: payload.date, timeZone: payload.timeZone });
  console.log(`[reminders] ${result.date}: ${result.items} item(s) across ${result.clients} client(s), ${result.emailsQueued} email(s) queued`);
  return result;
}
