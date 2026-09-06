/**
 * Reminders (C4.3): when a nudge is earned, and how it is kept from becoming
 * noise.
 *
 * The schedule is pure date arithmetic, so it is tested against fixed dates
 * rather than a clock — no `vi.useFakeTimers`, no waiting. The handler is then
 * driven against the real database with an explicit `today`, which is exactly
 * how the job runs in production (the job carries the date it was scheduled
 * for, so a run delayed past midnight still sends the day it was for).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { runReminders } from '../src/jobs/handlers/reminders.js';
import { daysBetween, firmDate, firmInstant, isReminderDay } from '../src/jobs/schedule.js';
import { loginAs, request, app, seedFixture, type Fixture } from './helpers.js';

const TZ = 'America/Chicago';

/** Sets one seeded request's deadline, in the firm's day. */
async function setDue(requestId: string, date: string | null) {
  await db
    .update(schema.requests)
    .set({ dueDate: date ? firmInstant(date, 12, TZ) : null })
    .where(eq(schema.requests.id, requestId));
}

async function notificationsFor(clientId: string) {
  return db
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, clientId), eq(schema.notifications.type, 'reminder.due')));
}

async function reminderEmails(clientId: string, date: string) {
  return db.select().from(schema.jobs).where(eq(schema.jobs.dedupeKey, `reminder:${clientId}:${date}`));
}

describe('the reminder schedule', () => {
  it('nudges three days out, on the day, then weekly while overdue', () => {
    const due = '2026-04-15';
    expect(isReminderDay(due, '2026-04-12')).toBe(true); // three days before
    expect(isReminderDay(due, '2026-04-15')).toBe(true); // the day itself
    expect(isReminderDay(due, '2026-04-22')).toBe(true); // a week late
    expect(isReminderDay(due, '2026-04-29')).toBe(true); // two weeks late
  });

  it('stays quiet on every other day', () => {
    const due = '2026-04-15';
    // A daily email about the same missing form is how a client learns to
    // filter the sender.
    for (const day of ['2026-04-11', '2026-04-13', '2026-04-14', '2026-04-16', '2026-04-17', '2026-04-21', '2026-04-23']) {
      expect(isReminderDay(due, day)).toBe(false);
    }
  });

  it('counts calendar days across a month, a year and a leap day', () => {
    expect(daysBetween('2026-04-15', '2026-05-01')).toBe(16);
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2); // 2028 is a leap year
  });

  it('reads the calendar in the firm’s timezone, not UTC', () => {
    // 02:00 UTC on the 16th is still the 15th in Chicago — and a reminder that
    // says "due today" has to agree with the calendar on the firm's wall.
    const instant = new Date('2026-04-16T02:00:00Z');
    expect(firmDate(instant, TZ)).toBe('2026-04-15');
    expect(firmDate(instant, 'UTC')).toBe('2026-04-16');
  });

  it('turns a firm-local hour back into the right instant', () => {
    // April: Chicago is UTC−5, so 08:00 local is 13:00 UTC.
    expect(firmInstant('2026-04-15', 8, TZ).toISOString()).toBe('2026-04-15T13:00:00.000Z');
    // January: UTC−6, so 14:00 UTC. The offset is looked up, not assumed.
    expect(firmInstant('2026-01-15', 8, TZ).toISOString()).toBe('2026-01-15T14:00:00.000Z');
  });
});

