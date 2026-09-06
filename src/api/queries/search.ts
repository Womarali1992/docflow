/**
 * Search across documents and checklist lines.
 *
 * Scope is the server's decision, not a filter the caller can widen: an
 * advisor searches their own firm, a client their own file, and an unshared
 * deliverable is not in either result.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import type { SearchParams, SearchResults } from '../types';
import { keys } from './keys';
import { useScope, useSignedIn } from './auth';

/** An empty search is not sent: the server would answer with an empty result anyway. */
export function useSearch(params: SearchParams) {
  const scope = useScope();
  const signedIn = useSignedIn();
  const asked = Boolean(params.q?.trim() || params.category || params.status || params.year !== undefined);
  return useQuery<SearchResults>({
    queryKey: keys.search(scope, params),
    queryFn: () => api.search.run(params),
    enabled: signedIn && asked,
    placeholderData: (previous) => previous,
  });
}
