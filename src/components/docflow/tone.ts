import type { RequestItem, RequestStatus } from '@/api/types';
import { lookOf, type TileLook } from './board/whoseMove';

/**
 * The colour of a checklist line, and it is the same colour everywhere a line
 * appears — the advisor's checklist, the work queue, search, a client's next
 * steps — so a glance down any list reads the same way:
 *
 *   amber  still needed from the client
 *   red    overdue, or sent back for a better copy
 *   blue   with the advisor: sent and waiting to be reviewed, or the client
 *          says they do not have it and the advisor has to decide
 *   green  accepted
 *   grey   waived, not needed
 *
 * The board tiles draw the same states; this adds overdue, which on a list row
 * is worth a colour of its own rather than a word at the end.
 *
 * One exception, by side: in the client's portal a line with the accountant is
 * a lighter green, not blue — their part is done. That is done in the
 * stylesheet (`.df-portal`), so the tone of a line is the same on both sides.
 */
export type Tone = TileLook | 'overdue';

type Line = Pick<RequestItem, 'status'> & {
  clientResponseKind?: RequestItem['clientResponseKind'];
  /** Past its due date. Only colours a line that is still with the client. */
  overdue?: boolean;
};

export function toneOf(line: Line): Tone {
  const look = lookOf({ status: line.status, clientResponseKind: line.clientResponseKind ?? null });
  return look === 'needed' && line.overdue ? 'overdue' : look;
}

/** The classes that draw a row or card in its line's colour. */
export const toneClass = (tone: Tone) => `df-tone df-tone-${tone}`;

/** The pill for each tone, for the places that show one beside the row's own. */
export const TONE_PILL: Record<Tone, string> = {
  needed: 'df-warn',
  overdue: 'df-danger',
  sent_back: 'df-danger',
  decision: 'df-info',
  with_firm: 'df-info',
  accepted: 'df-ok',
  waived: 'df-plain',
};

/** The advisor's words for a line's status, and their colours. */
export const STATUS_PILL: Record<RequestStatus, { label: string; cls: string }> = {
  requested: { label: 'Requested', cls: TONE_PILL.needed },
  submitted: { label: 'Submitted', cls: TONE_PILL.with_firm },
  in_review: { label: 'In review', cls: TONE_PILL.with_firm },
  needs_correction: { label: 'Needs correction', cls: TONE_PILL.sent_back },
  accepted: { label: 'Accepted', cls: TONE_PILL.accepted },
  waived: { label: 'Waived', cls: TONE_PILL.waived },
};

/** Past due, by the server's rule: still waiting on the client, and the date has gone. */
export const isPastDue = (line: Pick<RequestItem, 'status'> & { dueDate?: Date | null }, now = Date.now()) =>
  (line.status === 'requested' || line.status === 'needs_correction') &&
  line.dueDate != null &&
  line.dueDate.getTime() < now;
