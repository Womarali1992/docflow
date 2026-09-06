import { useCallback, useEffect, useRef } from 'react';
import { useMarkThreadRead, useMe, useMessages, useSendMessage, type ThreadRef } from '@/api/queries';

/**
 * One message thread — the client's, or one scoped to a document.
 *
 * Since C3.2 this is a thin wrapper over the query layer: the thread refreshes
 * itself every five seconds (those refreshes carry the poll header, so a thread
 * left open on a second monitor does not hold the session open), and sending
 * invalidates the unread counts the advisor's screens read.
 *
 * Opening a thread marks the other party's messages read — once per thread, not
 * once per refresh, or the badge would clear again every five seconds.
 */
export function useMessageThread(thread: ThreadRef) {
  const { clientId, documentId } = thread;
  const { data: session } = useMe();
  /* A client's thread needs no address — the server scopes it to them. */
  const selfScoped = session?.me.kind === 'client';
  const { data: messages = [], isPending: loading } = useMessages({ clientId, documentId });
  const sendMessage = useSendMessage({ clientId, documentId });
  const markRead = useMarkThreadRead({ clientId, documentId });

  const markReadRef = useRef(markRead.mutate);
  markReadRef.current = markRead.mutate;

  const threadKey = `${clientId ?? ''}|${documentId ?? ''}`;
  useEffect(() => {
    if (!clientId && !documentId && !selfScoped) return;
    markReadRef.current(undefined, {
      // Best-effort: a thread that will not mark read is still readable.
      onError: () => undefined,
    });
  }, [threadKey, clientId, documentId, selfScoped]);

  const send = useCallback(
    async (content: string) => {
      const body = content.trim();
      if (!body) return;
      await sendMessage.mutateAsync(body);
    },
    [sendMessage]
  );

  return { messages, loading, sending: sendMessage.isPending, send };
}
