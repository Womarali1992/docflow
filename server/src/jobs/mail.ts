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

/**
 * The four notices the pilot sends. Deliberately generic: an inbox is not a
 * confidential channel, so no filenames, amounts, categories or message text —
 * the notice says something is waiting and links to the portal.
 */
export const MAIL_TEMPLATES = ['invitation', 'password_reset', 'new_item', 'needs_attention'] as const;
export type MailTemplate = (typeof MAIL_TEMPLATES)[number];

export interface MailJobPayload extends Record<string, unknown> {
  template: MailTemplate;
  to: string;
  /** The one-time link, for the templates that carry one. */
  link?: string;
  /** Who it is from, for the body's sign-off. Never a client's name. */
  firmName?: string;
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
 * Queues a notice, or does nothing when SMTP is not configured or the address
 * is empty. Returns whether a job was created so the route can answer honestly.
 */
export async function enqueueEmail(payload: MailJobPayload, opts: { dedupeKey?: string; runAt?: Date } = {}): Promise<boolean> {
  if (!isMailConfigured()) return false;
  if (!payload.to || !payload.to.includes('@')) return false;
  await enqueue('email', { ...payload }, opts);
  return true;
}
