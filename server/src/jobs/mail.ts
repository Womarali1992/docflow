/**
 * What the API process needs to know about email: which notices exist, whether
 * a mail server is configured, and how to queue one. The transport itself lives
 * in `handlers/email.ts` so only the worker pulls nodemailer in.
 *
 * R13: email is a convenience, never a dependency. Every invitation and reset
 * also returns a copy-link, and with `SMTP_URL` unset nothing is queued at all
 * (`emailQueued: false`), so onboarding works before the firm mailbox exists.
 */
import { enqueue } from './queue.js';
import type { Job } from '../db/schema.js';

/**
 * The notices the pilot sends. Deliberately generic: an inbox is not a
 * confidential channel, so no filenames, amounts, categories or message text —
 * the notice says something is waiting and links to the portal.
 *
 * `ops_digest` is the one that goes the other way — to the firm, about the
 * firm's own machine (H7). It carries sentences rather than a link, and the
 * same rule still applies: counts and states, never a client.
 */
export const MAIL_TEMPLATES = ['invitation', 'password_reset', 'new_item', 'needs_attention', 'ops_digest'] as const;
export type MailTemplate = (typeof MAIL_TEMPLATES)[number];

export interface MailJobPayload extends Record<string, unknown> {
  template: MailTemplate;
  to: string;
  /** The one-time link, for the templates that carry one. */
  link?: string;
  /** Who it is from, for the body's sign-off. Never a client's name. */
  firmName?: string;
  /** What is wrong, for `ops_digest`. Sentences about the system, never about a client. */
  items?: string[];
}

/** True when a mail server is configured; drives `emailQueued` in the API answers. */
export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_URL);
}

/** The From address. `MAIL_FROM` wins; otherwise a sensible local default. */
export function mailFrom(): string {
  return process.env.MAIL_FROM || 'DocFlow <docflow@localhost>';
}

/**
 * Queues a notice and hands back the row, or null when SMTP is not configured,
 * the address is unusable, or the same `dedupeKey` is already on the queue.
 *
 * The third case is why this exists beside `enqueueEmail`. A caller that wants
 * to report "the notice is on its way" cannot tell an already-queued duplicate
 * from a new job and does not need to; a caller that is *counting* what it sent
 * — the daily digest, which must not double-send after a retry — very much does
 * (H7).
 */
export async function queueEmail(payload: MailJobPayload, opts: { dedupeKey?: string; runAt?: Date } = {}): Promise<Job | null> {
  if (!isMailConfigured()) return null;
  if (!payload.to || !payload.to.includes('@')) return null;
  return enqueue('email', { ...payload }, opts);
}

/**
 * Queues a notice, or does nothing when SMTP is not configured or the address
 * is empty. Returns whether the notice is on the queue — which is true whether
 * this call put it there or an earlier one with the same key did, because to
 * the route answering `emailQueued` those are the same fact.
 */
export async function enqueueEmail(payload: MailJobPayload, opts: { dedupeKey?: string; runAt?: Date } = {}): Promise<boolean> {
  if (!isMailConfigured()) return false;
  if (!payload.to || !payload.to.includes('@')) return false;
  await queueEmail(payload, opts);
  return true;
}
