/**
 * Engagements and their checklists.
 *
 * `useEngagement` fetches the tree the screen actually needs — engagement,
 * checklist and documents in one round trip — so a checklist of thirty lines
 * is one request, not thirty-one.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type { Engagement, EngagementKind, EngagementTree, RequestItem, TemplateItem } from '../types';
import { keys } from './keys';
import { useScope, useSignedIn } from './auth';

export function useEngagements(params?: { clientId?: string }) {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useQuery<Engagement[]>({
    queryKey: keys.engagementList(scope, params?.clientId),
    queryFn: () => api.engagements.list(params),
    enabled: signedIn,
  });
}

export function useEngagement(id: string | undefined) {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useQuery<EngagementTree>({
    queryKey: keys.engagement(scope, id ?? 'none'),
    queryFn: () => api.engagements.get(id!),
    enabled: signedIn && Boolean(id),
  });
}

/**
 * Everything that touches an engagement invalidates the same three prefixes:
 * the engagement itself, the lists it appears in, and the home queue whose
 * counts it moves.
 */
function useEngagementMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>, idOf: (input: TInput) => string | undefined) {
  const queryClient = useQueryClient();
  const scope = useScope();
  return useMutation({
    mutationFn: fn,
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({ queryKey: keys.engagements(scope) });
      queryClient.invalidateQueries({ queryKey: keys.dashboard(scope) });
      const id = idOf(input);
      if (id) queryClient.invalidateQueries({ queryKey: keys.engagement(scope, id) });
    },
  });
}

export function useCreateEngagement() {
  return useEngagementMutation<{ clientId: string; title: string; kind?: EngagementKind; taxYear?: number | null }, Engagement>(
    (input) => api.engagements.create(input),
    () => undefined
  );
}

export function useUpdateEngagement() {
  return useEngagementMutation<{ id: string; patch: Partial<{ title: string; kind: EngagementKind; taxYear: number | null }> }, Engagement>(
    (input) => api.engagements.update(input.id, input.patch),
    (input) => input.id
  );
}

export function useCloseEngagement() {
  return useEngagementMutation<string, Engagement>((id) => api.engagements.close(id), (id) => id);
}

export function useReopenEngagement() {
  return useEngagementMutation<string, Engagement>((id) => api.engagements.reopen(id), (id) => id);
}

/** Appends checklist lines — from a template or explicit items, never both. */
export function useAddRequests() {
  return useEngagementMutation<
    { id: string; input: { templateId: string; dueDate?: string | null } | { items: TemplateItem[]; dueDate?: string | null } },
    RequestItem[]
  >((input) => api.engagements.addRequests(input.id, input.input), (input) => input.id);
}
