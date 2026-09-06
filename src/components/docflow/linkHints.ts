/**
 * The line under a one-time link, which has to tell the advisor the truth about
 * delivery: with a mail server configured the notice is already queued, without
 * one the copy-link is the only way it reaches the client (C1.4 / R13).
 *
 * Plain module, not a component file, so the react-refresh lint stays quiet.
 */

/** Where the invitation was made from — it changes only the closing sentence. */
export type InviteContext = 'new-client' | 'client-page';

const CLOSING: Record<InviteContext, string> = {
  'new-client': 'You can make a new one from their page at any time.',
  'client-page': 'Any earlier invitation link stops working.',
};

/** `emailQueued` comes straight from the server — never assume mail is configured. */
export function invitationHint(emailQueued: boolean, context: InviteContext): string {
  const lead = emailQueued
    ? 'We have emailed this link to the client. It sets their password and walks them through two-step verification. You can also send it yourself if the email does not arrive.'
    : 'Send this link to the client. It sets their password and walks them through two-step verification.';
  return `${lead} ${CLOSING[context]}`;
}

export function resetHint(emailQueued: boolean): string {
  const what = 'Using it sets a new password and signs them out everywhere.';
  return emailQueued
    ? `We have emailed this link to the client. ${what} You can also hand it over yourself if the email does not arrive.`
    : `Hand this to the client. ${what}`;
}
