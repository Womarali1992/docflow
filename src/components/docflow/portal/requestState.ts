import type { RequestAttachment, RequestItem } from '@/api/types';

/**
 * What a checklist line looks like *to the client* (C4.2).
 *
 * Five states, and the distinction that matters is between the first two.
 * "Submitted" and "Received, being checked" are the same row on the server —
 * a version exists — but to the person who just sent a 20 MB scan they are
 * completely different messages: one says the accountant has it, the other
 * says the file is not readable yet and no action is needed. Collapsing them
 * produces the support call this app exists to avoid.
 */
export type ClientRequestState =
  | 'waiting_on_you'
  | 'submitted'
  | 'checking'
  | 'accepted'
  | 'needs_correction'
  | 'waived';

export interface ClientStateView {
  state: ClientRequestState;
  label: string;
  cls: string;
  /** A sentence when there is something to understand; otherwise nothing. */
  note?: string;
}

export function clientRequestState(request: RequestItem, attachments: RequestAttachment[] = []): ClientStateView {
  if (request.status === 'accepted') {
    return { state: 'accepted', label: 'Accepted', cls: 'df-ok' };
  }
  if (request.status === 'waived') {
    return {
      state: 'waived',
      label: 'Not needed',
      cls: 'df-plain',
      note: request.waivedReason ? `Your accountant said: ${request.waivedReason}` : undefined,
    };
  }
  if (request.status === 'needs_correction') {
    return {
      state: 'needs_correction',
      label: 'Needs another look',
      cls: 'df-danger',
      note: 'Your accountant has asked for a corrected copy — their note is in the messages for this item.',
    };
  }
  if (request.status === 'submitted' || request.status === 'in_review') {
    /* With several attachments (H5) the line is only fully "submitted" once
       every one of them has been checked. One file still scanning is the whole
       line still scanning, because the accountant cannot read it yet either. */
    const checking = attachments.filter((a) => a.state === 'checking').length;
    if (checking > 0) {
      return {
        state: 'checking',
        label: 'Received, being checked',
        cls: 'df-warn',
        note:
          attachments.length > 1
            ? `Your files are with your accountant. ${checking} of ${attachments.length} are still being checked — they become readable once that finishes, and there is nothing more to do.`
            : 'Your file is with your accountant. It becomes readable once the security check finishes — nothing more to do.',
      };
    }
    return { state: 'submitted', label: 'Submitted', cls: 'df-info' };
  }
  return { state: 'waiting_on_you', label: 'Waiting on you', cls: 'df-warn' };
}
