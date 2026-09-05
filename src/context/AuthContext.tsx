import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, UNAUTHORIZED_EVENT, type UnauthorizedReason } from '@/api/client';
import type { Me } from '@/api/types';
import { toast } from '@/hooks/use-toast';

/** What to tell the user when the server ends a session; missing/invalid are silent (no session to lose). */
const SIGNED_OUT_MESSAGE: Partial<Record<UnauthorizedReason, string>> = {
  idle: 'Signed out after 30 minutes of inactivity. Please sign in again.',
  expired: 'Your session has ended. Please sign in again.',
  revoked: 'You were signed out.',
};

interface AuthContextValue {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string, kind: 'provider' | 'client') => Promise<Me>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const m = await api.auth.me();
      setMe(m);
    } catch {
      setMe(null);
    }
  };

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, []);

  // A 401 from any API call (expired/cleared session) drops the session so the
  // RouteGuard redirects to /login on the next render.
  useEffect(() => {
    const onUnauthorized = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: UnauthorizedReason }>).detail?.reason;
      const message = reason ? SIGNED_OUT_MESSAGE[reason] : undefined;
      setMe((current) => {
        if (current && message) toast({ title: 'Signed out', description: message });
        return null;
      });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = async (email: string, password: string, kind: 'provider' | 'client') => {
    const m = await api.auth.login(email, password, kind);
    setMe(m);
    return m;
  };

  const logout = async () => {
    await api.auth.logout();
    setMe(null);
  };

  return (
    <AuthContext.Provider value={{ me, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
