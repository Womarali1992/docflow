/**
 * Background refresh.
 *
 * Sessions end after 30 minutes without activity (C1.1), and a screen that
 * refreshes itself every few seconds would keep a session alive forever with
 * nobody at the keyboard. The server's answer is the `X-DocFlow-Poll: 1`
 * header: the request is served, the session is *not* touched.
 *
 * So which of our requests is a poll? The rule here: **the first fetch of a key
 * is a real read, every later one is a poll.** The first fetch happens because
 * a person opened a screen; the ones after it happen because a timer fired, a
 * window regained focus, or a mutation invalidated the key — and in that last
 * case the mutation itself was a POST, which already counted as activity.
 */
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';

/** Refresh cadences from the plan's "Frontend architecture". */
export const POLL = {
  /** An open message thread — the one place a delay is felt as a delay. */
  thread: 5_000,
  /** Home queue, dashboards, notification badges. */
  queue: 30_000,
  /** Operational status; nothing here changes minute to minute. */
  status: 60_000,
} as const;

/** True once this key already holds data: this call is a refresh, not the first load. */
export function isRefresh(client: QueryClient, key: QueryKey): boolean {
  return (client.getQueryState(key)?.dataUpdatedAt ?? 0) > 0;
}

export interface LiveQueryOptions<T> {
  key: QueryKey;
  /** Receives `poll: true` on every fetch after the first one. */
  fetch: (opts: { poll: boolean }) => Promise<T>;
  /** Refetch cadence; omitted means "only when something invalidates it". */
  intervalMs?: number;
  enabled?: boolean;
  staleTime?: number;
}

/**
 * A query that refreshes itself without holding the session open.
 * `refetchIntervalInBackground` stays false, so a hidden tab stops asking.
 */
export function useLiveQuery<T>({ key, fetch, intervalMs, enabled = true, staleTime }: LiveQueryOptions<T>) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: key,
    queryFn: () => fetch({ poll: isRefresh(queryClient, key) }),
    enabled,
    staleTime,
    refetchInterval: intervalMs ?? false,
    refetchIntervalInBackground: false,
  });
}
