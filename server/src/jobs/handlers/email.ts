/**
 * The email job handler: renders one of the generic notices and hands it to
 * nodemailer.
 *
 * Two rules the templates exist to enforce:
 *   - nothing confidential in the body (no filenames, amounts, categories,
 *     message text or other client names) — an inbox is not the portal;
 *   - the portal link is the call to action, so a stale email is harmless.
 *
 * With `SMTP_URL` unset the handler logs and returns `skipped` rather than
 * failing: the copy-link path is the supported way to run without a mailbox,
 * and a queue full of red rows would hide real problems.
 */
import nodemailer from 'nodemailer';
import type { Job } from '../../db/schema.js';
import { MAIL_TEMPLATES, mailFrom, type MailJobPayload, type MailTemplate } from '../mail.js';
import { appBaseUrl } from '../../auth/tokens.js';

export interface Envelope {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** The minimum of nodemailer's transport this handler uses; the test passes a stub. */
export interface MailTransport {
  sendMail(message: Envelope): Promise<unknown>;
}

export type MailResult = 'sent' | 'skipped';

let cached: { url: string; transport: MailTransport } | null = null;

/** One pooled transport per process, rebuilt if `SMTP_URL` changes (tests do that). */
export function transportFromEnv(): MailTransport | null {
  const url = process.env.SMTP_URL;
  if (!url) {
    cached = null;
    return null;
  }
  if (!cached || cached.url !== url) {
    cached = { url, transport: nodemailer.createTransport(url) as unknown as MailTransport };
  }
  return cached.transport;
}

function isTemplate(value: unknown): value is MailTemplate {
  return typeof value === 'string' && (MAIL_TEMPLATES as readonly string[]).includes(value);
}

/** Reads a job payload back as mail input; throws on anything unusable so the job fails loudly. */
export function parsePayload(payload: unknown): MailJobPayload {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (!isTemplate(p.template)) throw new Error(`Unknown email template: ${String(p.template)}`);
  if (typeof p.to !== 'string' || !p.to.includes('@')) throw new Error('Email job has no usable recipient');
  return {
    template: p.template,
    to: p.to,
    link: typeof p.link === 'string' ? p.link : undefined,
    firmName: typeof p.firmName === 'string' ? p.firmName : undefined,
    /* Filtered, not trusted: a payload is a database row, and a digest with a
       number where a sentence should be must not render as "undefined". */
    items: Array.isArray(p.items) ? p.items.filter((i): i is string => typeof i === 'string') : undefined,
  };
}

/** Renders the notice. Every body ends with the portal (or one-time) link and a fixed sign-off. */
export function render(payload: MailJobPayload): { subject: string; text: string } {
  const from = payload.firmName?.trim() || 'your accountant';
  const portal = appBaseUrl();
  const signoff = `\n\nThis message was sent by DocFlow on behalf of ${from}. Please do not reply to it.\n`;

  switch (payload.template) {
    case 'invitation':
      return {
        subject: 'Your secure document portal is ready',
        text:
          `${from} has set up a secure portal for exchanging documents with you.\n\n` +
          `Open this link to choose a password and set up your sign-in code:\n${payload.link ?? portal}\n\n` +
          `The link works once and expires in 7 days. If it has expired, ask ${from} for a new one.` +
          signoff,
      };
    case 'password_reset':
      return {
        subject: 'Reset your DocFlow password',
        text:
          `Someone asked to reset the password for your DocFlow portal.\n\n` +
          `Open this link to choose a new one:\n${payload.link ?? portal}\n\n` +
          `The link works once and expires in 1 hour. If you did not ask for this, you can ignore this message — ` +
          `your password has not changed.` +
          signoff,
      };
    case 'new_item':
      return {
        subject: 'You have a new item in your DocFlow portal',
        text:
          `There is something new waiting for you in your secure portal.\n\n` +
          `Sign in to see it:\n${payload.link ?? portal}` +
          signoff,
      };
    case 'needs_attention':
      return {
        subject: 'A document needs your attention',
        text:
          `One of your documents needs another look.\n\n` +
          `Sign in to your secure portal for the details:\n${payload.link ?? portal}` +
          signoff,
      };
    /* The one notice that goes to the firm rather than to a client, so it says
       what is wrong outright — these are facts about the machine, and an
       accountant who has to sign in to find out what the email meant will stop
       reading the email. The count is in the subject because that is all a
       phone lock screen shows (H7). */
    case 'ops_digest': {
      const items = payload.items ?? [];
      return {
        subject: `DocFlow needs attention (${items.length} item${items.length === 1 ? '' : 's'})`,
        text:
          `The DocFlow system check found ${items.length} thing${items.length === 1 ? '' : 's'} to look at:\n\n` +
          items.map((i) => `  - ${i}`).join('\n') +
          `\n\nThe full picture is on the System status page:\n${portal}/settings/system\n\n` +
          `Nothing here names a client or a document. This notice is only sent on a day when ` +
          `something needs attention.` +
          signoff,
      };
    }
  }
}

/** Sends one queued notice. `transport` is injectable so the test never opens a socket. */
export async function sendEmailJob(job: Job, transport: MailTransport | null = transportFromEnv()): Promise<MailResult> {
  const payload = parsePayload(job.payload);
  if (!transport) {
    console.log(`[worker] email job ${job.id} (${payload.template}) skipped: SMTP_URL is not set — the copy-link is the delivery path`);
    return 'skipped';
  }
  const { subject, text } = render(payload);
  await transport.sendMail({ from: mailFrom(), to: payload.to, subject, text });
  return 'sent';
}

export default sendEmailJob;
