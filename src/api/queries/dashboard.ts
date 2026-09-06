/**
 * The advisor's home queue.
 *
 * Every number here is counted from live rows on the server (invariant 15).
 * The browser's job is to show them and to open the list behind one — never to
 * add up its own idea of what is overdue.
 */
import { api } from '../client';
import type { DashboardSummary } from '../types';
import { keys } from './keys';
import { useScope, useSignedIn } from './auth';
import { POLL, useLiveQuery } from './live';

export function useDashboard(options?: { live?: boolean }) {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useLiveQuery<DashboardSummary>({
    key: keys.dashboard(scope),
    fetch: ({ poll }) => api.dashboard.get({ poll }),
    intervalMs: options?.live === false ? undefined : POLL.queue,
    enabled: signedIn,
  });
}
