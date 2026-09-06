/**
 * The advisor's client list, and the account actions that go with it.
 *
 * A client signed in here reads the same endpoints scoped to themselves — the
 * server decides that, not the caller.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type { Client, OneTimeLink } from '../types';
import { keys } from './keys';
import { useScope, useSignedIn } from './auth';

export function useClients(options?: { enabled?: boolean }) {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useQuery<Client[]>({
    queryKey: keys.clients(scope),
    queryFn: () => api.clients.list(),
    enabled: signedIn && (options?.enabled ?? true),
  });
}

export function useClient(id: string | undefined) {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useQuery<Client>({
    queryKey: keys.client(scope, id ?? 'none'),
    queryFn: () => api.clients.get(id!),
    enabled: signedIn && Boolean(id),
  });
}

/** Anything that changes a client row invalidates the row and the list it sits in. */
function useClientMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>, idOf: (input: TInput) => string | undefined) {
  const queryClient = useQueryClient();
  const scope = useScope();
  return useMutation({
    mutationFn: fn,
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({ queryKey: keys.clients(scope) });
      const id = idOf(input);
      if (id) queryClient.invalidateQueries({ queryKey: keys.client(scope, id) });
    },
  });
}

export function useCreateClient() {
  return useClientMutation(
    (input: Parameters<typeof api.clients.create>[0]) => api.clients.create(input),
    () => undefined
  );
}

export function useUpdateClient() {
  return useClientMutation(
    (input: { id: string; patch: Parameters<typeof api.clients.update>[1] }) => api.clients.update(input.id, input.patch),
    (input) => input.id
  );
}

/** A fresh invitation link, replacing any unused one. Never email-only: the link is returned. */
export function useInviteClient() {
  return useClientMutation<string, OneTimeLink>((id) => api.clients.invite(id), (id) => id);
}

export function useClientResetLink() {
  return useClientMutation<string, OneTimeLink>((id) => api.clients.resetLink(id), (id) => id);
}

/** Reversible: sign-in is refused and live sessions end, the file stays. */
export function useDeactivateClient() {
  return useClientMutation<string, Client>((id) => api.clients.deactivate(id), (id) => id);
}

export function useReactivateClient() {
  return useClientMutation<string, Client>((id) => api.clients.reactivate(id), (id) => id);
}