describe('the reminder run', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('sends one notice per client however many items are due', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const created = await request(app)
      .post(`/api/engagements/${fx.client1a.engagement}/requests`)
      .set('Cookie', advisor)
      .send({ items: [{ title: 'W-2' }, { title: '1099-INT' }, { title: 'Mortgage interest' }] });
    expect(created.status).toBe(201);

    const due = '2026-04-15';
    for (const row of created.body as Array<{ id: string }>) await setDue(row.id, due);

    const result = await runReminders({ today: due, timeZone: TZ });
    expect(result.items).toBe(3);
    expect(result.clients).toBe(1);

    // Three items, one notice: five emails about one tax return is how a
    // client learns to ignore the sender.
    const notices = await notificationsFor(fx.client1a.id);
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toContain('3 documents');
  });

  it('says nothing at all on a day nothing is due', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const created = await request(app)
      .post(`/api/engagements/${fx.client1a.engagement}/requests`)
      .set('Cookie', advisor)
      .send({ items: [{ title: 'W-2' }] });
    await setDue((created.body as Array<{ id: string }>)[0].id, '2026-04-15');

    const result = await runReminders({ today: '2026-04-14', timeZone: TZ });
    expect(result.items).toBe(0);
    expect(result.clients).toBe(0);
    expect(await notificationsFor(fx.client1a.id)).toHaveLength(0);
  });

  it('stops the moment the client answers, with nothing to cancel', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const created = await request(app)
      .post(`/api/engagements/${fx.client1a.engagement}/requests`)
      .set('Cookie', advisor)
      .send({ items: [{ title: 'W-2' }, { title: '1099-INT' }] });
    const [first, second] = created.body as Array<{ id: string }>;
    const due = '2026-04-15';
    await setDue(first.id, due);
    await setDue(second.id, due);

    // One waived by the advisor, one moved on by an upload: both drop out
    // because the query only looks at what is still outstanding.
    await request(app).post(`/api/requests/${first.id}/waive`).set('Cookie', advisor).send({ reason: 'Not employed in 2026' });
    await db.update(schema.requests).set({ status: 'submitted' }).where(eq(schema.requests.id, second.id));

    const result = await runReminders({ today: due, timeZone: TZ });
    expect(result.items).toBe(0);
  });

  it('does not chase a deactivated client', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const created = await request(app)
      .post(`/api/engagements/${fx.client1a.engagement}/requests`)
      .set('Cookie', advisor)
      .send({ items: [{ title: 'W-2' }] });
    await setDue((created.body as Array<{ id: string }>)[0].id, '2026-04-15');
    await request(app).post(`/api/clients/${fx.client1a.id}/deactivate`).set('Cookie', advisor);

    const result = await runReminders({ today: '2026-04-15', timeZone: TZ });
    expect(result.items).toBe(0);
  });

  it('cannot send a client two emails for the same day, however often it runs', async () => {
    process.env.SMTP_URL = 'smtps://user:pw@smtp.example.com:465';
    try {
      const advisor = await loginAs(fx, 'provider1');
      const created = await request(app)
        .post(`/api/engagements/${fx.client1a.engagement}/requests`)
        .set('Cookie', advisor)
        .send({ items: [{ title: 'W-2' }] });
      const due = '2026-04-15';
      await setDue((created.body as Array<{ id: string }>)[0].id, due);

      const first = await runReminders({ today: due, timeZone: TZ });
      expect(first.emailsQueued).toBe(1);

      // A retried job, or a second worker, must not double-send.
      await runReminders({ today: due, timeZone: TZ });
      expect(await reminderEmails(fx.client1a.id, due)).toHaveLength(1);
    } finally {
      delete process.env.SMTP_URL;
    }
  });

  it('keeps one client’s reminders away from another’s', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const due = '2026-04-15';
    for (const engagement of [fx.client1a.engagement, fx.client1b.engagement]) {
      const created = await request(app)
        .post(`/api/engagements/${engagement}/requests`)
        .set('Cookie', advisor)
        .send({ items: [{ title: 'W-2' }] });
      await setDue((created.body as Array<{ id: string }>)[0].id, due);
    }

    const result = await runReminders({ today: due, timeZone: TZ });
    expect(result.clients).toBe(2);
    expect(await notificationsFor(fx.client1a.id)).toHaveLength(1);
    expect(await notificationsFor(fx.client1b.id)).toHaveLength(1);
  });
});
