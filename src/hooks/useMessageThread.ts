import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { Message } from '@/api/types';
import { useClients } from '@/context/ClientsContext';

/**
 * Loads a message thread (optionally scoped to a document), marks the other
 * party's messages as read on open, and refreshes the clients list so unread
 * badges clear. Providers must pass a clientId; clients are self-scoped server-side.
 */
export function useMessageThread(params: { clientId?: string; documentId?: string }) {
  const { clientId, documentId } = params;
  const { refresh: refreshClients } = useClients();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.messages.list({ clientId, documentId });
      setMessages(list);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [clientId, documentId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await reload();
      if (cancelled) return;
      try {
        const res = await api.messages.markRead({ clientId, documentId });
        if (res.updated > 0) refreshClients();
      } catch {
        /* mark-read is best-effort */
      }
    })();
    return () => { cancelled = true; };
  }, [reload, clientId, documentId, refreshClients]);

  const send = useCallback(async (content: string) => {
    const body = content.trim();
    if (!body) return;
    setSending(true);
    try {
      const created = await api.messages.send({ clientId, documentId, content: body });
      setMessages((prev) => [...prev, created]);
    } finally {
      setSending(false);
    }
  }, [clientId, documentId]);

  return { messages, loading, sending, send, reload };
}
