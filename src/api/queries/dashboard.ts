/**
 * The advisor's home queue.
 *
 * Every number here is counted from live rows on the server (invariant 15).
 * The browser's job is to show them and to open the list behind one — never to
 * add up its own idea of what is overdue.
 *
 * Once the firm has a second active advisor the queue is "mine" by default and
 * "everyone" on request (FIRM-BOOK-PLAN F6). The choice lives in `?who=` so a
 * link or a reload keeps it, and it is the server that applies it.
 */
import { useSearchParams } from 'react-router-dom';
import { api } from '../client';
import type { DashboardSummary, QueueWho } from '../types';
import { keys } from './keys';
import { useScope, useSignedIn } from './auth';
import { activeAdvisors, useFirm } from './firm';
import { POLL, useLiveQuery } from './live';

/**
 * Whose work this page shows, from `?who=`. With one active advisor there is no
 * choice to make and no toggle: it is always everything. `ready` is false until
 * the team is known, so the queue is not fetched once for "all" and again for
 * "mine" a moment later.
 */
export function useQueueWho(): { who: QueueWho; setWho: (who: QueueWho) => void; shared: boolean; ready: boolean } {
  const [params, setParams] = useSearchParams();
  const { data: firm, isPending } = useFirm();
  const shared = activeAdvisors(firm).length > 1;
  const asked = params.get('who');
  const who: QueueWho = !shared ? 'all' : asked === 'all' || asked === 'mine' ? asked : 'mine';
  const setWho = (next: QueueWho) =>
    setParams(
      (current) => {
        const out = new URLSearchParams(current);
        out.set('who', next);
        return out;
      },
      { replace: true }
    );
  return { who, setWho, shared, ready: !isPending };
}

export function useDashboard(options?: { live?: boolean; who?: QueueWho; ready?: boolean }) {
  const scope = useScope();
  const signedIn = useSignedIn();
  const who = options?.who ?? 'all';
  return useLiveQuery<DashboardSummary>({
    key: keys.dashboard(scope, who),
    fetch: ({ poll }) => api.dashboard.get({ poll, who }),
    intervalMs: options?.live === false ? undefined : POLL.queue,
    enabled: signedIn && (options?.ready ?? true),
  });
}
