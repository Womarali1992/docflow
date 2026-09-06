/**
 * The review loop: one checklist line moving between requested, submitted,
 * accepted, needs-correction and waived.
 *
 * Each verb is its own mutation because each one is its own decision on the
 * server (invariant 5) — there is no permissive "update status" here, and there
 * should not be one in the UI either.
 *
 * Invalidation is deliberately wide: a decision on one line changes the
 * engagement's checklist, the document's review history and the advisor's home
 * queue at the same time, and a stale count on the queue is worse than a refetch.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type { RequestItem, UploadResult } from '../types';
import { keys } from './keys';
import { useScope, useSignedIn } from './auth';

export function useRequest(id: string | undefined) {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useQuery<RequestItem>({
    queryKey: keys.request(scope, id ?? 'none'),
    queryFn: () => api.requests.get(id!),
    enabled: signedIn && Boolean(id),
  });
}

function useRequestMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>, idOf: (input: TInput) => string) {
  const queryClient = useQueryClient();
  const scope = useScope();
  return useMutation({
    mutationFn: fn,
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({ queryKey: keys.request(scope, idOf(input)) });
      queryClient.invalidateQueries({ queryKey: keys.engagements(scope) });
      queryClient.invalidateQueries({ queryKey: keys.documents(scope) });
      queryClient.invalidateQueries({ queryKey: keys.dashboard(scope) });
    },
  });
}

export function useUpdateRequest() {
  return useRequestMutation<{ id: string; patch: Parameters<typeof api.requests.update>[1] }, RequestItem>(
    (input) => api.requests.update(input.id, input.patch),
    (input) => input.id
  );
}

export function useAcceptRequest() {
  return useRequestMutation<{ id: string; versionId?: string; note?: string }, RequestItem>(
    (input) => api.requests.accept(input.id, { versionId: input.versionId, note: input.note }),
    (input) => input.id
  );
}

/** The note is required — it is what the client is shown as the thing to fix. */
export function useRequestCorrection() {
  return useRequestMutation<{ id: string; note: string; versionId?: string }, RequestItem>(
    (input) => api.requests.requestCorrection(input.id, { note: input.note, versionId: input.versionId }),
    (input) => input.id
  );
}

export function useWaiveRequest() {
  return useRequestMutation<{ id: string; reason: string }, RequestItem>(
    (input) => api.requests.waive(input.id, input.reason),
    (input) => input.id
  );
}

export function useReopenRequest() {
  return useRequestMutation<string, RequestItem>((id) => api.requests.reopen(id), (id) => id);
}

/** "I don't have this" — recorded against the line, and left for the advisor to decide. */
export function useRespondToRequest() {
  return useRequestMutation<{ id: string; note?: string }, RequestItem>(
    (input) => api.requests.respond(input.id, { kind: 'not_applicable', note: input.note }),
    (input) => input.id
  );
}

/** The client answering a checklist line with a file. 202 means "still being checked". */
export function useUploadToRequest() {
  return useRequestMutation<{ id: string; file: File }, UploadResult>(
    (input) => api.uploads.toRequest(input.id, input.file),
    (input) => input.id
  );
}
