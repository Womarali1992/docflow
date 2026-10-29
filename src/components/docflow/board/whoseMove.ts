import type { RequestItem } from '@/api/types';

/**
 * Whose move a checklist line is — the one question the boards answer.
 *
 * Every open line is with exactly one party: the client owes it, the advisor
 * has something to do with it, or it is settled. The colours are fixed across
 * the app (amber with the client, blue with the advisor, green settled) so a
 * glance means the same thing on the engagement page, the client's portal and
 * the Today queue.
 *
 * "I don't have this" moves a line to the advisor even though its status is
 * still `requested`: only the advisor can take it off the list.
 */
export type Move = 'client' | 'firm' | 'done';

/** How a tile is drawn: an empty slot, a document that has arrived, or a settled line. */
export type TileLook = 'needed' | 'sent_back' | 'decision' | 'with_firm' | 'accepted' | 'waived';

/** Who is looking: the same line reads "Your move" to the advisor and "With your accountant" to the client. */
export type Perspective = 'advisor' | 'client';

type Line = Pick<RequestItem, 'status' | 'clientResponseKind'>;

export function moveOf(line: Line): Move {
  if (line.status === 'accepted' || line.status === 'waived') return 'done';
  if (line.status === 'submitted' || line.status === 'in_review') return 'firm';
  return line.clientResponseKind ? 'firm' : 'client';
}

export function lookOf(line: Line): TileLook {
  switch (line.status) {
    case 'accepted':
      return 'accepted';
    case 'waived':
      return 'waived';
    case 'submitted':
    case 'in_review':
      return 'with_firm';
    default:
      if (line.clientResponseKind) return 'decision';
      return line.status === 'needs_correction' ? 'sent_back' : 'needed';
  }
}

export interface MoveTally {
  client: number;
  firm: number;
  done: number;
  total: number;
}

export function tally(lines: Line[]): MoveTally {
  const out: MoveTally = { client: 0, firm: 0, done: 0, total: lines.length };
  for (const line of lines) out[moveOf(line)] += 1;
  return out;
}

export const MOVE_LABEL: Record<Perspective, Record<Move, string>> = {
  advisor: { client: 'With the client', firm: 'Your move', done: 'Settled' },
  client: { client: 'Your turn', firm: 'With your accountant', done: 'Done' },
};

/* The client's words match the portal's own state labels (requestState.ts). */
export const LOOK_LABEL: Record<Perspective, Record<TileLook, string>> = {
  advisor: {
    needed: 'Requested',
    sent_back: 'Sent back',
    decision: 'Says they don’t have it',
    with_firm: 'To review',
    accepted: 'Accepted',
    waived: 'Waived',
  },
  client: {
    needed: 'Waiting on you',
    sent_back: 'Needs another look',
    decision: 'You said you don’t have it',
    with_firm: 'Submitted',
    accepted: 'Accepted',
    waived: 'Not needed',
  },
};
