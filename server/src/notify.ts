/**
 * In-app notifications.
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
 * Writing one never breaks the action it describes: like the audit helper, this
 * swallows its own errors. A checklist item that was created but whose notice
 * failed is a small problem; a 500 on "add items" because the notice failed is
 * a bigger one.
 */
import { db, schema } from './db/client.js';

export type NotificationType =
  /* → the client */
  | 'request.created'
  | 'request.correction'
  | 'request.accepted'
  | 'deliverable.shared'
  | 'reminder.due'
  /* → the advisor */
  | 'upload.received'
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

export async function notify(input: NotificationInput): Promise<void> {
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
}

/** One insert for a batch; same swallow-your-own-errors rule. */
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
