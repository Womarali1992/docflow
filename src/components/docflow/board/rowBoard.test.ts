import { describe, expect, it } from 'vitest';
import type { DashboardRequestRef, DashboardSummary, RequestStatus } from '@/api/types';
import { boardItems, columnTotals, pickRows, type Column } from './rowBoard';

let clock = 0;
const ref = (id: string, status: RequestStatus, extra: Partial<DashboardRequestRef> = {}): DashboardRequestRef => ({
  id,
  clientId: `client-${id}`,
  engagementId: `eng-${id}`,
  engagementTitle: '2026 Individual Tax Return',
  title: `Line ${id}`,
  status,
  dueDate: null,
  since: new Date(Date.UTC(2026, 9, 1) + (clock += 1) * 60_000),
  ...extra,
});

const bucket = (items: DashboardRequestRef[]) => ({ count: items.length, ids: items.map((i) => i.id), items });

function summary(parts: Partial<Record<'ready' | 'waiting' | 'overdue' | 'decision' | 'done', DashboardRequestRef[]>>): DashboardSummary {
  return {
    generatedAt: '2026-10-29T12:00:00Z',
    readyToReview: bucket(parts.ready ?? []),
    waitingOnClients: bucket(parts.waiting ?? []),
    overdue: bucket(parts.overdue ?? []),
    needsDecision: bucket(parts.decision ?? []),
    unreadMessages: bucket([]),
    recentlyDone: bucket(parts.done ?? []),
  } as DashboardSummary;
}

const never = () => undefined;
const ids = (rows: { item: { id: string } }[]) => rows.map((r) => r.item.id);

describe('the Today board as rows', () => {
  it('puts each line in the column of whoever acts next', () => {
    const said = ref('n', 'requested');
    const late = ref('o', 'requested', { dueDate: new Date('2026-09-01') });
    const all = boardItems(
      summary({
        ready: [ref('r', 'submitted')],
        waiting: [ref('w', 'requested'), ref('s', 'needs_correction'), late, said],
        overdue: [late],
        decision: [said],
        done: [ref('a', 'accepted'), ref('v', 'waived')],
      })
    );
    const at = (id: string) => all.find((b) => b.item.id === id);

    expect(at('w')).toMatchObject({ column: 'client', tone: 'needed', label: 'Requested' });
    expect(at('s')).toMatchObject({ column: 'client', tone: 'sent_back', label: 'Sent back' });
    expect(at('o')).toMatchObject({ column: 'client', tone: 'overdue', label: 'Overdue' });
    // "I don't have this" is still `requested`, but only the advisor can act on it.
    expect(at('n')).toMatchObject({ column: 'firm', tone: 'decision', label: 'Your decision' });
    expect(at('r')).toMatchObject({ column: 'firm', tone: 'with_firm', label: 'To review' });
    expect(at('a')).toMatchObject({ column: 'done', tone: 'accepted', label: 'Accepted' });
    expect(at('v')).toMatchObject({ column: 'done', tone: 'waived', label: 'Waived' });
    // Every line once: the decision is not counted again as waiting.
    expect(all).toHaveLength(7);
    expect(columnTotals(all)).toEqual({ client: 3, firm: 2, done: 2 });
  });

  it('gives every column a few rows on a first look, so a long queue does not crowd out "done"', () => {
    const waiting = Array.from({ length: 12 }, (_, i) => ref(`w${i}`, 'requested'));
    const all = boardItems(summary({ waiting, ready: [ref('r', 'submitted')], done: [ref('a', 'accepted')] }));
    const rows = pickRows(all, [], never, 8);

    expect(rows).toHaveLength(8);
    expect(rows.map((r) => r.column)).toEqual(['firm', 'client', 'client', 'client', 'done', 'client', 'client', 'client']);
  });

  it('leads a first look with what moved since the last visit', () => {
    const waiting = Array.from({ length: 10 }, (_, i) => ref(`w${i}`, 'requested'));
    const accepted = ref('a', 'accepted');
    const all = boardItems(summary({ waiting, done: [ref('older', 'accepted'), ref('old2', 'accepted'), accepted] }));
    const seen = (id: string): Column | undefined => (id === 'a' ? 'firm' : undefined);

    expect(ids(pickRows(all, [], seen, 4))[0]).toBe('a');
  });

  it('keeps rows where they are while the page is open, so a card moves along its own row', () => {
    const before = boardItems(summary({ waiting: [ref('x', 'requested'), ref('y', 'requested')], ready: [ref('z', 'submitted')] }));
    const first = ids(pickRows(before, [], never, 8));
    expect(first).toEqual(['z', 'x', 'y']);

    // x is sent; z is accepted. Neither row moves, and a new line takes the next free row.
    const after = boardItems(
      summary({ waiting: [ref('y', 'requested'), ref('new', 'requested')], ready: [ref('x', 'submitted')], done: [ref('z', 'accepted')] })
    );
    const rows = pickRows(after, first, never, 8);
    expect(ids(rows)).toEqual(['z', 'x', 'y', 'new']);
    expect(rows.map((r) => r.column)).toEqual(['done', 'firm', 'client', 'client']);
  });

  it('drops a row whose line has left every column', () => {
    const all = boardItems(summary({ waiting: [ref('y', 'requested')] }));
    expect(ids(pickRows(all, ['gone', 'y'], never, 8))).toEqual(['y']);
  });
});
