import type { DashboardRequestRef, DashboardSummary } from '@/api/types';
import { toneOf, type Tone } from '../tone';

/**
 * The Today board, as data: one row per checklist line, and the column its card
 * sits in — with the client, with you, or done this week.
 *
 * Built only from the `GET /dashboard` read the count tiles come from, so a card
 * cannot disagree with a number. "I don't have this" lines are in the server's
 * waiting bucket (they are still `requested`), but they sit in "Your move":
 * only the advisor can take one off the list. A line being looked at
 * (`in_review`) is in no bucket and so on no row, as in the tiles.
 */

export type Column = 'client' | 'firm' | 'done';

export const COLUMNS: Column[] = ['client', 'firm', 'done'];

export interface BoardItem {
  item: DashboardRequestRef;
  column: Column;
  tone: Tone;
  /** What the card says. */
  label: string;
}

const formatDue = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/**
 * Every line the board could show, most pressing first: your move (oldest
 * first), then the client's (as the queue orders them: soonest due first),
 * then done (newest first).
 */
export function boardItems(data: DashboardSummary): BoardItem[] {
  const decided = new Set(data.needsDecision.ids);
  const late = new Set(data.overdue.ids);

  const firm: BoardItem[] = [
    ...data.needsDecision.items.map((item): BoardItem => ({ item, column: 'firm', tone: 'decision', label: 'Your decision' })),
    ...data.readyToReview.items.map((item): BoardItem => ({ item, column: 'firm', tone: 'with_firm', label: 'To review' })),
  ].sort((a, b) => a.item.since.getTime() - b.item.since.getTime());

  const client = data.waitingOnClients.items
    .filter((item) => !decided.has(item.id))
    .map((item): BoardItem => {
      const tone = toneOf({ status: item.status, overdue: late.has(item.id) });
      const label =
        tone === 'sent_back' ? 'Sent back' : tone === 'overdue' ? 'Overdue' : item.dueDate ? `Due ${formatDue(item.dueDate)}` : 'Requested';
      return { item, column: 'client', tone, label };
    });

  const done = (data.recentlyDone?.items ?? []).map((item): BoardItem => {
    const tone = toneOf({ status: item.status });
    return { item, column: 'done', tone, label: tone === 'waived' ? 'Waived' : 'Accepted' };
  });

  return [...firm, ...client, ...done];
}

/** How many cards are in each column in all, shown or not. */
export function columnTotals(all: BoardItem[]): Record<Column, number> {
  const totals = { client: 0, firm: 0, done: 0 };
  for (const b of all) totals[b.column] += 1;
  return totals;
}

/** On a first fill, how many rows each column gets before the rest are shared out. */
const FIRST_FILL: Record<Column, number> = { firm: 3, client: 3, done: 2 };

/**
 * Which lines get a row, and in what order.
 *
 * Rows hold still while the page is open: a card slides along its own row, and
 * that only reads as movement if the row does not jump too. So rows already on
 * the board (`keep`, in their order) stay for as long as their line is in any
 * column, and new lines only fill free rows at the bottom.
 *
 * A first fill (nothing kept) puts what changed since the last visit first —
 * `seen` says which column a line's card was in then — because that is the news
 * the board is about to animate; then a few from each column, so "done" is not
 * crowded out by a long queue; then the rest by how pressing they are.
 */
export function pickRows(
  all: BoardItem[],
  keep: string[],
  seen: (id: string) => Column | undefined,
  cap: number
): BoardItem[] {
  const byId = new Map(all.map((b) => [b.item.id, b]));
  const rows = keep.filter((id) => byId.has(id)).map((id) => byId.get(id) as BoardItem);
  const taken = new Set(rows.map((b) => b.item.id));
  const take = (b: BoardItem) => {
    if (rows.length >= cap || taken.has(b.item.id)) return;
    rows.push(b);
    taken.add(b.item.id);
  };

  if (keep.length === 0) {
    for (const b of all) {
      const was = seen(b.item.id);
      if (was && was !== b.column) take(b);
    }
    for (const column of ['firm', 'client', 'done'] as Column[]) {
      all.filter((b) => b.column === column).slice(0, FIRST_FILL[column]).forEach(take);
    }
  }
  all.forEach(take);
  return rows;
}
