import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

/**
 * How long a fetched answer is treated as fresh. Ten seconds is short enough
 * that a screen opened twice in a minute is current, and long enough that
 * navigating between two screens that read the same list does not refetch it.
 */
export const STALE_TIME = 10_000;

/**
 * The app's QueryClient. A factory rather than a module singleton so tests get
 * an empty cache each time.
 *
 * Retries are deliberately narrow: a 401, 403, 404 or 409 is the server's
 * answer, not a glitch, and retrying it only turns one refusal into three.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}
