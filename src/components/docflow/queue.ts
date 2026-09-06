/**
 * The home queue's vocabulary, in one place so the tiles on `/` and the list on
 * `/work` cannot drift apart — and out of a component file so fast refresh
 * keeps working.
 *
 * The buckets deliberately overlap: an overdue item is also waiting on the
 * client. They are five different questions about the same rows, not five
 * disjoint piles.
 */
export type QueueFilter = 'ready' | 'waiting' | 'overdue' | 'unread' | 'needs_decision';

export const QUEUE_FILTERS: QueueFilter[] = ['ready', 'waiting', 'overdue', 'needs_decision', 'unread'];

export const QUEUE_TITLE: Record<QueueFilter, string> = {
  ready: 'Ready to review',
  waiting: 'Waiting on clients',
  overdue: 'Overdue',
  unread: 'Unread messages',
  needs_decision: 'Needs your decision',
};

export const QUEUE_EXPLAIN: Record<QueueFilter, string> = {
  ready: 'The client has sent something and it is waiting on you.',
  waiting: 'Asked for, not yet answered.',
  overdue: 'Waiting on the client and past the due date.',
  unread: 'Messages from clients you have not read.',
  needs_decision: 'The client says they do not have this. Waive it with a reason, or leave it on the list.',
};

export const isQueueFilter = (v: string | null): v is QueueFilter =>
  Boolean(v) && QUEUE_FILTERS.includes(v as QueueFilter);
