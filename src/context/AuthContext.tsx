import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, UNAUTHORIZED_EVENT } from '@/api/client';
import type { Me } from '@/api/types';

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
    const onUnauthorized = () => setMe(null);
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
