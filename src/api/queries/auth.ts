/**
 * Identity, and the scope every other query hangs off.
 *
 * `useMe` is the single copy of "who is signed in and how far through
 * sign-in they are". `AuthContext` reads it; `useScope` turns it into the key
 * prefix that keeps one account's cache away from the next one's.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../client';
import type { AuthState, MfaStatus, SessionSummary } from '../types';
import { keys, scopeOf, type Scope } from './keys';

/**
 * The session as the server sees it, or null when there is none.
 *
 * Never polled and never refetched on focus: this call would extend the session
 * it is reporting on. A session that ends elsewhere surfaces as a 401 on the
 * next real request, which `AuthContext` turns back into null.
 */
export function useMe() {
  return useQuery<AuthState | null>({
    queryKey: keys.me(),
    queryFn: async () => {
      try {
        return await api.auth.me();
      } catch (err) {
        // No session is an answer, not a failure.
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** The key prefix for the signed-in user, or ANON while nobody is. */
export function useScope(): Scope {
  const { data } = useMe();
  return scopeOf(data?.me);
}

/** False while nobody is signed in, so scoped queries stay switched off. */
export function useSignedIn(): boolean {
  const { data } = useMe();
  return Boolean(data?.me);
}

export function useSessions() {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useQuery<SessionSummary[]>({
    queryKey: keys.sessions(scope),
    queryFn: () => api.auth.sessions(),
    enabled: signedIn,
  });
}

export function useMfaStatus() {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useQuery<MfaStatus>({
    queryKey: keys.mfaStatus(scope),
    queryFn: () => api.auth.mfa.status(),
    enabled: signedIn,
  });
}

/** Changing the password ends every other session, so the list is now wrong. */
export function useChangePassword() {
  const queryClient = useQueryClient();
  const scope = useScope();
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) => api.auth.changePassword(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.sessions(scope) });
    },
  });
}

/** New recovery codes retire every old one; the count on screen must follow. */
export function useRegenerateRecoveryCodes() {
  const queryClient = useQueryClient();
  const scope = useScope();
  return useMutation({
    mutationFn: (code: string) => api.auth.mfa.regenerateRecoveryCodes(code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.mfaStatus(scope) });
    },
  });
}
