/**
 * Message threads — client-level or document-level.
 *
 * The open thread is the one place in the app where a five-second delay reads
 * as the app being broken, so it polls at five seconds. Those refreshes carry
 * the poll header (see `live.ts`): watching a thread is not activity, and a
 * thread left open on a second monitor must not hold a session open all day.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type { Message } from '../types';
import { keys, type ThreadRef } from './keys';
import { useScope, useSignedIn } from './auth';
import { POLL, useLiveQuery } from './live';

export function useMessages(thread: ThreadRef, options?: { live?: boolean }) {
  const scope = useScope();
  const signedIn = useSignedIn();
  const addressed = Boolean(thread.clientId || thread.documentId);
  return useLiveQuery<Message[]>({
    key: keys.thread(scope, thread),
    fetch: ({ poll }) => api.messages.list(thread, { poll }),
    intervalMs: options?.live === false ? undefined : POLL.thread,
    enabled: signedIn && addressed,
  });
}

export function useSendMessage(thread: ThreadRef) {
  const queryClient = useQueryClient();
  const scope = useScope();
  return useMutation({
    mutationFn: (content: string) => api.messages.send({ ...thread, content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.thread(scope, thread) });
      // Unread counts live on the client row and the home queue.
      queryClient.invalidateQueries({ queryKey: keys.clients(scope) });
      queryClient.invalidateQueries({ queryKey: keys.dashboard(scope) });
    },
  });
}

export function useMarkThreadRead(thread: ThreadRef) {
  const queryClient = useQueryClient();
  const scope = useScope();
  return useMutation({
    mutationFn: () => api.messages.markRead(thread),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.thread(scope, thread) });
      queryClient.invalidateQueries({ queryKey: keys.clients(scope) });
      queryClient.invalidateQueries({ queryKey: keys.dashboard(scope) });
    },
  });
}
