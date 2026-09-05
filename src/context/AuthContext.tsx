import React, { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, MFA_REQUIRED_EVENT, UNAUTHORIZED_EVENT, type UnauthorizedReason } from '@/api/client';
import type { AuthState, Me, SessionStage } from '@/api/types';
import { toast } from '@/hooks/use-toast';

/** What to tell the user when the server ends a session; missing/invalid are silent (no session to lose). */
const SIGNED_OUT_MESSAGE: Partial<Record<UnauthorizedReason, string>> = {
  idle: 'Signed out after 30 minutes of inactivity. Please sign in again.',
  expired: 'Your session has ended. Please sign in again.',
  revoked: 'You were signed out.',
};

interface AuthContextValue {
  me: Me | null;
  /** Null without a session. Screens are gated on `active`; the other stages own the /mfa routes. */
  stage: SessionStage | null;
  loading: boolean;
  login: (email: string, password: string, kind: 'provider' | 'client') => Promise<AuthState>;
  /** Takes over a session opened elsewhere (accepting an invitation). */
  adopt: (state: AuthState) => void;
  /** Called by the MFA screens once the server has moved the session to `active`. */
  activate: () => void;
  logout: () => Promise<void>;
  /** Every session of this user, including this one. */
  logoutAll: () => Promise<number>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [me, setMe] = useState<Me | null>(null);
  const [stage, setStage] = useState<SessionStage | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const state = await api.auth.me();
      setMe(state.me);
      setStage(state.stage);
    } catch {
      setMe(null);
      setStage(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  // A 401 from any API call (expired/cleared session) drops the session so the
  // RouteGuard redirects to /login on the next render. A 403 mfa_required means
  // the session lost its second factor (another tab, a reset): fall back a stage.
  useEffect(() => {
    const onUnauthorized = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: UnauthorizedReason }>).detail?.reason;
      const message = reason ? SIGNED_OUT_MESSAGE[reason] : undefined;
      setMe((current) => {
        if (current && message) toast({ title: 'Signed out', description: message });
        return null;
      });
      setStage(null);
    };
    const onMfaRequired = (event: Event) => {
      const next = (event as CustomEvent<{ stage?: SessionStage }>).detail?.stage;
      if (next === 'preauth' || next === 'mfa_enroll') setStage(next);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    window.addEventListener(MFA_REQUIRED_EVENT, onMfaRequired);
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
      window.removeEventListener(MFA_REQUIRED_EVENT, onMfaRequired);
    };
  }, []);

  const login = async (email: string, password: string, kind: 'provider' | 'client') => {
    const state = await api.auth.login(email, password, kind);
    setMe(state.me);
    setStage(state.stage);
    return state;
  };

  const adopt = useCallback((state: AuthState) => {
    setMe(state.me);
    setStage(state.stage);
  }, []);

  const activate = useCallback(() => setStage('active'), []);

  const logout = async () => {
    await api.auth.logout();
    setMe(null);
    setStage(null);
  };

  const logoutAll = async () => {
    const { revoked } = await api.auth.logoutAll();
    setMe(null);
    setStage(null);
    return revoked;
  };

  return (
    <AuthContext.Provider value={{ me, stage, loading, login, adopt, activate, logout, logoutAll, refresh }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
