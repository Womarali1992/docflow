/**
 * Notifications and the unread badge.
 *
 * The count comes from the server, never from counting rows in the browser
 * (invariant 15) — the table fills up in C4.3 and the badge must be right the
 * moment it does.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type { NotificationList } from '../types';
import { keys } from './keys';
import { useScope, useSignedIn } from './auth';
import { POLL, useLiveQuery } from './live';

export function useNotifications(options?: { unreadOnly?: boolean; live?: boolean }) {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useLiveQuery<NotificationList>({
    key: keys.notifications(scope),
    fetch: ({ poll }) => api.notifications.list({ unread: options?.unreadOnly }, { poll }),
    intervalMs: options?.live === false ? undefined : POLL.queue,
    enabled: signedIn,
  });
}

/** No ids marks everything read. */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  const scope = useScope();
  return useMutation({
    mutationFn: (ids?: string[]) => api.notifications.markRead(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.notifications(scope) });
    },
  });
}
