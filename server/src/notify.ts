/**
 * In-app notifications, and the email that may follow one.
 *
 * Two rules hold this together:
 *
 *  1. **The badge is the server's** (invariant 15). The browser counts nothing;
 *     it reads `GET /notifications` and shows what it is told. A count computed
 *     in one tab is wrong in the other one.
 *  2. **A notification is not an email.** It is read inside a session by the
 *     person it belongs to, so it may name the item it is about. The email that
 *     may accompany it says only that something is waiting — an inbox is not a
 *     confidential channel.
 *
 * Until the 2026-10-28 audit no workflow event emailed anyone: a client had to
 * sign in to find out a checklist existed or a file was sent back, and the
 * advisor had to sign in to find out anything had arrived. The email is now
 * queued here, beside the notification it accompanies, so a new kind of notice
 * cannot be added without deciding whether it earns one (`EMAILED`).
 *
 * The email is **coalesced**: one per recipient per window (`NOTICE_WINDOW_MS`),
 * keyed on the window, sent when the window closes. A ten-line checklist, a
 * correction and a message in the same ten minutes are one email to the client,
 * and a morning of uploads is one an hour to the advisor.
 *
 * Writing one never breaks the action it describes: like the audit helper, this
 * swallows its own errors. A checklist item that was created but whose notice
 * failed is a small problem; a 500 on "add items" because the notice failed is
 * a bigger one.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from './db/client.js';
import { appBaseUrl } from './auth/tokens.js';
import { isMailConfigured, queueEmail, type MailTemplate } from './jobs/mail.js';

export type NotificationType =
  /* → the client */
  | 'request.created'
  | 'request.correction'
  | 'request.accepted'
  | 'deliverable.shared'
  | 'reminder.due'
  /* The re-scan found something and the file was removed: send it again. */
  | 'upload.refused'
  /* → the advisor */
  | 'upload.received'
  | 'upload.quarantined'
  /* The client took back a file before it was decided. In-app only: nothing to act on. */
  | 'upload.withdrawn'
  /* The scanner never answered for one file; it needs a person (System status). */
  | 'scan.stuck'
  | 'request.not_applicable'
  | 'message.new';

export interface NotificationInput {
  userKind: 'provider' | 'client';
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  /** An in-app path, never an absolute URL: it is followed inside a session. */
  link?: string | null;
}

export interface NotifyOptions {
  /** False keeps it in-app only. The demo seed uses it: its addresses are not real people. */
  email?: boolean;
}

/**
 * The notices that are worth an email. Left out on purpose: `request.accepted`
 * (good news can wait for the next sign-in, and it is the most frequent event
 * of all) and `reminder.due` (the reminder job sends its own, one per client
 * per day, under its own key).
 */
const EMAILED: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'request.created',
  'request.correction',
  'deliverable.shared',
  'message.new',
  'upload.received',
  'upload.refused',
  'upload.quarantined',
  'scan.stuck',
  'request.not_applicable',
]);

/** How long a recipient's notices are gathered before one email goes out. */
export const NOTICE_WINDOW_MS: Record<NotificationInput['userKind'], number> = {
  client: 10 * 60_000,
  provider: 60 * 60_000,
};

/** The start of the window `at` falls in, for this kind of recipient. */
export function noticeWindow(userKind: NotificationInput['userKind'], at: Date): Date {
  const size = NOTICE_WINDOW_MS[userKind];
  return new Date(Math.floor(at.getTime() / size) * size);
}

/** The queue key that makes a window one email, however many notices land in it. */
export function noticeEmailKey(userKind: NotificationInput['userKind'], userId: string, at: Date): string {
  return `notice:${userKind}:${userId}:${noticeWindow(userKind, at).toISOString()}`;
}

function templateFor(input: NotificationInput): MailTemplate {
  if (input.userKind === 'provider') return 'advisor_activity';
  return input.type === 'request.correction' || input.type === 'upload.refused' ? 'needs_attention' : 'new_item';
}

/**
 * Where the email goes, or null when it should not go at all: a deactivated
 * account cannot sign in, and a client who has not accepted their invitation
 * yet cannot either — the invitation is the email that matters to them.
 */
async function recipientOf(input: NotificationInput): Promise<{ to: string; firmName?: string } | null> {
  if (input.userKind === 'client') {
    const [row] = await db
      .select({
        email: schema.clients.email,
        passwordHash: schema.clients.passwordHash,
        deactivatedAt: schema.clients.deactivatedAt,
        firmName: schema.providers.firmName,
      })
      .from(schema.clients)
      .innerJoin(schema.providers, eq(schema.providers.id, schema.clients.providerId))
      .where(eq(schema.clients.id, input.userId));
    if (!row || row.deactivatedAt || !row.passwordHash) return null;
    return { to: row.email, firmName: row.firmName ?? undefined };
  }
  const [row] = await db
    .select({ email: schema.providers.email, deactivatedAt: schema.providers.deactivatedAt, firmName: schema.providers.firmName })
    .from(schema.providers)
    .where(eq(schema.providers.id, input.userId));
  if (!row || row.deactivatedAt) return null;
  return { to: row.email, firmName: row.firmName ?? undefined };
}

async function emailFor(input: NotificationInput, now: Date): Promise<void> {
  if (!EMAILED.has(input.type) || !isMailConfigured()) return;
  const recipient = await recipientOf(input);
  if (!recipient) return;
  const windowStart = noticeWindow(input.userKind, now);
  await queueEmail(
    {
      template: templateFor(input),
      to: recipient.to,
      firmName: recipient.firmName,
      link: input.userKind === 'provider' ? `${appBaseUrl()}/work` : `${appBaseUrl()}/portal`,
    },
    {
      dedupeKey: noticeEmailKey(input.userKind, input.userId, now),
      runAt: new Date(windowStart.getTime() + NOTICE_WINDOW_MS[input.userKind]),
    }
  );
}

export async function notify(input: NotificationInput, options: NotifyOptions = {}): Promise<void> {
  try {
    await db.insert(schema.notifications).values({
      userKind: input.userKind,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    });
  } catch (err) {
    console.error('[notify] could not record a notification:', err instanceof Error ? err.message : err);
  }
  if (options.email === false) return;
  try {
    await emailFor(input, new Date());
  } catch (err) {
    console.error('[notify] could not queue the email for a notification:', err instanceof Error ? err.message : err);
  }
}

/** One insert for a batch; same swallow-your-own-errors rule. In-app only — its one caller emails for itself. */
export async function notifyMany(inputs: NotificationInput[]): Promise<void> {
  if (inputs.length === 0) return;
  try {
    await db.insert(schema.notifications).values(
      inputs.map((input) => ({
        userKind: input.userKind,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
      }))
    );
  } catch (err) {
    console.error('[notify] could not record notifications:', err instanceof Error ? err.message : err);
  }
}
