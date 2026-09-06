/**
 * The activity feed — what happened, in the words the file will keep.
 *
 * Distinct from the audit log: activities are the human-readable story shown on
 * a client page, the audit log is the append-only record the firm answers with.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import type { Activity } from '../types';
import { keys } from './keys';
import { useScope, useSignedIn } from './auth';

export function useActivities(params: { clientId?: string; limit?: number } = {}) {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useQuery<Activity[]>({
    queryKey: keys.activities(scope, params as Record<string, unknown>),
    queryFn: () => api.activities.list(params),
    enabled: signedIn,
  });
}
