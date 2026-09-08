/**
 * When recurring work runs, in the firm's own day.
 *
 * A reminder that says "due tomorrow" has to be sent in the morning *where the
 * firm is*, not at 08:00 UTC, so every recurring job is keyed to a firm-local
 * calendar date (`FIRM_TIMEZONE`). The date string is also the job's dedupe
 * key, which is what makes "one reminder run per day" true even when two
 * workers are up or one restarts at noon.
 *
 * No timezone library: `Intl.DateTimeFormat` already knows the rules, and the
 * one thing it cannot do — turn a local wall time back into an instant — is the
 * offset round-trip below. Near a DST transition that can land an hour out; for
 * an 08:00 reminder that is not worth a dependency.
 */
import { enqueue } from './queue.js';

/** The firm's timezone. Set on the firm PC in C5.3; a sensible US default here. */
export function firmTimezone(): string {
  return process.env.FIRM_TIMEZONE || 'America/Chicago';
}

/** The hour reminders go out, in the firm's day. */
export const REMINDER_HOUR = 8;

/**
 * When the ops digest goes out: half an hour before the reminders, so the
 * person who reads "the worker has not reported in for 14 hours" still has time
 * to do something about it before the day's client mail was due to be sent.
 */
export const DIGEST_HOUR = 7;
export const DIGEST_MINUTE = 30;

/** How often the staging sweeper runs. */
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const partsOf = (instant: Date, timeZone: string) => {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  // Intl renders midnight as hour 24 in some engines.
  if (out.hour === 24) out.hour = 0;
  return out;
};

/** The firm-local calendar date of an instant, as `YYYY-MM-DD`. */
export function firmDate(instant: Date, timeZone = firmTimezone()): string {
  const p = partsOf(instant, timeZone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** How far that zone is from UTC at that instant, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = partsOf(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - instant.getTime();
}

/** The instant at which it is `hour:minute` on `date` in the firm's timezone. */
export function firmInstant(date: string, hour: number, timeZone = firmTimezone(), minute = 0): Date {
  const [y, m, d] = date.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, hour, minute, 0);
  // The offset at roughly the right instant is close enough to invert with.
  const offset = offsetMs(new Date(naive), timeZone);
  return new Date(naive - offset);
}

/** Whole firm-local days between two `YYYY-MM-DD` dates (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * Whether a deadline earns a notice today: three days out, on the day, then
 * once a week for as long as it stays overdue.
 *
 * Deliberately not "every day while overdue" — a daily email about the same
 * missing form is how a client learns to ignore the sender.
 */
export function isReminderDay(dueDate: string, today: string): boolean {
  const delta = daysBetween(dueDate, today); // negative = before the deadline
  if (delta === -3) return true;
  if (delta === 0) return true;
  return delta > 0 && delta % 7 === 0;
}

/**
 * Makes sure the recurring jobs for right now exist. Called on every worker
 * tick: the dedupe keys make it idempotent, so a worker restarting at noon
 * cannot double-send the morning's reminders — and a worker that was down all
 * morning still sends them when it comes back, because the job's `runAt` is in
 * the past rather than skipped.
 */
export async function ensureScheduledJobs(now = new Date(), timeZone = firmTimezone()): Promise<void> {
  const today = firmDate(now, timeZone);
  await enqueue(
    'reminders',
    { date: today, timeZone },
    { dedupeKey: `reminders:${today}`, runAt: firmInstant(today, REMINDER_HOUR, timeZone) }
  );

  /* The digest, once per firm-local day. It sends nothing on a day when
     nothing is wrong, so this is a job that usually costs one query and no
     email at all (H7). */
  await enqueue(
    'ops_digest',
    { date: today, timeZone },
    { dedupeKey: `ops_digest:${today}`, runAt: firmInstant(today, DIGEST_HOUR, timeZone, DIGEST_MINUTE) }
  );

  // The sweeper is hourly and cares about no calendar at all.
  const hour = new Date(Math.floor(now.getTime() / SWEEP_INTERVAL_MS) * SWEEP_INTERVAL_MS);
  await enqueue('sweeper', {}, { dedupeKey: `sweeper:${hour.toISOString()}`, runAt: hour });
}
