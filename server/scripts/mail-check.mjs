#!/usr/bin/env node
/**
 * Does the configured SMTP account actually work?
 *
 * Email is sent by the worker, from a queued job. That is the right design and
 * a bad diagnostic: a wrong SMTP_URL doesn't surface as an error anywhere a
 * person is looking — the invitation just never arrives, while the job retries
 * on the 1 m / 5 m / 15 m / hourly ladder inside the worker log. This asks the
 * question directly, before anyone sends a real invitation.
 *
 *   node scripts/mail-check.mjs                    # connect + authenticate only
 *   node scripts/mail-check.mjs --to me@place.com  # ...and send one real message
 *
 * Nothing here touches the database or the queue.
 */
import nodemailer from 'nodemailer';
import { argValue, isMain } from './lib.mjs';

/** Hide the password in an SMTP URL so the connection can be printed. */
function redact(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '<unparseable SMTP_URL>';
  }
}

export async function mailCheck({ to } = {}) {
  const url = process.env.SMTP_URL;
  if (!url) {
    return {
      configured: false,
      detail:
        'SMTP_URL is not set in server/.env — invitations and resets stay copy-link only, ' +
        'which works: the advisor sends the link themselves.',
    };
  }

  const from = process.env.MAIL_FROM || 'DocFlow <docflow@localhost>';
  // A diagnostic that hangs is not a diagnostic: an unreachable host would
  // otherwise sit in TCP retry for the OS default.
  const transport = nodemailer.createTransport(url, {
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
  const result = { configured: true, url: redact(url), from };

  try {
    await transport.verify();
    result.connection = 'ok';
  } catch (err) {
    result.connection = 'failed';
    result.error = err.message;
    return result;
  }

  if (to) {
    try {
      const info = await transport.sendMail({
        from,
        to,
        subject: 'DocFlow test message',
        text:
          'This is a test from scripts/mail-check.mjs.\n\n' +
          'If you are reading it, DocFlow can send mail: invitations, password ' +
          'resets and notices will go out on their own from now on.\n',
      });
      result.sent = { to, messageId: info.messageId, response: info.response };
    } catch (err) {
      result.sent = 'failed';
      result.error = err.message;
    }
  }

  transport.close?.();
  return result;
}

if (isMain(import.meta.url)) {
  try {
    const out = await mailCheck({ to: argValue('--to') });
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    const bad = out.connection === 'failed' || out.sent === 'failed';
    process.exit(bad ? 1 : 0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
