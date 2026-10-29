/**
 * The firm and its team (FIRM-BOOK-PLAN F4). Every advisor reads it: the
 * Advisor column and select, and the queue's Mine / Everyone toggle, are built
 * from it. Only an owner's mutations succeed; the server says so, not this file.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type { Firm } from '../types';
import { keys } from './keys';
import { useScope, useSignedIn } from './auth';

export function useFirm(options?: { enabled?: boolean }) {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useQuery<Firm>({
    queryKey: keys.firm(scope),
    queryFn: () => api.firm.get(),
    enabled: signedIn && scope[0] === 'provider' && (options?.enabled ?? true),
  });
}

/**
 * Advisors who can sign in today: the people a client can be given to, and the
 * count that decides whether the book is shared at all. Someone invited who
 * has not joined yet is neither.
 */
export function activeAdvisors(firm: Firm | undefined) {
  return (firm?.advisors ?? []).filter((a) => a.deactivatedAt === null && a.hasPassword);
}

/** A change to the team moves counts on clients too (deactivating hands theirs on). */
function useTeamMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  const scope = useScope();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.firm(scope) });
      queryClient.invalidateQueries({ queryKey: keys.clients(scope) });
      queryClient.invalidateQueries({ queryKey: keys.dashboard(scope) });
    },
  });
}

export function useInviteAdvisor() {
  return useTeamMutation((input: { name: string; email: string }) => api.firm.invite(input));
}

export function useResendAdvisorInvite() {
  return useTeamMutation((id: string) => api.firm.resendInvite(id));
}

export function useDeactivateAdvisor() {
  return useTeamMutation((input: { id: string; reassignTo: string | null }) => api.firm.deactivate(input.id, input.reassignTo));
}

export function useReactivateAdvisor() {
  return useTeamMutation((id: string) => api.firm.reactivate(id));
}
