import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { api } from '@/api/client';
import type { Client } from '@/api/types';
import { useAuth } from './AuthContext';

interface ClientsContextValue {
  clients: Client[];
  loading: boolean;
  refresh: () => Promise<void>;
}

const ClientsContext = createContext<ClientsContextValue | undefined>(undefined);

export const ClientsProvider = ({ children }: { children: ReactNode }) => {
  const { me } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!me) {
      setClients([]);
      return;
    }
    setLoading(true);
    try {
      if (me.kind === 'provider') {
        const list = await api.clients.list();
        setClients(list);
      } else {
        // For a client, fetch only themselves
        const c = await api.clients.get(me.id);
        setClients([c]);
      }
    } catch {
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, [me]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <ClientsContext.Provider value={{ clients, loading, refresh }}>
      {children}
    </ClientsContext.Provider>
  );
};

export const useClients = () => {
  const ctx = useContext(ClientsContext);
  if (!ctx) throw new Error('useClients must be used within ClientsProvider');
  return ctx;
};
