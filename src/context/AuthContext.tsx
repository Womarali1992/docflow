import React, { createContext, useCallback, useContext, useEffect, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, MFA_REQUIRED_EVENT, UNAUTHORIZED_EVENT, type UnauthorizedReason } from '@/api/client';
import type { AuthState, Me, SessionStage } from '@/api/types';
import { keys } from '@/api/queries/keys';
import { useMe } from '@/api/queries/auth';
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

/**
 * Session lifecycle. Since C3.1 the identity itself lives in the query cache
 * under `keys.me()` — this provider owns the *transitions* (sign in, take over,
 * second factor cleared, sign out) and nothing else, so there is no second copy
 * of "who is signed in" to drift.
 *
 * Signing in, signing out and being signed out all empty the cache of the
 * account's data, so no answer fetched for one account can be served to the
 * next one signed in from the same tab.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const { data, isPending, refetch } = useMe();

  const me = data?.me ?? null;
  const stage = data?.stage ?? null;

  const setAuth = useCallback(
    (state: AuthState | null) => {
      queryClient.setQueryData(keys.me(), state);
    },
    [queryClient]
  );

  /**
   * Empties the cache of everything belonging to the account that was signed in,
   * and leaves the identity itself as an explicit answer.
   *
   * Deliberately not `queryClient.clear()`: removing the `/auth/me` query out
   * from under its own mounted observer detaches that observer, which then
   * shows whatever it last saw and never learns the session ended. Every other
   * key goes, which is what "nothing survives a sign-out" has to mean.
   */
  const dropOtherQueries = useCallback(() => {
    const [ns, name] = keys.me();
    queryClient.removeQueries({ predicate: (q) => !(q.queryKey[0] === ns && q.queryKey[1] === name) });
  }, [queryClient]);

  /** Sign-out, from any cause: everything that hung off the session, then the session. */
  const clearSession = useCallback(() => {
    dropOtherQueries();
    // Written back immediately so the guard sees "no session" rather than
    // "not loaded yet".
    queryClient.setQueryData(keys.me(), null);
  }, [dropOtherQueries, queryClient]);

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // A 401 from any API call (expired/cleared session) drops the session so the
  // RouteGuard redirects to /login on the next render. A 403 mfa_required means
  // the session lost its second factor (another tab, a reset): fall back a stage.
  useEffect(() => {
    const onUnauthorized = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: UnauthorizedReason }>).detail?.reason;
      const message = reason ? SIGNED_OUT_MESSAGE[reason] : undefined;
      const had = queryClient.getQueryData<AuthState | null>(keys.me());
      if (!had) {
        // Nothing was signed in, so there is nothing to clear — and clearing a
        // cache mid-flight would restart the very request that found this out.
        queryClient.setQueryData(keys.me(), null);
        return;
      }
      if (message) toast({ title: 'Signed out', description: message });
      clearSession();
    };
    const onMfaRequired = (event: Event) => {
      const next = (event as CustomEvent<{ stage?: SessionStage }>).detail?.stage;
      if (next !== 'preauth' && next !== 'mfa_enroll') return;
      queryClient.setQueryData<AuthState | null>(keys.me(), (current) => (current ? { ...current, stage: next } : current));
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    window.addEventListener(MFA_REQUIRED_EVENT, onMfaRequired);
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
      window.removeEventListener(MFA_REQUIRED_EVENT, onMfaRequired);
    };
  }, [queryClient, clearSession]);

  const login = useCallback(
    async (email: string, password: string, kind: 'provider' | 'client') => {
      const state = await api.auth.login(email, password, kind);
      // A different account may have been signed in here a moment ago.
      dropOtherQueries();
      setAuth(state);
      return state;
    },
    [dropOtherQueries, setAuth]
  );

  const adopt = useCallback(
    (state: AuthState) => {
      dropOtherQueries();
      setAuth(state);
    },
    [dropOtherQueries, setAuth]
  );

  const activate = useCallback(() => {
    queryClient.setQueryData<AuthState | null>(keys.me(), (current) => (current ? { ...current, stage: 'active' } : current));
  }, [queryClient]);

  const logout = useCallback(async () => {
    await api.auth.logout();
    clearSession();
  }, [clearSession]);

  const logoutAll = useCallback(async () => {
    const { revoked } = await api.auth.logoutAll();
    clearSession();
    return revoked;
  }, [clearSession]);

  return (
    <AuthContext.Provider value={{ me, stage, loading: isPending, login, adopt, activate, logout, logoutAll, refresh }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
